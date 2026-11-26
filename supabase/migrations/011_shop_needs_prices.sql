-- ==========================================================
-- THE BEST POS - 011: bei ni hiari Store, lazima Dukani
--  * Bidhaa inaweza kukaa Store bila bei ya kununua/kuuza (0 = haijawekwa).
--  * Stock ikiingia Dukani (uhamisho Store -> Duka, kuongeza moja kwa moja, mzigo wa Duka, bidhaa mpya ya Duka)
--    bidhaa lazima iwe na bei ya kuuza na ya kununua: Duka linauza, na faida inahitaji gharama.
--  * Bidhaa yenye stock Dukani: bei zake haziwezi kuondolewa (kuwekwa 0).
--  * Bidhaa isiyo na bei ya kuuza haiuzwi.
--  * rpc_set_product_prices: kuweka bei wakati wa kuhamisha (bei ya kununua: mmiliki tu).
-- Sheria hizi ziko kwenye triggers, kwa hiyo zinalinda kila kazi inayoingiza stock Dukani.
-- ==========================================================

begin;

-- 1. Stock ikiingia Dukani: bei zote mbili zinahitajika.
create or replace function public._trg_shop_stock_needs_prices() returns trigger
language plpgsql set search_path = public as $$
declare v_prod record;
begin
  if new.to_location = 'SHOP' and new.type in ('TRANSFER', 'PURCHASE') then
    select name, sell_price, cost_price into v_prod from public.products where id = new.product_id;
    if coalesce(v_prod.sell_price, 0) <= 0 then
      raise exception '%: weka bei ya kuuza kabla ya kuweka bidhaa Dukani', v_prod.name;
    end if;
    -- A purchase carries its own unit cost (the product's buying price is updated right after).
    if coalesce(new.unit_cost, 0) <= 0 and coalesce(v_prod.cost_price, 0) <= 0 then
      raise exception '%: weka bei ya kununua kabla ya kuweka bidhaa Dukani', v_prod.name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists shop_stock_needs_prices on public.stock_movements;
create trigger shop_stock_needs_prices before insert on public.stock_movements
  for each row execute function public._trg_shop_stock_needs_prices();

-- 2. Bidhaa yenye stock Dukani: bei haziwezi kuondolewa.
create or replace function public._trg_shop_prices_stay() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.sell_price is distinct from old.sell_price or new.cost_price is distinct from old.cost_price)
     and (coalesce(new.sell_price, 0) <= 0 or coalesce(new.cost_price, 0) <= 0)
     and public._loc_qty(new.id, 'SHOP') > 0 then
    raise exception '%: weka bei ya kuuza na ya kununua; bidhaa ina stock Dukani', new.name;
  end if;
  return new;
end $$;

drop trigger if exists shop_prices_stay on public.products;
create trigger shop_prices_stay before update on public.products
  for each row execute function public._trg_shop_prices_stay();

-- 3. Bidhaa isiyo na bei ya kuuza haiuzwi.
create or replace function public._trg_sale_needs_price() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce((select sell_price from public.products where id = new.product_id), 0) <= 0 then
    raise exception '%: bei ya kuuza haijawekwa', new.name;
  end if;
  return new;
end $$;

drop trigger if exists sale_needs_price on public.sale_items;
create trigger sale_needs_price before insert on public.sale_items
  for each row execute function public._trg_sale_needs_price();

-- 4. Kuweka bei (mf. wakati wa kuhamisha Store -> Duka).
--    Bei ya kununua: mmiliki tu. Bei ya kuuza: mmiliki, au muuzaji kama bidhaa haina bei bado.
create or replace function public.rpc_set_product_prices(p_id bigint, p_cost bigint, p_sell bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_prod record; v_cost bigint; v_sell bigint; v_owner boolean;
begin
  perform public._require_staff();
  v_owner := public.is_owner();
  select * into v_prod from public.products where id = p_id for update;
  if not found then raise exception 'Bidhaa haipo'; end if;
  v_cost := v_prod.cost_price;
  v_sell := v_prod.sell_price;
  if coalesce(p_cost, 0) > 0 then
    if not v_owner then raise exception 'Mmiliki tu ndiye anaweza kuweka bei ya kununua'; end if;
    v_cost := p_cost;
  end if;
  if coalesce(p_sell, 0) > 0 then
    if not v_owner and v_prod.sell_price > 0 then raise exception 'Mmiliki tu ndiye anaweza kubadilisha bei ya kuuza'; end if;
    v_sell := p_sell;
  end if;
  if v_cost > 0 and v_sell > 0 and v_sell < v_cost then
    raise exception '%: bei ya kuuza iko chini ya bei ya kununua', v_prod.name;
  end if;
  if v_cost is distinct from v_prod.cost_price or v_sell is distinct from v_prod.sell_price then
    update public.products set cost_price = v_cost, sell_price = v_sell, updated_at = now() where id = p_id;
    insert into public.audit_logs (user_name, action, subject_id, detail)
    values (public._actor_name(), 'PRICE_CHANGE', p_id::text, v_prod.name || ': kununua ' || v_cost || ', kuuza ' || v_sell);
  end if;
  return true;
end $$;

grant execute on function public.rpc_set_product_prices(bigint, bigint, bigint) to authenticated, service_role;
revoke execute on function public.rpc_set_product_prices(bigint, bigint, bigint) from public, anon;

commit;
