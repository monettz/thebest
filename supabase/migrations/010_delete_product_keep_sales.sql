-- ==========================================================
-- THE BEST POS - 010: kufuta bidhaa hakufuti mauzo tena
--  * Bidhaa ikifutwa: bidhaa, IMEI zake na historia ya stock zinafutwa,
--    lakini mauzo, malipo, marejesho na madeni YANABAKI. Kila mstari wa
--    mauzo tayari una jina, bei ya kuuza na gharama yake, kwa hiyo ripoti
--    zinaendelea kuwa sahihi; mstari unabaki bila bidhaa (product_id = null).
--  * Kufuta mauzo (void) au kurudisha bidhaa ya mauzo hayo hakuongezi stock
--    ya bidhaa ambayo haipo tena (hakuna pa kuiweka).
--  * Inachukua nafasi ya 008 (iliyofuta mauzo pamoja na bidhaa).
-- Mauzo yaliyokwisha kufutwa na 008 hayarudi.
-- ==========================================================

begin;

-- 1. Mstari wa mauzo unaweza kubaki bila bidhaa.
alter table public.sale_items alter column product_id drop not null;

do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.sale_items'::regclass
       and con.contype = 'f'
       and att.attname = 'product_id'
  loop
    execute format('alter table public.sale_items drop constraint %I', c);
  end loop;
end $$;

alter table public.sale_items
  add constraint sale_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

-- 2. Kufuta bidhaa: mauzo yanabaki.
create or replace function public.rpc_delete_product(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  if not exists (select 1 from public.products where id = p_id) then
    raise exception 'Bidhaa haipo';
  end if;
  -- Mauzo yanabaki kwa jina, bei na gharama yaliyohifadhiwa kwenye mstari wenyewe.
  update public.sale_items set product_id = null where product_id = p_id;
  delete from public.inventory_units where product_id = p_id;
  delete from public.stock_movements where product_id = p_id;
  delete from public.products where id = p_id;
  return true;
end $$;

-- 3. Kufuta mauzo: stock inarudishwa kwa bidhaa zilizopo tu.
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
    if v_si.product_id is not null then
      if v_si.imei is not null then
        update public.inventory_units set status = 'IN_SHOP', updated_at = now() where imei = v_si.imei;
      end if;
      insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
      values (v_si.product_id, null, 'SHOP', (v_it->>'qty')::int, 'RETURN', 'sale', v_sale.id, v_name, 'Mauzo yamefutwa');
    end if;
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

-- 4. Kurudisha bidhaa: idadi iliyorudishwa inahesabiwa kila wakati; stock inaongezwa kwa bidhaa zilizopo tu.
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
    if v_si.product_id is not null then
      if v_si.imei is not null then
        update public.inventory_units set status = case when v_cond = 'RESTOCK' then 'IN_SHOP' else 'DAMAGED' end::public.unit_status, updated_at = now()
         where imei = v_si.imei;
      end if;
      if v_cond = 'RESTOCK' then
        insert into public.stock_movements (product_id, from_location, to_location, qty, type, ref_type, ref_id, user_name, note)
        values (v_si.product_id, null, 'SHOP', v_qty, 'RETURN', 'sale', v_sale.id, v_name, 'Bidhaa imerudishwa');
      end if;
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

commit;
