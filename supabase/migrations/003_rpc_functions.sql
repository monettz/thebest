-- ==========================================================
-- THE BEST POS - Supabase Transactional RPC Functions
-- ==========================================================

-- 1. COMPLETE SALE (Atomic checkout)
CREATE OR REPLACE FUNCTION public.rpc_complete_sale(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id bigint;
  v_line jsonb;
  v_payment jsonb;
  v_imei text;
BEGIN
  -- Insert into sales table
  INSERT INTO public.sales (
    receipt_no,
    user_name,
    user_id,
    customer_id,
    subtotal,
    discount,
    total,
    due_date,
    status
  ) VALUES (
    payload->>'receiptNo',
    payload->>'userName',
    (payload->>'userId')::uuid,
    (payload->>'customerId')::bigint,
    (payload->>'subtotal')::bigint,
    COALESCE((payload->>'discount')::bigint, 0),
    (payload->>'total')::bigint,
    (payload->>'dueDate')::date,
    (payload->>'status')::public.sale_status
  ) RETURNING id INTO v_sale_id;

  -- Insert sale items and process stock deduction
  FOR v_line IN SELECT * FROM jsonb_array_elements(payload->'lines')
  LOOP
    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      name,
      qty,
      unit_price,
      unit_cost,
      imei
    ) VALUES (
      v_sale_id,
      (v_line->>'productId')::bigint,
      v_line->>'name',
      (v_line->>'qty')::int,
      (v_line->>'unitPrice')::bigint,
      COALESCE((v_line->>'unitCost')::bigint, 0),
      v_line->>'imei'
    );

    -- If line has an IMEI, mark it as SOLD
    IF (v_line->>'imei') IS NOT NULL AND length(trim(v_line->>'imei')) > 0 THEN
      v_imei := trim(v_line->>'imei');
      UPDATE public.inventory_units
      SET status = 'SOLD', updated_at = now()
      WHERE imei = v_imei;
    END IF;

    -- Record stock movement
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
      'SHOP',
      NULL,
      (v_line->>'qty')::int,
      'SALE',
      (v_line->>'unitCost')::bigint,
      'sale',
      v_sale_id,
      payload->>'userName',
      'POS Sale ' || (payload->>'receiptNo')
    );
  END LOOP;

  -- Insert payments
  FOR v_payment IN SELECT * FROM jsonb_array_elements(payload->'payments')
  LOOP
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
      (payload->>'customerId')::bigint,
      (v_payment->>'method')::public.payment_method,
      (v_payment->>'amount')::bigint,
      'SALE',
      payload->>'userName',
      v_payment->>'reference',
      v_payment->>'idempotencyKey'
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;

-- 2. CREATE TRANSFER (Store -> Shop)
CREATE OR REPLACE FUNCTION public.rpc_create_transfer(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer_id bigint;
  v_line jsonb;
  v_imei text;
BEGIN
  INSERT INTO public.transfers (
    user_name,
    note,
    items
  ) VALUES (
    payload->>'userName',
    COALESCE(payload->>'note', ''),
    payload->'lines'
  ) RETURNING id INTO v_transfer_id;

  -- Process lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(payload->'lines')
  LOOP
    -- Insert stock movement: STORE -> SHOP
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
      (v_line->>'productId')::bigint,
      'STORE',
      'SHOP',
      (v_line->>'qty')::int,
      'TRANSFER',
      'transfer',
      v_transfer_id,
      payload->>'userName',
      COALESCE(payload->>'note', 'Transfer to Shop')
    );

    -- Update IMEIs to IN_SHOP
    IF v_line->'imeis' IS NOT NULL AND jsonb_array_length(v_line->'imeis') > 0 THEN
      FOR v_imei IN SELECT jsonb_array_elements_text(v_line->'imeis')
      LOOP
        UPDATE public.inventory_units
        SET status = 'IN_SHOP', updated_at = now()
        WHERE imei = v_imei;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_transfer_id;
END;
$$;

-- 3. ADD SHOP STOCK (Direct to Shop)
CREATE OR REPLACE FUNCTION public.rpc_add_shop_stock(payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_line jsonb;
  v_imei text;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_array_elements(payload->'lines')
  LOOP
    -- Record stock movement
    INSERT INTO public.stock_movements (
      product_id,
      from_location,
      to_location,
      qty,
      type,
      unit_cost,
      ref_type,
      user_name,
      note
    ) VALUES (
      (v_line->>'productId')::bigint,
      NULL,
      'SHOP',
      (v_line->>'qty')::int,
      'PURCHASE',
      (v_line->>'unitCost')::bigint,
      'stock-in',
      payload->>'userName',
      'Direct stock in to Shop'
    );

    -- If new IMEIs, insert into inventory_units
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
          'IN_SHOP'
        ) ON CONFLICT (imei) DO UPDATE SET status = 'IN_SHOP', updated_at = now();
      END LOOP;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

