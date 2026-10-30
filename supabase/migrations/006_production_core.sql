-- ==========================================================
-- THE BEST POS - 006: Supabase kama chanzo pekee cha data
--  * RPC zote zinakagua mtumiaji (hakuna tena anon)
--  * Stock, IMEI, bei na punguzo vinathibitishwa kwenye seva
--  * Bei za kununua zinaonekana kwa mmiliki tu
--  * Signup imezimwa (watumiaji wanaundwa na mmiliki kupitia rpc_create_user)
-- ==========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Helpers ----------
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner' and is_active = true);
$$;

create or replace function public._require_staff()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Huna ruhusa. Ingia tena.' using errcode = '42501';
  end if;
end $$;

create or replace function public._require_owner()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Mmiliki tu ndiye anaweza kufanya hivi' using errcode = '42501';
  end if;
end $$;

create or replace function public._actor_name()
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = auth.uid();
$$;

create or replace function public._loc_qty(p_id bigint, p_loc public.stock_location)
returns int language sql stable security definer set search_path = public as $$
  select case when p.type = 'phone' then
           (select count(*) from public.inventory_units u
             where u.product_id = p.id and u.status = (case when p_loc = 'STORE' then 'IN_STORE' else 'IN_SHOP' end)::public.unit_status)::int
         else
           coalesce((select sum(case when m.to_location = p_loc then m.qty else 0 end)
                          - sum(case when m.from_location = p_loc then m.qty else 0 end)
                       from public.stock_movements m where m.product_id = p.id), 0)::int
         end
  from public.products p where p.id = p_id;
$$;

create or replace function public._verify_owner_pin(p_pin text)
returns boolean language sql stable security definer set search_path = public, auth, extensions as $$
  select exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
     where p.role = 'owner' and p.is_active
       and u.encrypted_password = extensions.crypt('pin_' || coalesce(p_pin, ''), u.encrypted_password)
  );
$$;

-- ---------- Schema tweaks ----------
alter table public.purchases alter column supplier_id drop not null;
alter table public.profiles drop column if exists pin_hash;

-- ---------- Views (hakuna cost_price) ----------
drop view if exists public.products_view;
create view public.products_view with (security_invoker = true) as
select p.id, p.name, p.detail, p.type, p.code, p.barcode, p.sell_price, p.min_stock, p.image_url, p.created_at, p.updated_at,
  public._loc_qty(p.id, 'STORE') as store_qty,
  public._loc_qty(p.id, 'SHOP')  as shop_qty
from public.products p;

-- ---------- Product RPCs ----------
drop function if exists public.rpc_create_product(jsonb);
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
    for v_imei in select jsonb_array_elements_text(payload->'imeis') loop
      insert into public.inventory_units (imei, product_id, status)
      values (v_imei, v_id, case when v_loc = 'STORE' then 'IN_STORE' else 'IN_SHOP' end::public.unit_status);
    end loop;
  end if;
  return v_id;
end $$;

