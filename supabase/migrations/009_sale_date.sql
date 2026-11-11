-- Sale date: rpc_complete_sale accepts an optional payload.soldAt so a past sale is recorded on its real day.
-- Run once in the Supabase SQL editor. Clients that send no soldAt keep today's behaviour.

create or replace function public.rpc_complete_sale(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_name text; v_sale_id bigint; v_line jsonb; v_pay jsonb; v_prod record;
  v_pid bigint; v_qty int; v_price bigint; v_imei text; v_subtotal bigint := 0; v_discount bigint;
  v_total bigint; v_paid bigint := 0; v_status public.sale_status; v_max_pct int; v_cust bigint;
  v_due date; v_receipt text; v_key text; v_i int := 0; v_existing bigint; v_amt bigint; v_at timestamptz;
begin
  perform public._require_staff();
  v_name := public._actor_name();
  v_key  := nullif(trim(coalesce(payload->>'key','')), '');
  if v_key is not null then
    select sale_id into v_existing from public.payments where idempotency_key = v_key || ':0';
    if v_existing is not null then
      select receipt_no into v_receipt from public.sales where id = v_existing;
      return jsonb_build_object('saleId', v_existing, 'receiptNo', v_receipt, 'duplicate', true);
    end if;
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'Hakuna bidhaa kwenye mauzo';
  end if;
  v_discount := coalesce((payload->>'discount')::bigint, 0);
  v_cust := nullif(payload->>'customerId','')::bigint;
  v_due  := nullif(payload->>'dueDate','')::date;
  -- A past sale carries soldAt (midday of that day, Dar es Salaam). Nothing may be dated in the future.
  v_at := coalesce(nullif(payload->>'soldAt','')::timestamptz, now());
  if v_at > now() + interval '1 hour' then raise exception 'Tarehe ya mauzo haiwezi kuwa ya kesho'; end if;

  insert into public.sales (receipt_no, user_name, user_id, customer_id, subtotal, discount, total, status, created_at)
  values ('tmp-' || gen_random_uuid()::text, v_name, v_uid, v_cust, 0, 0, 0, 'PAID', v_at) returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_pid := (v_line->>'productId')::bigint;
    v_qty := (v_line->>'qty')::int;
    v_price := (v_line->>'unitPrice')::bigint;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then raise exception 'Idadi au bei si sahihi'; end if;
    select * into v_prod from public.products where id = v_pid for update;
    if not found then raise exception 'Bidhaa haipo'; end if;
    v_imei := nullif(trim(coalesce(v_line->>'imei','')), '');
    if v_prod.archived then raise exception '%: bidhaa imestaafishwa, haiuzwi tena', v_prod.name; end if;
    if public._loc_qty(v_pid, 'SHOP') < v_qty then raise exception '%: stock ya dukani haitoshi', v_prod.name; end if;
    if v_prod.type = 'phone' and v_imei is not null then
      if v_qty <> 1 then raise exception '%: simu yenye IMEI inauzwa moja moja', v_prod.name; end if;
      update public.inventory_units set status = 'SOLD', updated_at = now()
       where imei = v_imei and product_id = v_pid and status = 'IN_SHOP';
      if not found then raise exception 'IMEI % haipo dukani', v_imei; end if;
    else
      v_imei := null;
    end if;
    insert into public.sale_items (sale_id, product_id, name, qty, unit_price, unit_cost, imei)
    values (v_sale_id, v_pid, v_prod.name, v_qty, v_price, v_prod.cost_price, v_imei);
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, ref_id, user_name, note, created_at)
    values (v_pid, 'SHOP', null, v_qty, 'SALE', v_prod.cost_price, 'sale', v_sale_id, v_name, 'Mauzo', v_at);
    v_subtotal := v_subtotal + v_qty * v_price;
  end loop;

  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Punguzo si sahihi'; end if;
  select max_discount_pct into v_max_pct from public.settings where id = 1;
  if v_discount * 100 > v_subtotal * coalesce(v_max_pct, 0) and not public.is_owner() then
    if not public._verify_owner_pin(payload->>'ownerPin') then
      raise exception 'Punguzo linazidi kikomo. Weka PIN sahihi ya mmiliki';
    end if;
  end if;
  v_total := v_subtotal - v_discount;

  for v_pay in select * from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) loop
    v_amt := (v_pay->>'amount')::bigint;
    if v_amt is null or v_amt <= 0 then continue; end if;
    v_paid := v_paid + v_amt;
    insert into public.payments (sale_id, customer_id, method, amount, kind, user_name, reference, idempotency_key, paid_at)
    values (v_sale_id, v_cust, (v_pay->>'method')::public.payment_method, v_amt, 'SALE', v_name,
            nullif(v_pay->>'reference',''), case when v_key is null then null else v_key || ':' || v_i end, v_at);
    v_i := v_i + 1;
  end loop;
  if v_paid > v_total then raise exception 'Malipo yanazidi jumla ya mauzo'; end if;
  v_status := case when v_paid >= v_total then 'PAID' else 'PARTIAL' end;
  if v_status = 'PARTIAL' and v_cust is null then raise exception 'Deni linahitaji mteja'; end if;

  v_receipt := 'TB-' || lpad(v_sale_id::text, 6, '0');
  update public.sales set receipt_no = v_receipt, subtotal = v_subtotal, discount = v_discount, total = v_total,
         status = v_status, due_date = case when v_status = 'PARTIAL' then v_due else null end
   where id = v_sale_id;
  if v_discount * 100 > v_subtotal * coalesce(v_max_pct, 0) then
    insert into public.audit_logs (user_name, action, subject_id, detail)
    values (v_name, 'DISCOUNT_OVER_LIMIT', v_sale_id::text, v_receipt || ': punguzo ' || v_discount || ' la ' || v_subtotal);
  end if;
  if v_at < now() - interval '1 day' then
    insert into public.audit_logs (user_name, action, subject_id, detail)
    values (v_name, 'SALE_BACKDATED', v_sale_id::text, v_receipt || ': mauzo yameandikwa kwa tarehe ' || to_char(v_at at time zone 'Africa/Dar_es_Salaam', 'DD/MM/YYYY'));
  end if;
  return jsonb_build_object('saleId', v_sale_id, 'receiptNo', v_receipt, 'duplicate', false);
end $$;
