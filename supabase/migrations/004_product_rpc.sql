-- ==========================================================
-- THE BEST POS - Additional RPCs for Product Management & Operations
-- ==========================================================

-- 1. CREATE PRODUCT (Atomically creates product, initial stock movement, and units)
CREATE OR REPLACE FUNCTION public.rpc_create_product(payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product_id bigint;
  v_imei text;
  v_location public.stock_location;
  v_init_qty int;
BEGIN
  v_location := COALESCE(payload->>'location', 'SHOP')::public.stock_location;
  v_init_qty := COALESCE((payload->>'initialQty')::int, 0);

  INSERT INTO public.products (
    name,
    detail,
    type,
    code,
    barcode,
    cost_price,
    sell_price,
    min_stock,
    image_url
  ) VALUES (
    payload->>'name',
    COALESCE(payload->>'detail', ''),
    (payload->>'type')::public.product_type,
    payload->>'code',
    payload->>'barcode',
    COALESCE((payload->>'costPrice')::bigint, 0),
    COALESCE((payload->>'sellPrice')::bigint, 0),
    COALESCE((payload->>'minStock')::int, 5),
    payload->>'imageUrl'
  ) RETURNING id INTO v_product_id;

  -- Initial stock movement
  IF v_init_qty > 0 THEN
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
      v_product_id,
      NULL,
      v_location,
      v_init_qty,
      'PURCHASE',
      COALESCE((payload->>'costPrice')::bigint, 0),
      'stock-in',
      payload->>'userName',
      'Stock ya awali'
    );
  END IF;

  -- Units (if phone)
  IF payload->'imeis' IS NOT NULL AND jsonb_array_length(payload->'imeis') > 0 THEN
    FOR v_imei IN SELECT jsonb_array_elements_text(payload->'imeis')
    LOOP
      INSERT INTO public.inventory_units (
        imei,
        product_id,
        status
      ) VALUES (
        v_imei,
        v_product_id,
        CASE WHEN v_location = 'STORE' THEN 'IN_STORE'::public.unit_status ELSE 'IN_SHOP'::public.unit_status END
      );
    END LOOP;
  END IF;

  RETURN v_product_id;
END;
$$;

-- 2. UPDATE PRODUCT
CREATE OR REPLACE FUNCTION public.rpc_update_product(payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.products
  SET
    name = payload->>'name',
    detail = COALESCE(payload->>'detail', ''),
    type = (payload->>'type')::public.product_type,
    code = payload->>'code',
    barcode = payload->>'barcode',
    cost_price = (payload->>'costPrice')::bigint,
    sell_price = (payload->>'sellPrice')::bigint,
    min_stock = (payload->>'minStock')::int,
    image_url = payload->>'imageUrl',
    updated_at = now()
  WHERE id = (payload->>'id')::bigint;

  RETURN true;
END;
$$;

-- 3. DELETE PRODUCT
CREATE OR REPLACE FUNCTION public.rpc_delete_product(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.inventory_units WHERE product_id = p_id;
  DELETE FROM public.stock_movements WHERE product_id = p_id;
  DELETE FROM public.products WHERE id = p_id;
  RETURN true;
END;
$$;

-- 4. UPDATE PRODUCT IMAGE
CREATE OR REPLACE FUNCTION public.rpc_update_product_image(p_id bigint, p_image_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.products
  SET
    image_url = p_image_url,
    updated_at = now()
  WHERE id = p_id;
  RETURN true;
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.rpc_create_product(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_product(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_product(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_product_image(bigint, text) TO anon, authenticated;

