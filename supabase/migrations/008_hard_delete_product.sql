-- ==========================================================
-- THE BEST POS - 008: kufuta bidhaa kunafuta kila kitu
--  * rpc_delete_product sasa inafuta pia mauzo yake (sale_items), na
--    mauzo yaliyobaki matupu (pamoja na malipo/returns) yanafutwa pia
-- ==========================================================

create or replace function public.rpc_delete_product(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sales bigint[];
begin
  perform public._require_owner();
  select coalesce(array_agg(distinct sale_id), '{}') into v_sales from public.sale_items where product_id = p_id;
  delete from public.sale_items where product_id = p_id;
  -- mauzo yasiyo na bidhaa nyingine yanafutwa kabisa
  delete from public.sale_returns where sale_id = any(v_sales)
    and not exists (select 1 from public.sale_items i where i.sale_id = sale_returns.sale_id);
  delete from public.payments where sale_id = any(v_sales)
    and not exists (select 1 from public.sale_items i where i.sale_id = payments.sale_id);
  delete from public.sales where id = any(v_sales)
    and not exists (select 1 from public.sale_items i where i.sale_id = sales.id);
  delete from public.inventory_units where product_id = p_id;
  delete from public.stock_movements where product_id = p_id;
  delete from public.products where id = p_id;
  return true;
end $$;
