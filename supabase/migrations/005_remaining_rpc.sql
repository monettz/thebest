-- ==========================================================
-- THE BEST POS - Additional RPCs for Debts, Closings, Stock Take, Purchases
-- ==========================================================

-- 1. DEBT PAYMENT (Atomic payment + sale status update)
CREATE OR REPLACE FUNCTION public.rpc_pay_debt(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id bigint;
  v_sale record;
  v_customer_id bigint;
  v_amount bigint;
  v_method public.payment_method;
  v_user_name text;
  v_ref text;
  v_key text;
  v_paid_to_date bigint;
  v_left bigint;
  v_new_status public.sale_status;
  v_payment_id bigint;
BEGIN
  v_sale_id := (payload->>'saleId')::bigint;
  v_amount := (payload->>'amount')::bigint;
  v_method := (payload->>'method')::public.payment_method;
  v_user_name := payload->>'userName';
  v_ref := payload->>'reference';
  v_key := payload->>'key';

  -- Check idempotency
  IF v_key IS NOT NULL AND length(trim(v_key)) > 0 THEN
    SELECT id INTO v_payment_id FROM public.payments WHERE idempotency_key = trim(v_key);
    IF v_payment_id IS NOT NULL THEN
      SELECT total, customer_id INTO v_sale FROM public.sales WHERE id = v_sale_id;
      SELECT COALESCE(SUM(amount), 0) INTO v_paid_to_date FROM public.payments WHERE sale_id = v_sale_id;
      RETURN jsonb_build_object(
        'saleId', v_sale_id,
        'paymentId', v_payment_id,
        'left', GREATEST(0, v_sale.total - v_paid_to_date),
        'duplicate', true
      );
    END IF;
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mauzo hayajapatikana';
  END IF;

  v_customer_id := v_sale.customer_id;

  INSERT INTO public.payments (
    sale_id,
    customer_id,
    method,
    amount,
    kind,
    user_name,
    reference,
    idempotency_key
  ) VALUES (
    v_sale_id,
    v_customer_id,
    v_method,
    v_amount,
    'DEBT',
    v_user_name,
    v_ref,
    NULLIF(trim(v_key), '')
  ) RETURNING id INTO v_payment_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_to_date FROM public.payments WHERE sale_id = v_sale_id;
  v_left := GREATEST(0, v_sale.total - v_paid_to_date);

  IF v_left = 0 THEN
    v_new_status := 'PAID';
    UPDATE public.sales SET status = 'PAID', due_date = NULL WHERE id = v_sale_id;
  ELSE
    v_new_status := 'PARTIAL';
    UPDATE public.sales SET status = 'PARTIAL' WHERE id = v_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'saleId', v_sale_id,
    'paymentId', v_payment_id,
    'left', v_left,
    'duplicate', false
  );
END;
$$;

