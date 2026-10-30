-- ==========================================================
-- THE BEST POS - 007: archive ya bidhaa + IMEI hiari
--  * products.archived: bidhaa inafichwa bila kupoteza historia ya mauzo
--  * Stock ya simu sasa inahesabiwa kwa idadi (movements) kama accessory;
--    IMEI ni hiari, na zile zilizowekwa zinafuatiliwa kwa kila kipande
-- ==========================================================

alter table public.products add column if not exists archived boolean not null default false;
grant select (archived) on public.products to authenticated;

create or replace function public._loc_qty(p_id bigint, p_loc public.stock_location)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when m.to_location = p_loc then m.qty else 0 end)
                        - sum(case when m.from_location = p_loc then m.qty else 0 end)
                     from public.stock_movements m where m.product_id = p_id), 0)::int;
$$;

drop view if exists public.products_view;
create view public.products_view with (security_invoker = true) as
select p.id, p.name, p.detail, p.type, p.code, p.barcode, p.sell_price, p.min_stock, p.image_url, p.created_at, p.updated_at,
  public._loc_qty(p.id, 'STORE') as store_qty,
  public._loc_qty(p.id, 'SHOP')  as shop_qty,
  p.archived
from public.products p;
revoke all on public.products_view from anon;
grant select on public.products_view to authenticated;