drop function if exists public.rpc_update_product(jsonb);
create or replace function public.rpc_update_product(payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  update public.products set
    name = trim(payload->>'name'), detail = coalesce(payload->>'detail', ''),
    type = (payload->>'type')::public.product_type, code = upper(trim(payload->>'code')),
    barcode = nullif(trim(coalesce(payload->>'barcode','')), ''),
    cost_price = (payload->>'costPrice')::bigint, sell_price = (payload->>'sellPrice')::bigint,
    min_stock = (payload->>'minStock')::int, image_url = nullif(payload->>'imageUrl',''), updated_at = now()
  where id = (payload->>'id')::bigint;
  if not found then raise exception 'Bidhaa haipo'; end if;
  return true;
end $$;

drop function if exists public.rpc_delete_product(bigint);
create or replace function public.rpc_delete_product(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  if exists (select 1 from public.sale_items where product_id = p_id) then
    raise exception 'Bidhaa hii ina historia ya mauzo, haiwezi kufutwa';
  end if;
  delete from public.inventory_units where product_id = p_id;
  delete from public.stock_movements where product_id = p_id;
  delete from public.products where id = p_id;
  return true;
end $$;

drop function if exists public.rpc_update_product_image(bigint, text);
create or replace function public.rpc_update_product_image(p_id bigint, p_image_url text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  update public.products set image_url = nullif(p_image_url,''), updated_at = now() where id = p_id;
  return found;
end $$;

-- ---------- Sale ----------
drop function if exists public.rpc_complete_sale(jsonb);
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
    if v_prod.type = 'phone' then
      if v_imei is null or v_qty <> 1 then raise exception '%: simu inauzwa kwa IMEI moja', v_prod.name; end if;
      update public.inventory_units set status = 'SOLD', updated_at = now()
       where imei = v_imei and product_id = v_pid and status = 'IN_SHOP';
      if not found then raise exception 'IMEI % haipo dukani', v_imei; end if;
    else
      v_imei := null;
      if public._loc_qty(v_pid, 'SHOP') < v_qty then raise exception '%: stock ya dukani haitoshi', v_prod.name; end if;
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

-- ---------- Debt payment ----------
drop function if exists public.rpc_pay_debt(jsonb);
create or replace function public.rpc_pay_debt(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sale record; v_amount bigint; v_key text; v_pid bigint; v_eff bigint; v_paid bigint; v_left bigint;
  v_at timestamptz; v_name text;
begin
  perform public._require_staff();
  v_name := public._actor_name();
  v_amount := (payload->>'amount')::bigint;
  v_key := nullif(trim(coalesce(payload->>'key','')), '');
  if v_key is not null then
    select id into v_pid from public.payments where idempotency_key = v_key;
    if v_pid is not null then
      return jsonb_build_object('saleId', (payload->>'saleId')::bigint, 'paymentId', v_pid, 'left', 0, 'duplicate', true);
    end if;
  end if;
  select * into v_sale from public.sales where id = (payload->>'saleId')::bigint for update;
  if not found then raise exception 'Mauzo hayajapatikana'; end if;
  if v_sale.status = 'VOID' then raise exception 'Mauzo haya yamefutwa'; end if;
  select v_sale.total - coalesce((select sum(value) from public.sale_returns where sale_id = v_sale.id), 0) into v_eff;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = v_sale.id;
  if v_amount is null or v_amount <= 0 then raise exception 'Weka kiasi sahihi'; end if;
  if v_amount > greatest(0, v_eff - v_paid) then raise exception 'Kiasi kinazidi deni lililobaki'; end if;
  v_at := coalesce(nullif(payload->>'paidAt','')::timestamptz, now());
  if v_at > now() + interval '1 hour' then raise exception 'Tarehe haiwezi kuwa ya baadaye'; end if;

  insert into public.payments (sale_id, customer_id, method, amount, kind, user_name, reference, idempotency_key, paid_at)
  values (v_sale.id, v_sale.customer_id, (payload->>'method')::public.payment_method, v_amount, 'DEBT', v_name,
          nullif(payload->>'reference',''), v_key, v_at) returning id into v_pid;
  v_left := greatest(0, v_eff - (v_paid + v_amount));
  update public.sales set status = case when v_left = 0 then 'PAID' else 'PARTIAL' end::public.sale_status,
         due_date = case when v_left = 0 then null else due_date end where id = v_sale.id;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (v_name, 'DEBT_PAYMENT', v_sale.id::text, v_sale.receipt_no || ': TSh ' || v_amount || ' (' || (payload->>'method') || '), balance ' || v_left);
  return jsonb_build_object('saleId', v_sale.id, 'paymentId', v_pid, 'left', v_left, 'duplicate', false);
end $$;

-- ---------- Void / return ----------
create or replace function public._sale_item_ids(p_sale bigint) returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by id), '{}') from public.sale_items where sale_id = p_sale;
$$;

create or replace function public.rpc_void_sale(payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sale record; v_ids bigint[]; v_it jsonb; v_si record; v_name text; v_refund bigint;
begin
  perform public._require_owner();
  v_name := public._actor_name();
  select * into v_sale from public.sales where id = (payload->>'saleId')::bigint for update;
  if not found then raise exception 'Mauzo hayajapatikana'; end if;
  if v_sale.status = 'VOID' then raise exception 'Mauzo haya yamefutwa tayari'; end if;
  if length(trim(coalesce(payload->>'reason',''))) < 3 then raise exception 'Andika sababu ya kufuta mauzo'; end if;
  v_ids := public._sale_item_ids(v_sale.id);
  for v_it in select * from jsonb_array_elements(coalesce(payload->'restock', '[]'::jsonb)) loop
    select * into v_si from public.sale_items where id = v_ids[(v_it->>'lineIndex')::int + 1];
    if not found then raise exception 'Bidhaa haipo kwenye mauzo haya'; end if;
    if v_si.imei is not null then
      update public.inventory_units set status = 'IN_SHOP', updated_at = now() where imei = v_si.imei;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
    values (v_si.product_id, null, 'SHOP', (v_it->>'qty')::int, 'RETURN', 'sale', v_sale.id, v_name, 'Mauzo yamefutwa');
  end loop;
  v_refund := coalesce((payload->>'refund')::bigint, 0);
  if v_refund > 0 then
    insert into public.payments (sale_id, customer_id, method, amount, kind, user_name)
    values (v_sale.id, v_sale.customer_id, (payload->>'refundMethod')::public.payment_method, -v_refund, 'REFUND', v_name);
  end if;
  update public.sales set status = 'VOID', due_date = null, voided_by = v_name,
         void_reason = trim(payload->>'reason'), voided_at = now() where id = v_sale.id;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (v_name, 'SALE_VOID', v_sale.id::text, v_sale.receipt_no || ': ' || trim(payload->>'reason') || ' (refund ' || v_refund || ')');
  return true;
end $$;

create or replace function public.rpc_return_items(payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sale record; v_ids bigint[]; v_it jsonb; v_si record; v_name text; v_refund bigint; v_value bigint;
  v_cond text; v_eff bigint; v_paid bigint; v_open boolean; v_qty int;
begin
  perform public._require_staff();
  v_name := public._actor_name();
  select * into v_sale from public.sales where id = (payload->>'saleId')::bigint for update;
  if not found then raise exception 'Mauzo hayajapatikana'; end if;
  if v_sale.status = 'VOID' then raise exception 'Mauzo haya yamefutwa tayari'; end if;
  if length(trim(coalesce(payload->>'reason',''))) < 3 then raise exception 'Andika sababu ya kurudisha'; end if;
  v_cond := payload->>'condition';
  if v_cond not in ('RESTOCK','DAMAGED') then raise exception 'Hali ya bidhaa si sahihi'; end if;
  v_ids := public._sale_item_ids(v_sale.id);
  for v_it in select * from jsonb_array_elements(payload->'items') loop
    select * into v_si from public.sale_items where id = v_ids[(v_it->>'lineIndex')::int + 1] for update;
    if not found then raise exception 'Bidhaa haipo kwenye mauzo haya'; end if;
    v_qty := (v_it->>'qty')::int;
    if v_qty < 1 or v_qty > v_si.qty - v_si.returned_qty then raise exception 'Unaweza kurudisha % tu', v_si.qty - v_si.returned_qty; end if;
    update public.sale_items set returned_qty = returned_qty + v_qty where id = v_si.id;
    if v_si.imei is not null then
      update public.inventory_units set status = case when v_cond = 'RESTOCK' then 'IN_SHOP' else 'DAMAGED' end::public.unit_status, updated_at = now()
       where imei = v_si.imei;
    end if;
    if v_cond = 'RESTOCK' then
      insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
      values (v_si.product_id, null, 'SHOP', v_qty, 'RETURN', 'sale', v_sale.id, v_name, 'Bidhaa imerudishwa');
    end if;
  end loop;
  v_value := coalesce((payload->>'value')::bigint, 0);
  v_refund := coalesce((payload->>'refund')::bigint, 0);
  insert into public.sale_returns (sale_id, by_user, reason, condition, value, refund_amount, items)
  values (v_sale.id, v_name, trim(payload->>'reason'), v_cond, v_value, v_refund, payload->'items');
  if v_refund > 0 then
    insert into public.payments (sale_id, customer_id, method, amount, kind, user_name)
    values (v_sale.id, v_sale.customer_id, (payload->>'refundMethod')::public.payment_method, -v_refund, 'REFUND', v_name);
  end if;
  select v_sale.total - coalesce(sum(value), 0) into v_eff from public.sale_returns where sale_id = v_sale.id;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = v_sale.id;
  v_open := v_eff - v_paid > 0;
  update public.sales set status = case when v_open then 'PARTIAL' else 'PAID' end::public.sale_status,
         due_date = case when v_open then due_date else null end where id = v_sale.id;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (v_name, 'SALE_RETURN', v_sale.id::text, v_sale.receipt_no || ': ' || trim(payload->>'reason') || ' (value ' || v_value || ', refund ' || v_refund || ', ' || v_cond || ')');
  return true;
end $$;

-- ---------- Stock ----------
drop function if exists public.rpc_create_transfer(jsonb);
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
    if v_prod.type = 'phone' then
      v_n := 0;
      for v_imei in select jsonb_array_elements_text(coalesce(v_line->'imeis','[]'::jsonb)) loop
        update public.inventory_units set status = 'IN_SHOP', updated_at = now()
         where imei = v_imei and product_id = v_pid and status = 'IN_STORE';
        if not found then raise exception 'IMEI % haipo store', v_imei; end if;
        v_n := v_n + 1;
      end loop;
      if v_n <> v_qty then raise exception '%: chagua IMEI % kamili', v_prod.name, v_qty; end if;
    elsif public._loc_qty(v_pid, 'STORE') < v_qty then
      raise exception '%: stock ya store haitoshi', v_prod.name;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
    values (v_pid, 'STORE', 'SHOP', v_qty, 'TRANSFER', 'transfer', v_id, v_name, coalesce(nullif(payload->>'note',''), 'Store kwenda Duka'));
  end loop;
  return v_id;
end $$;

drop function if exists public.rpc_add_shop_stock(jsonb);
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
      if v_n <> v_qty then raise exception '%: weka IMEI % kamili', v_prod.name, v_qty; end if;
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, user_name, note)
    values (v_pid, null, v_loc, v_qty, 'PURCHASE', v_cost, 'stock-in', v_name, 'Stock imeongezwa moja kwa moja');
    if v_cost <> v_prod.cost_price then update public.products set cost_price = v_cost, updated_at = now() where id = v_pid; end if;
  end loop;
  return true;
end $$;

drop function if exists public.rpc_create_purchase(jsonb);
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
      if v_n <> v_qty then raise exception '%: weka IMEI % kamili', v_prod.name, v_qty; end if;
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

-- ---------- Close day / stock take ----------
drop function if exists public.rpc_close_day(jsonb);
create or replace function public.rpc_close_day(payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (payload->>'date')::date; v_counted bigint := (payload->>'counted')::bigint;
  v_sales bigint; v_debt bigint; v_ref bigint; v_exp bigint; v_expected bigint; v_id bigint;
begin
  perform public._require_staff();
  if v_counted is null or v_counted < 0 then raise exception 'Weka kiasi cha cash ulichohesabu'; end if;
  if exists (select 1 from public.cash_closings where closing_date = v_date) then raise exception 'Siku hii imeshafungwa tayari'; end if;
  select coalesce(sum(amount),0) into v_sales from public.payments
   where method='CASH' and kind='SALE' and (paid_at at time zone 'Africa/Dar_es_Salaam')::date = v_date;
  select coalesce(sum(amount),0) into v_debt from public.payments
   where method='CASH' and kind='DEBT' and (paid_at at time zone 'Africa/Dar_es_Salaam')::date = v_date;
  select coalesce(sum(abs(amount)),0) into v_ref from public.payments
   where method='CASH' and kind='REFUND' and (paid_at at time zone 'Africa/Dar_es_Salaam')::date = v_date;
  select coalesce(sum(amount),0) into v_exp from public.expenses where method='CASH' and spent_on = v_date;
  v_expected := v_sales + v_debt - v_ref - v_exp;
  insert into public.cash_closings (closing_date, user_name, cash_sales, cash_debt_payments, cash_refunds, cash_expenses,
                                    expected_cash, counted_cash, difference, note)
  values (v_date, public._actor_name(), v_sales, v_debt, v_ref, v_exp, v_expected, v_counted, v_counted - v_expected,
          coalesce(payload->>'note','')) returning id into v_id;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (public._actor_name(), 'CASH_CLOSING', v_id::text,
          v_date || ': inatarajiwa ' || v_expected || ', imehesabiwa ' || v_counted || ', tofauti ' || (v_counted - v_expected));
  return v_id;
end $$;

create or replace function public.rpc_submit_stock_take(payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public._require_staff();
  insert into public.stock_takes (location, status, created_by, lines)
  values ((payload->>'location')::public.stock_location, 'SUBMITTED', public._actor_name(), payload->'lines')
  returning id into v_id;
  return v_id;
end $$;

drop function if exists public.rpc_approve_stock_take(jsonb);
create or replace function public.rpc_approve_stock_take(payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_take record; v_adj jsonb; v_delta int; v_pid bigint; v_imei text; v_name text; v_n int := 0;
begin
  perform public._require_owner();
  v_name := public._actor_name();
  select * into v_take from public.stock_takes where id = (payload->>'takeId')::bigint for update;
  if not found then raise exception 'Hesabu haipatikani'; end if;
  if v_take.status = 'APPROVED' then raise exception 'Hesabu hii imeshaidhinishwa'; end if;
  for v_adj in select * from jsonb_array_elements(coalesce(payload->'adjustments','[]'::jsonb)) loop
    v_pid := (v_adj->>'productId')::bigint; v_delta := (v_adj->>'delta')::int;
    if v_delta = 0 then continue; end if;
    if v_delta < 0 and public._loc_qty(v_pid, v_take.location) < abs(v_delta) then
      raise exception 'Stock imebadilika, hesabu upya';
    end if;
    insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
    values (v_pid, case when v_delta < 0 then v_take.location end, case when v_delta > 0 then v_take.location end,
            abs(v_delta), 'ADJUSTMENT', 'stock_take', v_take.id, v_name, coalesce(v_adj->>'note','Marekebisho ya hesabu'));
    for v_imei in select jsonb_array_elements_text(coalesce(v_adj->'missingImeis','[]'::jsonb)) loop
      update public.inventory_units set status = 'DAMAGED', updated_at = now() where imei = v_imei and product_id = v_pid;
    end loop;
    v_n := v_n + 1;
  end loop;
  update public.stock_takes set status = 'APPROVED', approved_by = v_name, approved_at = now() where id = v_take.id;
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (v_name, 'STOCK_TAKE_APPROVED', v_take.id::text, v_take.location || ': marekebisho ' || v_n);
  return true;
end $$;

-- ---------- Owner-only reads ----------
create or replace function public.rpc_owner_costs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_owner();
  return jsonb_build_object(
    'products',  (select coalesce(jsonb_agg(jsonb_build_array(id, cost_price)), '[]'::jsonb) from public.products),
    'saleItems', (select coalesce(jsonb_agg(jsonb_build_array(id, unit_cost)), '[]'::jsonb) from public.sale_items));
end $$;

create or replace function public.rpc_purchases() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner boolean;
begin
  perform public._require_staff();
  v_owner := public.is_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'supplierId', p.supplier_id, 'location', p.location, 'invoiceNo', p.invoice_no,
      'date', p.purchase_date, 'total', case when v_owner then p.total else 0 end, 'userName', p.user_name,
      'lines', case when v_owner then p.lines
                    else (select coalesce(jsonb_agg(l - 'unitCost'), '[]'::jsonb) from jsonb_array_elements(p.lines) l) end
    ) order by p.id), '[]'::jsonb) from public.purchases p);
end $$;

create or replace function public.rpc_verify_owner_pin(p_pin text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_staff();
  return public._verify_owner_pin(p_pin);
end $$;

-- ---------- Users (mmiliki tu) ----------
create or replace function public.rpc_create_user(payload jsonb) returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_id uuid := gen_random_uuid(); v_phone text := payload->>'phone'; v_email text;
begin
  perform public._require_owner();
  v_email := v_phone || '@thebest.pos';
  if exists (select 1 from public.profiles where phone = v_phone) then raise exception 'Namba hii tayari inatumika na mtumiaji mwingine'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt('pin_' || (payload->>'password'), extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', payload->>'name', 'phone', v_phone),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());
  insert into public.profiles (id, phone, full_name, role, is_active)
  values (v_id, v_phone, trim(payload->>'name'), (payload->>'role')::public.user_role, coalesce((payload->>'isActive')::boolean, true));
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (public._actor_name(), 'USER_CREATE', v_id::text, trim(payload->>'name') || ' (' || (payload->>'role') || ')');
  return v_id;
end $$;

create or replace function public.rpc_update_user(payload jsonb) returns boolean
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := (payload->>'id')::uuid; v_old record; v_phone text := payload->>'phone';
  v_role public.user_role := (payload->>'role')::public.user_role; v_active boolean := coalesce((payload->>'isActive')::boolean, true);
begin
  perform public._require_owner();
  select * into v_old from public.profiles where id = v_id;
  if not found then raise exception 'Mtumiaji hajapatikana'; end if;
  if exists (select 1 from public.profiles where phone = v_phone and id <> v_id) then raise exception 'Namba hii tayari inatumika na mtumiaji mwingine'; end if;
  if v_id = auth.uid() and not v_active then raise exception 'Huwezi kuzima akaunti yako mwenyewe'; end if;
  if v_old.role = 'owner' and (v_role <> 'owner' or not v_active)
     and not exists (select 1 from public.profiles where role = 'owner' and is_active and id <> v_id) then
    raise exception 'Lazima abaki mmiliki mmoja mwenye akaunti hai';
  end if;
  update public.profiles set phone = v_phone, full_name = trim(payload->>'name'), role = v_role, is_active = v_active, updated_at = now() where id = v_id;
  update auth.users set email = v_phone || '@thebest.pos', updated_at = now(),
         encrypted_password = case when coalesce(payload->>'password','') <> '' then extensions.crypt('pin_' || (payload->>'password'), extensions.gen_salt('bf')) else encrypted_password end
   where id = v_id;
  update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_phone || '@thebest.pos')), provider_id = v_id::text, updated_at = now()
   where user_id = v_id and provider = 'email';
  insert into public.audit_logs (user_name, action, subject_id, detail)
  values (public._actor_name(), 'USER_UPDATE', v_id::text, trim(payload->>'name') || ': imebadilishwa');
  return true;
end $$;

-- ---------- Privileges ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public._require_staff(), public._require_owner(), public._actor_name(),
  public._loc_qty(bigint, public.stock_location), public._verify_owner_pin(text), public._sale_item_ids(bigint) from authenticated;
grant execute on function public.is_owner() to authenticated;
-- _loc_qty is used by products_view (security invoker), so authenticated must run it
grant execute on function public._loc_qty(bigint, public.stock_location) to authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Clients hawaandiki moja kwa moja isipokuwa pale ilipoandikwa wazi
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant insert, update on public.customers to authenticated;
grant insert on public.expenses, public.audit_logs, public.sms_logs to authenticated;
grant insert on public.suppliers, public.supplier_payments to authenticated;
grant update on public.settings, public.profiles to authenticated;

-- Bei za kununua: mmiliki tu
revoke select on public.products from authenticated;
grant select (id, name, detail, type, code, barcode, sell_price, min_stock, image_url, created_at, updated_at) on public.products to authenticated;
revoke select on public.sale_items from authenticated;
grant select (id, sale_id, product_id, name, qty, unit_price, imei, returned_qty, created_at) on public.sale_items to authenticated;
revoke select on public.stock_movements from authenticated;
grant select (id, product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note, created_at) on public.stock_movements to authenticated;
revoke select on public.purchases from authenticated;

-- ---------- RLS ----------
drop policy if exists "Users can update own profile" on public.profiles;

drop policy if exists "Users can manage suppliers" on public.suppliers;
create policy "Staff read suppliers" on public.suppliers for select to authenticated using (true);
create policy "Owner add suppliers" on public.suppliers for insert to authenticated with check (public.is_owner());

drop policy if exists "Users can manage supplier payments" on public.supplier_payments;
create policy "Owner read supplier payments" on public.supplier_payments for select to authenticated using (public.is_owner());
create policy "Owner add supplier payments" on public.supplier_payments for insert to authenticated with check (public.is_owner());

drop policy if exists "Users can manage expenses" on public.expenses;
create policy "Staff read expenses" on public.expenses for select to authenticated using (public.is_owner() or spent_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date - 1);
create policy "Staff add expenses" on public.expenses for insert to authenticated with check (true);

drop policy if exists "Users can read/insert audit" on public.audit_logs;
create policy "Owner read audit" on public.audit_logs for select to authenticated using (public.is_owner());
create policy "Staff add audit" on public.audit_logs for insert to authenticated with check (true);

drop policy if exists "Users can read/insert sms" on public.sms_logs;
create policy "Owner read sms" on public.sms_logs for select to authenticated using (public.is_owner());
create policy "Staff add sms" on public.sms_logs for insert to authenticated with check (true);

drop policy if exists "Users can manage closings" on public.cash_closings;
create policy "Staff read closings" on public.cash_closings for select to authenticated using (true);
drop policy if exists "Users can manage stock takes" on public.stock_takes;
create policy "Staff read stock takes" on public.stock_takes for select to authenticated using (true);
drop policy if exists "Users can manage returns" on public.sale_returns;
create policy "Staff read returns" on public.sale_returns for select to authenticated using (true);
drop policy if exists "Users can manage transfers" on public.transfers;
create policy "Staff read transfers" on public.transfers for select to authenticated using (true);
drop policy if exists "Users can manage purchases" on public.purchases;

drop policy if exists "Authenticated users can create products" on public.products;
drop policy if exists "Users can insert/update units" on public.inventory_units;
drop policy if exists "Users can insert movements" on public.stock_movements;
drop policy if exists "Users can insert sales" on public.sales;
drop policy if exists "Users can insert sale items" on public.sale_items;
drop policy if exists "Users can update sale items" on public.sale_items;
drop policy if exists "Users can insert payments" on public.payments;