-- 2. CLOSE DAY (End-of-day register reconciliation)
CREATE OR REPLACE FUNCTION public.rpc_close_day(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date date;
  v_user_name text;
  v_counted bigint;
  v_note text;
  v_cash_sales bigint := 0;
  v_cash_debt bigint := 0;
  v_cash_refunds bigint := 0;
  v_cash_expenses bigint := 0;
  v_expected bigint;
  v_diff bigint;
  v_closing_id bigint;
BEGIN
  v_date := (payload->>'date')::date;
  v_user_name := payload->>'userName';
  v_counted := (payload->>'counted')::bigint;
  v_note := COALESCE(payload->>'note', '');

  -- Calculate cash transactions for that date
  SELECT COALESCE(SUM(amount), 0) INTO v_cash_sales
  FROM public.payments
  WHERE method = 'CASH' AND kind = 'SALE' AND (paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = v_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash_debt
  FROM public.payments
  WHERE method = 'CASH' AND kind = 'DEBT' AND (paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = v_date;

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_cash_refunds
  FROM public.payments
  WHERE method = 'CASH' AND kind = 'REFUND' AND (paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Dar_es_Salaam')::date = v_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
  FROM public.expenses
  WHERE method = 'CASH' AND spent_on = v_date;

  v_expected := (v_cash_sales + v_cash_debt) - (v_cash_refunds + v_cash_expenses);
  v_diff := v_counted - v_expected;

  INSERT INTO public.cash_closings (
    closing_date,
    user_name,
    cash_sales,
    cash_debt_payments,
    cash_refunds,
    cash_expenses,
    expected_cash,
    counted_cash,
    difference,
    note
  ) VALUES (
    v_date,
    v_user_name,
    v_cash_sales,
    v_cash_debt,
    v_cash_refunds,
    v_cash_expenses,
    v_expected,
    v_counted,
    v_diff,
    v_note
  ) ON CONFLICT (closing_date) DO UPDATE SET
    user_name = EXCLUDED.user_name,
    cash_sales = EXCLUDED.cash_sales,
    cash_debt_payments = EXCLUDED.cash_debt_payments,
    cash_refunds = EXCLUDED.cash_refunds,
    cash_expenses = EXCLUDED.cash_expenses,
    expected_cash = EXCLUDED.expected_cash,
    counted_cash = EXCLUDED.counted_cash,
    difference = EXCLUDED.difference,
    note = EXCLUDED.note,
    created_at = now()
  RETURNING id INTO v_closing_id;

  RETURN v_closing_id;
END;
$$;

-- 3. APPROVE STOCK TAKE (Applies adjustments safely)
CREATE OR REPLACE FUNCTION public.rpc_approve_stock_take(payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_take_id bigint;
  v_user_name text;
  v_line jsonb;
  v_diff int;
  v_prod_id bigint;
  v_loc public.stock_location;
  v_imei text;
BEGIN
  v_take_id := (payload->>'takeId')::bigint;
  v_user_name := payload->>'userName';

  SELECT location INTO v_loc FROM public.stock_takes WHERE id = v_take_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock take haijapatikana';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(payload->'lines')
  LOOP
    v_diff := (v_line->>'countedQty')::int - (v_line->>'systemQty')::int;
    v_prod_id := (v_line->>'productId')::bigint;

    IF v_diff < 0 THEN
      -- Shortage
      INSERT INTO public.stock_movements (
        product_id,
        from_location,
        to_location,
        qty,
        type,
        ref_type,
        ref_id,
        user_name,
        note
      ) VALUES (
        v_prod_id,
        v_loc,
        NULL,
        ABS(v_diff),
        'ADJUSTMENT',
        'stock-take',
        v_take_id,
        v_user_name,
        COALESCE(v_line->>'reason', 'Upungufu wa kuhesabu stock')
      );

      -- Mark missing IMEIs if provided
      IF v_line->'missingImeis' IS NOT NULL THEN
        FOR v_imei IN SELECT jsonb_array_elements_text(v_line->'missingImeis')
        LOOP
          UPDATE public.inventory_units
          SET status = 'DAMAGED', updated_at = now()
          WHERE imei = v_imei;
        END LOOP;
      END IF;
    ELSIF v_diff > 0 THEN
      -- Surplus
      INSERT INTO public.stock_movements (
        product_id,
        from_location,
        to_location,
        qty,
        type,
        ref_type,
        ref_id,
        user_name,
        note
      ) VALUES (
        v_prod_id,
        NULL,
        v_loc,
        v_diff,
        'ADJUSTMENT',
        'stock-take',
        v_take_id,
        v_user_name,
        'Ziada ya kuhesabu stock'
      );
    END IF;
  END LOOP;

  UPDATE public.stock_takes
  SET
    status = 'APPROVED',
    approved_by = v_user_name,
    approved_at = now()
  WHERE id = v_take_id;

  RETURN true;
END;
$$;

-- 4. CREATE PURCHASE (Atomic stock receipt from supplier)
CREATE OR REPLACE FUNCTION public.rpc_create_purchase(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_purchase_id bigint;
  v_supplier_id bigint;
  v_loc public.stock_location;
  v_line jsonb;
  v_imei text;
BEGIN
  v_supplier_id := (payload->>'supplierId')::bigint;
  v_loc := COALESCE(payload->>'location', 'STORE')::public.stock_location;

  INSERT INTO public.purchases (
    supplier_id,
    location,
    invoice_no,
    purchase_date,
    total,
    user_name,
    lines
  ) VALUES (
    v_supplier_id,
    v_loc,
    payload->>'invoiceNo',
    (payload->>'date')::date,
    (payload->>'total')::bigint,
    payload->>'userName',
    payload->'lines'
  ) RETURNING id INTO v_purchase_id;

  -- Add stock movements and IMEIs
  FOR v_line IN SELECT * FROM jsonb_array_elements(payload->'lines')
  LOOP
    INSERT INTO public.stock_movements (
      product_id,
      from_location,
      to_location,
      qty,
      type,
      unit_cost,
      ref_type,
      ref_id,
      user_name,
      note
    ) VALUES (
      (v_line->>'productId')::bigint,
      NULL,
      v_loc,
      (v_line->>'qty')::int,
      'PURCHASE',
      COALESCE((v_line->>'unitCost')::bigint, 0),
      'purchase',
      v_purchase_id,
      payload->>'userName',
      'Purchase ' || (payload->>'invoiceNo')
    );

    IF v_line->'imeis' IS NOT NULL AND jsonb_array_length(v_line->'imeis') > 0 THEN
      FOR v_imei IN SELECT jsonb_array_elements_text(v_line->'imeis')
      LOOP
        INSERT INTO public.inventory_units (
          imei,
          product_id,
          status
        ) VALUES (
          v_imei,
          (v_line->>'productId')::bigint,
          CASE WHEN v_loc = 'STORE' THEN 'IN_STORE'::public.unit_status ELSE 'IN_SHOP'::public.unit_status END
        ) ON CONFLICT (imei) DO UPDATE
        SET status = CASE WHEN v_loc = 'STORE' THEN 'IN_STORE'::public.unit_status ELSE 'IN_SHOP'::public.unit_status END,
            updated_at = now();
      END LOOP;
    END IF;
  END LOOP;

  -- Supplier payment if paidNow > 0
  IF COALESCE((payload->>'paidNow')::bigint, 0) > 0 AND v_supplier_id IS NOT NULL THEN
    INSERT INTO public.supplier_payments (
      supplier_id,
      purchase_id,
      amount,
      method,
      user_name
    ) VALUES (
      v_supplier_id,
      v_purchase_id,
      (payload->>'paidNow')::bigint,
      (payload->>'method')::public.payment_method,
      payload->>'userName'
    );
  END IF;

  RETURN v_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pay_debt(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_close_day(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_approve_stock_take(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_purchase(jsonb) TO anon, authenticated;