create or replace function public.rpc_archive_product(p_id bigint, p_archived boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  update public.products set archived = p_archived, updated_at = now() where id = p_id;
  if not found then raise exception 'Bidhaa haipo'; end if;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (public._actor_name(), 'PRODUCT_CREATE', p_id::text,
          (select name from public.products where id = p_id) || case when p_archived then ': imestaafishwa (imefichwa)' else ': imerudishwa kwenye orodha' end);
  return true;
end $$;


create or replace function public.rpc_complete_sale(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_name text; v_sale_id bigint; v_line jsonb; v_pay jsonb; v_prod record;
  v_pid bigint; v_qty int; v_price bigint; v_imei text; v_subtotal bigint := 0; v_discount bigint;
  v_total bigint; v_paid bigint := 0; v_status public.sale_status; v_max_pct int; v_cust bigint;
  v_due date; v_receipt text; v_key text; v_i int := 0; v_existing bigint; v_amt bigint;
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

  insert into public.sales (receipt_no, user_name, user_id, customer_id, subtotal, discount, total, status)
  values ('tmp-' || gen_random_uuid()::text, v_name, v_uid, v_cust, 0, 0, 0, 'PAID') returning id into v_sale_id;

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
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, ref_id, user_name, note)
    values (v_pid, 'SHOP', null, v_qty, 'SALE', v_prod.cost_price, 'sale', v_sale_id, v_name, 'Mauzo');
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
    insert into public.payments (sale_id, customer_id, method, amount, kind, user_name, reference, idempotency_key)
    values (v_sale_id, v_cust, (v_pay->>'method')::public.payment_method, v_amt, 'SALE', v_name,
            nullif(v_pay->>'reference',''), case when v_key is null then null else v_key || ':' || v_i end);
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
  return jsonb_build_object('saleId', v_sale_id, 'receiptNo', v_receipt, 'duplicate', false);
end $$;

create or replace function public.rpc_create_transfer(payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_line jsonb; v_pid bigint; v_qty int; v_imei text; v_prod record; v_name text; v_n int;
begin
  perform public._require_staff();
  v_name := public._actor_name();
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then raise exception 'Chagua bidhaa za kuhamisha'; end if;
  insert into public.transfers (user_name, note, items)
  values (v_name, coalesce(payload->>'note',''), payload->'lines') returning id into v_id;
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_pid := (v_line->>'productId')::bigint; v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = v_pid for update;
    if not found then raise exception 'Bidhaa haipo'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Idadi si sahihi'; end if;
    if public._loc_qty(v_pid, 'STORE') < v_qty then raise exception '%: stock ya store haitoshi', v_prod.name; end if;
    if v_prod.type = 'phone' then
      v_n := 0;
      for v_imei in select jsonb_array_elements_text(coalesce(v_line->'imeis','[]'::jsonb)) loop
        update public.inventory_units set status = 'IN_SHOP', updated_at = now()
         where imei = v_imei and product_id = v_pid and status = 'IN_STORE';
        if not found then raise exception 'IMEI % haipo store', v_imei; end if;
        v_n := v_n + 1;
      end loop;
      if v_n > v_qty then raise exception '%: IMEI ni nyingi kuliko idadi %', v_prod.name, v_qty; end if;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
    values (v_pid, 'STORE', 'SHOP', v_qty, 'TRANSFER', 'transfer', v_id, v_name, coalesce(nullif(payload->>'note',''), 'Store kwenda Duka'));
  end loop;
  return v_id;
end $$;

create or replace function public.rpc_add_shop_stock(payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_line jsonb; v_pid bigint; v_qty int; v_cost bigint; v_prod record; v_imei text; v_n int;
  v_loc public.stock_location; v_name text;
begin
  perform public._require_staff();
  v_name := public._actor_name();
  v_loc := coalesce(payload->>'location','SHOP')::public.stock_location;
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_pid := (v_line->>'productId')::bigint; v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = v_pid for update;
    if not found then raise exception 'Bidhaa haipo'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Idadi si sahihi'; end if;
    v_cost := case when public.is_owner() and coalesce((v_line->>'unitCost')::bigint, 0) > 0
                   then (v_line->>'unitCost')::bigint else v_prod.cost_price end;
    if v_prod.type = 'phone' then
      v_n := 0;
      for v_imei in select jsonb_array_elements_text(coalesce(v_line->'imeis','[]'::jsonb)) loop
        insert into public.inventory_units (imei, product_id, status)
        values (v_imei, v_pid, case when v_loc = 'STORE' then 'IN_STORE' else 'IN_SHOP' end::public.unit_status);
        v_n := v_n + 1;
      end loop;
      if v_n > v_qty then raise exception '%: IMEI ni nyingi kuliko idadi %', v_prod.name, v_qty; end if;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, user_name, note)
    values (v_pid, null, v_loc, v_qty, 'PURCHASE', v_cost, 'stock-in', v_name, 'Stock imeongezwa moja kwa moja');
    if v_cost <> v_prod.cost_price then update public.products set cost_price = v_cost, updated_at = now() where id = v_pid; end if;
  end loop;
  return true;
end $$;

create or replace function public.rpc_create_purchase(payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_line jsonb; v_pid bigint; v_qty int; v_cost bigint; v_prod record; v_imei text; v_n int;
  v_loc public.stock_location; v_sup bigint; v_owner boolean; v_total bigint := 0; v_lines jsonb := '[]'::jsonb;
  v_paid bigint; v_name text;
begin
  perform public._require_staff();
  v_name := public._actor_name(); v_owner := public.is_owner();
  v_loc := coalesce(payload->>'location','STORE')::public.stock_location;
  v_sup := nullif(payload->>'supplierId','')::bigint;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then raise exception 'Weka bidhaa angalau moja'; end if;
  insert into public.purchases (supplier_id, location, invoice_no, purchase_date, total, user_name, lines)
  values (v_sup, v_loc, trim(coalesce(payload->>'invoiceNo','')), (payload->>'date')::date, 0, v_name, '[]') returning id into v_id;
  for v_line in select * from jsonb_array_elements(payload->'lines') loop
    v_pid := (v_line->>'productId')::bigint; v_qty := (v_line->>'qty')::int;
    select * into v_prod from public.products where id = v_pid for update;
    if not found then raise exception 'Bidhaa haipo'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Idadi si sahihi'; end if;
    v_cost := case when v_owner and coalesce((v_line->>'unitCost')::bigint, 0) > 0
                   then (v_line->>'unitCost')::bigint else v_prod.cost_price end;
    if v_prod.type = 'phone' then
      v_n := 0;
      for v_imei in select jsonb_array_elements_text(coalesce(v_line->'imeis','[]'::jsonb)) loop
        insert into public.inventory_units (imei, product_id, status)
        values (v_imei, v_pid, case when v_loc = 'STORE' then 'IN_STORE' else 'IN_SHOP' end::public.unit_status);
        v_n := v_n + 1;
      end loop;
      if v_n > v_qty then raise exception '%: IMEI ni nyingi kuliko idadi %', v_prod.name, v_qty; end if;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, ref_id, user_name, note)
    values (v_pid, null, v_loc, v_qty, 'PURCHASE', v_cost, 'purchase', v_id, v_name, 'Mzigo ' || coalesce(payload->>'invoiceNo',''));
    if v_cost <> v_prod.cost_price then update public.products set cost_price = v_cost, updated_at = now() where id = v_pid; end if;
    v_total := v_total + v_qty * v_cost;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('productId', v_pid, 'name', v_prod.name, 'qty', v_qty, 'unitCost', v_cost));
  end loop;
  update public.purchases set total = v_total, lines = v_lines where id = v_id;
  v_paid := case when v_owner then coalesce((payload->>'paidNow')::bigint, 0) else 0 end;
  if v_paid > v_total then raise exception 'Malipo yanazidi jumla ya mzigo'; end if;
  if v_paid > 0 and v_sup is not null then
    insert into public.supplier_payments (supplier_id, purchase_id, amount, method, user_name)
    values (v_sup, v_id, v_paid, (payload->>'method')::public.payment_method, v_name);
  end if;
  return v_id;
end $$;

create or replace function public.rpc_create_product(payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_imei text; v_loc public.stock_location; v_qty int; v_cost bigint;
  v_type public.product_type;
begin
  perform public._require_staff();
  v_loc  := coalesce(payload->>'location', 'SHOP')::public.stock_location;
  v_qty  := coalesce((payload->>'initialQty')::int, 0);
  v_type := (payload->>'type')::public.product_type;
  v_cost := case when public.is_owner() then coalesce((payload->>'costPrice')::bigint, 0) else 0 end;

  insert into public.products (name, detail, type, code, barcode, cost_price, sell_price, min_stock, image_url)
  values (trim(payload->>'name'), coalesce(payload->>'detail', ''), v_type, upper(trim(payload->>'code')),
          nullif(trim(coalesce(payload->>'barcode','')), ''), v_cost,
          (payload->>'sellPrice')::bigint, coalesce((payload->>'minStock')::int, 5), nullif(payload->>'imageUrl',''))
  returning id into v_id;

  if v_qty > 0 then
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, user_name, note)
    values (v_id, null, v_loc, v_qty, 'PURCHASE', v_cost, 'stock-in', public._actor_name(), 'Stock ya awali');
  end if;

  if v_type = 'phone' and jsonb_typeof(payload->'imeis') = 'array' then
    if jsonb_array_length(payload->'imeis') > v_qty then raise exception 'IMEI ni nyingi kuliko idadi %', v_qty; end if;
    for v_imei in select jsonb_array_elements_text(payload->'imeis') loop
      insert into public.inventory_units (imei, product_id, status)
      values (v_imei, v_id, case when v_loc = 'STORE' then 'IN_STORE' else 'IN_SHOP' end::public.unit_status);
    end loop;
  end if;
  return v_id;
end $$;


grant execute on function public.rpc_archive_product(bigint, boolean) to authenticated, service_role;
revoke execute on function public.rpc_archive_product(bigint, boolean) from public, anon;
