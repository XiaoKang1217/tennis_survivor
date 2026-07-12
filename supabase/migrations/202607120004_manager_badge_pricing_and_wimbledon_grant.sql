-- 徽章正式定价、非卖品状态，以及 2026 温网站参赛纪念徽章发放。

alter table public.tour_manager_user_badges
  add column if not exists grant_notified_at timestamptz;

update public.tour_manager_badges
set
  price = case badge_key
    when 'sinner-fox' then 2999
    when 'alcaraz-duck' then 2999
    when 'djoko-goat' then 2999
    when 'rublev-cat' then 1999
    when 'zheng-queen' then 1999
    when 'wang-xinyu-mermaid' then 1999
    when 'luwang-friend' then 0
    when 'wimbledon-2026' then 1999
    else price
  end,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'sale_status', case badge_key
      when 'luwang-friend' then 'coming_soon'
      else 'for_sale'
    end
  ),
  updated_at = now()
where badge_key in (
  'sinner-fox','alcaraz-duck','djoko-goat','rublev-cat',
  'zheng-queen','wang-xinyu-mermaid','luwang-friend','wimbledon-2026'
);

-- 温网站提交过有效阵容的用户，直接获得赛事限定徽章；不扣本金、不写购买流水。
insert into public.tour_manager_user_badges as existing_badge (
  user_id,
  badge_key,
  purchased_at,
  is_equipped,
  metadata,
  grant_notified_at
)
select distinct
  l.user_id,
  'wimbledon-2026',
  now(),
  false,
  jsonb_build_object(
    'acquisition', 'event_grant',
    'grant_event', '2026_wimbledon_manager',
    'grant_station_key', '2026-w27-wimbledon',
    'grant_title', '2026温网限定·仲夏草地书'
  ),
  null
from public.tour_manager_lineups l
where l.station_key = '2026-w27-wimbledon'
  and l.status in ('submitted','locked','settling','settled')
on conflict (user_id, badge_key) do update
set
  metadata = coalesce(existing_badge.metadata, '{}'::jsonb)
    || excluded.metadata,
  grant_notified_at = null,
  updated_at = now();

-- 原购买函数增加售卖状态校验，非卖品无法绕过前端直接购买。
create or replace function public.tour_manager_purchase_badge(
  p_badge_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_badge public.tour_manager_badges;
  v_wallet public.tour_manager_wallets;
  v_balance int;
  v_should_equip boolean := false;
  v_sale_status text;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select * into v_badge
  from public.tour_manager_badges
  where badge_key = p_badge_key
    and is_active
  for share;

  if v_badge.badge_key is null then
    raise exception 'badge_not_found';
  end if;

  v_sale_status := coalesce(v_badge.metadata->>'sale_status', 'for_sale');
  if v_sale_status = 'coming_soon' then
    raise exception 'badge_coming_soon';
  elsif v_sale_status <> 'for_sale' then
    raise exception 'badge_not_for_sale';
  end if;

  if exists (
    select 1
    from public.tour_manager_user_badges
    where user_id = v_user
      and badge_key = p_badge_key
  ) then
    raise exception 'badge_already_owned';
  end if;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user
    and season = p_season
  for update;

  if coalesce(v_balance, 0) < v_badge.price then
    raise exception 'insufficient_wallet_for_badge';
  end if;

  v_should_equip := not exists (
    select 1
    from public.tour_manager_user_badges
    where user_id = v_user
      and is_equipped
  );

  update public.tour_manager_wallets
  set balance = balance - v_badge.price,
      updated_at = now()
  where user_id = v_user
    and season = p_season
  returning balance into v_balance;

  insert into public.tour_manager_user_badges (
    user_id, badge_key, is_equipped, metadata
  )
  values (
    v_user,
    p_badge_key,
    v_should_equip,
    jsonb_build_object('purchase_price', v_badge.price, 'acquisition', 'purchase')
  );

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, p_season, '商城', null,
    'badge_purchase', -v_badge.price, v_balance, '购买徽章',
    jsonb_build_object(
      'badge_key', v_badge.badge_key,
      'badge_title', v_badge.title,
      'badge_subtitle', v_badge.subtitle,
      'badge_image_url', v_badge.image_url,
      'badge_thumb_url', v_badge.thumb_url,
      'price', v_badge.price,
      'wallet_delta', -v_badge.price
    )
  );

  return jsonb_build_object(
    'badge', to_jsonb(v_badge),
    'equipped', v_should_equip,
    'wallet_balance', v_balance
  );
end;
$$;

revoke all on function public.tour_manager_purchase_badge(text, int) from public, anon;
grant execute on function public.tour_manager_purchase_badge(text, int) to authenticated;

-- 原子读取并确认一次赠送通知；每位用户只弹一次。
create or replace function public.tour_manager_take_badge_grant_notice()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant record;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select
    ub.id,
    ub.badge_key,
    b.title,
    b.formal_name,
    b.subtitle,
    b.image_url,
    b.thumb_url,
    b.rarity,
    b.metadata
  into v_grant
  from public.tour_manager_user_badges ub
  join public.tour_manager_badges b on b.badge_key = ub.badge_key
  where ub.user_id = v_user
    and ub.grant_notified_at is null
    and ub.metadata->>'acquisition' = 'event_grant'
  order by ub.purchased_at, ub.created_at
  limit 1
  for update of ub skip locked;

  if v_grant.id is null then
    return null;
  end if;

  update public.tour_manager_user_badges
  set grant_notified_at = now(),
      updated_at = now()
  where id = v_grant.id;

  return jsonb_build_object(
    'badge_key', v_grant.badge_key,
    'title', v_grant.title,
    'formal_name', v_grant.formal_name,
    'subtitle', v_grant.subtitle,
    'image_url', v_grant.image_url,
    'thumb_url', v_grant.thumb_url,
    'rarity', v_grant.rarity,
    'metadata', v_grant.metadata
  );
end;
$$;

revoke all on function public.tour_manager_take_badge_grant_notice() from public, anon;
grant execute on function public.tour_manager_take_badge_grant_notice() to authenticated;
