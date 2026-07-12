-- 巡回赛经纪人：每日 combo 补差结算、输球状态修复、徽章商城。

create table if not exists public.tour_manager_badges (
  badge_key text primary key,
  title text not null,
  subtitle text,
  description text,
  price int not null check (price >= 0),
  image_url text not null,
  thumb_url text not null,
  rarity text not null default 'limited',
  is_active boolean not null default true,
  sort_order int not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tour_manager_user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_key text not null references public.tour_manager_badges(badge_key),
  purchased_at timestamptz not null default now(),
  is_equipped boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, badge_key)
);

create unique index if not exists tour_manager_user_badges_one_equipped_idx
on public.tour_manager_user_badges(user_id)
where is_equipped;

alter table public.tour_manager_badges enable row level security;
alter table public.tour_manager_user_badges enable row level security;

drop policy if exists tour_manager_badges_select_public on public.tour_manager_badges;
create policy tour_manager_badges_select_public
on public.tour_manager_badges
for select
using (is_active);

drop policy if exists tour_manager_user_badges_select_own on public.tour_manager_user_badges;
create policy tour_manager_user_badges_select_own
on public.tour_manager_user_badges
for select
using (auth.uid() = user_id);

grant select on public.tour_manager_badges to anon, authenticated;
grant select on public.tour_manager_user_badges to authenticated;

insert into public.tour_manager_badges (
  badge_key, title, subtitle, description, price, image_url, thumb_url, rarity, sort_order, metadata
)
values
  (
    'sinner-fox',
    '辛纳狐',
    '草地限定',
    '辛纳主题徽章，冷静、狡黠、利落。',
    2888,
    'assets/manager/badges/sinner-fox.webp',
    'assets/manager/badges/sinner-fox-thumb.webp',
    'limited',
    10,
    jsonb_build_object('theme', 'sinner_fox', 'test_badge', true)
  ),
  (
    'alcaraz-duck',
    '阿卡鸭',
    '阳光限定',
    '阿卡主题徽章，活力、阳光、可爱。',
    2888,
    'assets/manager/badges/alcaraz-duck.webp',
    'assets/manager/badges/alcaraz-duck-thumb.webp',
    'limited',
    20,
    jsonb_build_object('theme', 'alcaraz_duck', 'test_badge', true)
  ),
  (
    'djoko-goat',
    '德约GOAT',
    '传奇限定',
    '德约主题徽章，传奇、稳重、王者。',
    2888,
    'assets/manager/badges/djoko-goat.webp',
    'assets/manager/badges/djoko-goat-thumb.webp',
    'limited',
    30,
    jsonb_build_object('theme', 'djoko_goat', 'test_badge', true)
  ),
  (
    'rublev-cat',
    '卢布喵',
    '锐气限定',
    '卢布主题徽章，清爽、锐气、竞技感。',
    2888,
    'assets/manager/badges/rublev-cat.webp',
    'assets/manager/badges/rublev-cat-thumb.webp',
    'limited',
    40,
    jsonb_build_object('theme', 'rublev_cat', 'test_badge', true)
  ),
  (
    'zheng-queen',
    '郑钦文Queen',
    '女王限定',
    '郑钦文主题徽章，力量、尊贵、耀眼。',
    2888,
    'assets/manager/badges/zheng-queen.webp',
    'assets/manager/badges/zheng-queen-thumb.webp',
    'limited',
    50,
    jsonb_build_object('theme', 'zheng_queen', 'test_badge', true)
  ),
  (
    'wang-xinyu-mermaid',
    '王欣瑜美人鱼',
    '海洋限定',
    '王欣瑜主题徽章，灵动、优雅、梦幻。',
    2888,
    'assets/manager/badges/wang-xinyu-mermaid.webp',
    'assets/manager/badges/wang-xinyu-mermaid-thumb.webp',
    'limited',
    60,
    jsonb_build_object('theme', 'wang_mermaid', 'test_badge', true)
  ),
  (
    'luwang-friend',
    '炉网挚友',
    '时间共振章',
    '炉网陪伴主题徽章，纪念每一场相伴的巡回赛。',
    2888,
    'assets/manager/badges/luwang-friend.webp',
    'assets/manager/badges/luwang-friend-thumb.webp',
    'limited',
    70,
    jsonb_build_object('theme', 'luwang_friend', 'test_badge', true)
  ),
  (
    'wimbledon-2026',
    '仲夏草地书',
    '温网限定',
    '温网主题徽章，清雅、限定、仪式感。',
    2888,
    'assets/manager/badges/wimbledon-2026.webp',
    'assets/manager/badges/wimbledon-2026-thumb.webp',
    'limited',
    80,
    jsonb_build_object('theme', 'wimbledon_2026', 'test_badge', true)
  )
on conflict (badge_key) do update
set title = excluded.title,
    subtitle = excluded.subtitle,
    description = excluded.description,
    price = excluded.price,
    image_url = excluded.image_url,
    thumb_url = excluded.thumb_url,
    rarity = excluded.rarity,
    sort_order = excluded.sort_order,
    metadata = excluded.metadata,
    is_active = true,
    updated_at = now();

create or replace view public.tour_manager_active_badges
as
select
  ub.user_id,
  coalesce(p.display_name, '炉友') as display_name,
  b.badge_key,
  b.title,
  b.subtitle,
  b.image_url,
  b.thumb_url,
  b.rarity,
  ub.purchased_at,
  ub.updated_at
from public.tour_manager_user_badges ub
join public.tour_manager_badges b on b.badge_key = ub.badge_key and b.is_active
left join public.profiles p on p.id = ub.user_id
where ub.is_equipped;

grant select on public.tour_manager_active_badges to anon, authenticated;

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
    jsonb_build_object('purchase_price', v_badge.price)
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

create or replace function public.tour_manager_set_active_badge(
  p_badge_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_badge record;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  if p_badge_key is null or trim(p_badge_key) = '' then
    update public.tour_manager_user_badges
    set is_equipped = false,
        updated_at = now()
    where user_id = v_user;

    return jsonb_build_object('active_badge', null);
  end if;

  select ub.*, b.title, b.subtitle, b.image_url, b.thumb_url, b.rarity
  into v_badge
  from public.tour_manager_user_badges ub
  join public.tour_manager_badges b on b.badge_key = ub.badge_key and b.is_active
  where ub.user_id = v_user
    and ub.badge_key = p_badge_key;

  if v_badge.id is null then
    raise exception 'badge_not_owned';
  end if;

  update public.tour_manager_user_badges
  set is_equipped = false,
      updated_at = now()
  where user_id = v_user;

  update public.tour_manager_user_badges
  set is_equipped = true,
      updated_at = now()
  where id = v_badge.id;

  return jsonb_build_object(
    'active_badge',
    jsonb_build_object(
      'badge_key', v_badge.badge_key,
      'title', v_badge.title,
      'subtitle', v_badge.subtitle,
      'image_url', v_badge.image_url,
      'thumb_url', v_badge.thumb_url,
      'rarity', v_badge.rarity
    )
  );
end;
$$;

revoke all on function public.tour_manager_purchase_badge(text, int) from public, anon;
grant execute on function public.tour_manager_purchase_badge(text, int) to authenticated;
revoke all on function public.tour_manager_set_active_badge(text) from public, anon;
grant execute on function public.tour_manager_set_active_badge(text) to authenticated;

create or replace function public.tour_manager_get_my_state(
  p_station_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_lineup public.tour_manager_lineups;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select * into v_lineup
  from public.tour_manager_lineups
  where user_id = v_user
    and station_key = p_station_key
    and status <> 'cancelled'
  order by submitted_at desc
  limit 1;

  return jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'lineup', case when v_lineup.id is null then null else to_jsonb(v_lineup) end,
    'contracts', coalesce((
      select jsonb_agg(to_jsonb(lp) order by lp.created_at)
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = v_lineup.id
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(wl) order by wl.created_at desc)
      from public.tour_manager_wallet_ledger wl
      where wl.user_id = v_user
        and wl.season = p_season
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.sort_order, b.created_at)
      from public.tour_manager_badges b
      where b.is_active
    ), '[]'::jsonb),
    'my_badges', coalesce((
      select jsonb_agg(
        to_jsonb(ub) || jsonb_build_object(
          'title', b.title,
          'subtitle', b.subtitle,
          'description', b.description,
          'price', b.price,
          'image_url', b.image_url,
          'thumb_url', b.thumb_url,
          'rarity', b.rarity
        )
        order by ub.purchased_at desc
      )
      from public.tour_manager_user_badges ub
      join public.tour_manager_badges b on b.badge_key = ub.badge_key
      where ub.user_id = v_user
    ), '[]'::jsonb),
    'active_badge', (
      select to_jsonb(ab)
      from public.tour_manager_active_badges ab
      where ab.user_id = v_user
      limit 1
    )
  );
end;
$$;

grant execute on function public.tour_manager_get_my_state(text,int) to authenticated;

drop view if exists public.tour_manager_public_configurations;
create or replace view public.tour_manager_public_configurations
as
select
  l.station_key,
  l.id as lineup_id,
  l.user_id,
  coalesce(p.display_name, '炉友') as display_name,
  ab.badge_key,
  ab.title as badge_title,
  ab.thumb_url as badge_thumb_url,
  l.lineup_style,
  l.lineup_cost,
  l.predicted_net,
  l.submitted_at,
  l.status,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_key', lp.player_key,
        'name',
          case
            when coalesce(lp.metadata->>'substituted_from_name_zh', '') <> ''
              then lp.name_zh || '（原' || (lp.metadata->>'substituted_from_name_zh') || '）'
            else lp.name_zh
          end,
        'name_zh', lp.name_zh,
        'name_en', lp.name_en,
        'original_name_zh', nullif(lp.metadata->>'substituted_from_name_zh', ''),
        'original_name_en', nullif(lp.metadata->>'substituted_from_name_en', ''),
        'tour', lp.tour,
        'price', lp.price,
        'predicted_round', lp.predicted_round,
        'active', lp.is_active
      )
      order by lp.created_at
    ) filter (where lp.id is not null),
    '[]'::jsonb
  ) as players
from public.tour_manager_lineups l
left join public.profiles p on p.id = l.user_id
left join public.tour_manager_active_badges ab on ab.user_id = l.user_id
left join public.tour_manager_lineup_players lp on lp.lineup_id = l.id and lp.is_active
where l.status in ('submitted','locked','settling','settled')
group by l.station_key, l.id, l.user_id, p.display_name, ab.badge_key, ab.title, ab.thumb_url, l.lineup_style, l.lineup_cost, l.predicted_net, l.submitted_at, l.status;

grant select on public.tour_manager_public_configurations to anon, authenticated;

drop view if exists public.tour_manager_station_net_leaderboard;
create or replace view public.tour_manager_station_net_leaderboard
as
with lineup_base as (
  select
    l.id as lineup_id,
    l.user_id,
    l.season,
    l.station_key,
    l.submitted_at,
    coalesce(p.display_name, '炉友') as display_name,
    ab.badge_key,
    ab.title as badge_title,
    ab.thumb_url as badge_thumb_url
  from public.tour_manager_lineups l
  left join public.profiles p on p.id = l.user_id
  left join public.tour_manager_active_badges ab on ab.user_id = l.user_id
  where l.status in ('submitted','locked','settling','settled')
),
ledger_totals as (
  select
    wl.lineup_id,
    coalesce(sum(wl.amount) filter (where wl.type = 'player_points_delta'), 0)::int as player_settlement_income,
    coalesce(sum(wl.amount) filter (where wl.type = 'station_combo_bonus'), 0)::int as combo_bonus
  from public.tour_manager_wallet_ledger wl
  where wl.type in ('player_points_delta','station_combo_bonus')
  group by wl.lineup_id
),
scored as (
  select
    lb.station_key,
    lb.season,
    lb.lineup_id,
    lb.display_name,
    lb.badge_key,
    lb.badge_title,
    lb.badge_thumb_url,
    coalesce(lt.player_settlement_income, 0)::int as player_settlement_income,
    coalesce(lt.combo_bonus, 0)::int as combo_bonus,
    (coalesce(lt.player_settlement_income, 0) + coalesce(lt.combo_bonus, 0))::int as station_net_income,
    lb.submitted_at
  from lineup_base lb
  left join ledger_totals lt on lt.lineup_id = lb.lineup_id
)
select
  row_number() over (
    partition by station_key, season
    order by station_net_income desc, player_settlement_income desc, combo_bonus desc, submitted_at asc, lineup_id
  )::int as rank_no,
  station_key,
  season,
  lineup_id,
  display_name,
  badge_key,
  badge_title,
  badge_thumb_url,
  station_net_income,
  player_settlement_income,
  combo_bonus,
  submitted_at
from scored;

grant select on public.tour_manager_station_net_leaderboard to anon, authenticated;

drop view if exists public.tour_manager_wallet_leaderboard;
create or replace view public.tour_manager_wallet_leaderboard
as
select
  row_number() over (
    partition by w.season
    order by w.balance desc, coalesce(p.display_name, '炉友') asc, w.user_id
  )::int as rank_no,
  w.season,
  w.user_id,
  coalesce(p.display_name, '炉友') as display_name,
  ab.badge_key,
  ab.title as badge_title,
  ab.thumb_url as badge_thumb_url,
  w.balance::int as current_principal,
  w.updated_at
from public.tour_manager_wallets w
left join public.profiles p on p.id = w.user_id
left join public.tour_manager_active_badges ab on ab.user_id = w.user_id
where w.user_id <> '186fe1bf-4fa5-4199-b559-e7d56c36fe90'::uuid
  and coalesce(p.display_name, '') <> 'test111';

grant select on public.tour_manager_wallet_leaderboard to anon, authenticated;

create or replace function public.tour_manager_wimbledon_combo_details(
  p_lineup_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_contract_count int := 0;
  v_r32_count int := 0;
  v_r16_count int := 0;
  v_qf_count int := 0;
  v_sf_count int := 0;
  v_atp_r16 int := 0;
  v_wta_r16 int := 0;
  v_atp_qf int := 0;
  v_wta_qf int := 0;
  v_atp_sf int := 0;
  v_wta_sf int := 0;
  v_atp_f int := 0;
  v_wta_f int := 0;
  v_champions int := 0;
  v_value_champions int := 0;
  v_multi_bonus int := 0;
  v_all_r16_bonus int := 0;
  v_dual_bonus int := 0;
  v_jewel_bonus int := 0;
  v_champ_bonus int := 0;
  v_round text;
  v_players jsonb := '[]'::jsonb;
  v_details jsonb := '[]'::jsonb;
begin
  select
    count(*) filter (where is_active),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32')),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
    count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
    count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
    count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
    count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
    count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
    count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
    count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
    count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
    count(*) filter (where is_active and reached_round = 'W'),
    count(*) filter (where is_active and reached_round = 'W' and price <= 450),
    coalesce(max(case
      when is_active and price <= 300 and reached_round = 'W' then 680
      when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 530
      when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 380
      when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 280
      when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16') then 180
      when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32') then 80
      else 0
    end), 0)
  into
    v_contract_count, v_r32_count, v_r16_count, v_qf_count, v_sf_count,
    v_atp_r16, v_wta_r16, v_atp_qf, v_wta_qf, v_atp_sf, v_wta_sf, v_atp_f, v_wta_f,
    v_champions, v_value_champions, v_jewel_bonus
  from public.tour_manager_lineup_players
  where lineup_id = p_lineup_id;

  if v_contract_count >= 3 then
    if v_sf_count >= 3 then
      v_multi_bonus := 480;
      v_round := 'SF';
    elsif v_qf_count >= 3 then
      v_multi_bonus := 320;
      v_round := 'QF';
    elsif v_r16_count >= 3 then
      v_multi_bonus := 180;
      v_round := 'R16';
    elsif v_r32_count >= 3 then
      v_multi_bonus := 80;
      v_round := 'R32';
    end if;

    if v_multi_bonus > 0 then
      select coalesce(jsonb_agg(
        jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
        order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
      ), '[]'::jsonb)
      into v_players
      from public.tour_manager_lineup_players
      where lineup_id = p_lineup_id
        and is_active
        and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_round);

      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'key', 'multi',
        'label', '多点开花',
        'bonus', v_multi_bonus,
        'round', v_round,
        'players', v_players
      ));
    end if;

    if v_r16_count = v_contract_count then
      v_all_r16_bonus := 100;
      select coalesce(jsonb_agg(
        jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
        order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
      ), '[]'::jsonb)
      into v_players
      from public.tour_manager_lineup_players
      where lineup_id = p_lineup_id
        and is_active;

      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'key', 'all_r16',
        'label', '全员进阶',
        'bonus', v_all_r16_bonus,
        'round', 'R16',
        'players', v_players
      ));
    end if;
  end if;

  if v_atp_f > 0 and v_wta_f > 0 then
    v_dual_bonus := 450;
    v_round := 'F';
  elsif v_atp_sf > 0 and v_wta_sf > 0 then
    v_dual_bonus := 300;
    v_round := 'SF';
  elsif v_atp_qf > 0 and v_wta_qf > 0 then
    v_dual_bonus := 170;
    v_round := 'QF';
  elsif v_atp_r16 > 0 and v_wta_r16 > 0 then
    v_dual_bonus := 80;
    v_round := 'R16';
  else
    v_round := null;
  end if;

  if v_dual_bonus > 0 then
    select coalesce(jsonb_agg(
      jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price, 'tour', tour)
      order by tour, public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
    ), '[]'::jsonb)
    into v_players
    from public.tour_manager_lineup_players
    where lineup_id = p_lineup_id
      and is_active
      and tour in ('ATP','WTA')
      and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_round);

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'dual',
      'label', '双线经营',
      'bonus', v_dual_bonus,
      'round', v_round,
      'players', v_players
    ));
  end if;

  if v_jewel_bonus > 0 then
    select jsonb_build_array(jsonb_build_object('name', name, 'round', reached_round, 'price', price))
    into v_players
    from (
      select
        coalesce(name_zh, name_en, player_key) as name,
        reached_round,
        price,
        case
          when reached_round = 'W' then 680
          when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 530
          when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 380
          when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 280
          when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16') then 180
          when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32') then 80
          else 0
        end as bonus
      from public.tour_manager_lineup_players
      where lineup_id = p_lineup_id
        and is_active
        and price <= 300
    ) s
    where bonus = v_jewel_bonus
    order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, price asc, name
    limit 1;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'jewel',
      'label', '慧眼识珠',
      'bonus', v_jewel_bonus,
      'round', (select coalesce((v_players->0->>'round'), '')),
      'players', coalesce(v_players, '[]'::jsonb)
    ));
  end if;

  if v_value_champions > 0 then
    v_champ_bonus := 150;
  elsif v_champions > 0 then
    v_champ_bonus := 50;
  end if;

  if v_champ_bonus > 0 then
    select coalesce(jsonb_agg(
      jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
      order by price asc, coalesce(name_zh, name_en, player_key)
    ), '[]'::jsonb)
    into v_players
    from public.tour_manager_lineup_players
    where lineup_id = p_lineup_id
      and is_active
      and reached_round = 'W'
      and (v_value_champions = 0 or price <= 450);

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'champion',
      'label', '冠军经纪',
      'bonus', v_champ_bonus,
      'round', 'W',
      'players', v_players
    ));
  end if;

  return v_details;
end;
$$;

revoke all on function public.tour_manager_wimbledon_combo_details(uuid) from public, anon, authenticated;
grant execute on function public.tour_manager_wimbledon_combo_details(uuid) to service_role;

create or replace function public.tour_manager_classic_combo_details(
  p_lineup_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_contract_count int := 0;
  v_qf_count int := 0;
  v_finalists int := 0;
  v_champions int := 0;
  v_jewels int := 0;
  v_gross int := 0;
  v_stable_bonus int := 0;
  v_players jsonb := '[]'::jsonb;
  v_details jsonb := '[]'::jsonb;
begin
  select
    count(*) filter (where is_active),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
    count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
    count(*) filter (where is_active and reached_round = 'W'),
    count(*) filter (where is_active and tier in ('C','D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
    coalesce(sum(earned_points), 0)
  into v_contract_count, v_qf_count, v_finalists, v_champions, v_jewels, v_gross
  from public.tour_manager_lineup_players
  where lineup_id = p_lineup_id;

  if v_contract_count > 0 and v_qf_count * 100 >= v_contract_count * 60 then
    v_stable_bonus := least(round(v_gross * 0.08)::int, 80);
    if v_stable_bonus > 0 then
      select coalesce(jsonb_agg(
        jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
        order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
      ), '[]'::jsonb)
      into v_players
      from public.tour_manager_lineup_players
      where lineup_id = p_lineup_id
        and is_active
        and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF');

      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'key', 'steady',
        'label', '稳健',
        'bonus', v_stable_bonus,
        'round', 'QF',
        'players', v_players
      ));
    end if;
  end if;

  if v_finalists >= 2 then
    select coalesce(jsonb_agg(
      jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
      order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
    ), '[]'::jsonb)
    into v_players
    from public.tour_manager_lineup_players
    where lineup_id = p_lineup_id
      and is_active
      and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F');

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'final_team',
      'label', '决赛团队',
      'bonus', 60,
      'round', 'F',
      'players', v_players
    ));
  end if;

  if v_champions >= 1 then
    select coalesce(jsonb_agg(
      jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
      order by price asc, coalesce(name_zh, name_en, player_key)
    ), '[]'::jsonb)
    into v_players
    from public.tour_manager_lineup_players
    where lineup_id = p_lineup_id
      and is_active
      and reached_round = 'W';

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'champion',
      'label', '冠军经纪',
      'bonus', 40,
      'round', 'W',
      'players', v_players
    ));
  end if;

  if v_jewels > 0 then
    select coalesce(jsonb_agg(
      jsonb_build_object('name', coalesce(name_zh, name_en, player_key), 'round', reached_round, 'price', price)
      order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, coalesce(name_zh, name_en, player_key)
    ), '[]'::jsonb)
    into v_players
    from public.tour_manager_lineup_players
    where lineup_id = p_lineup_id
      and is_active
      and tier in ('C','D')
      and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF');

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'key', 'jewel',
      'label', '慧眼识珠',
      'bonus', greatest(v_jewels, 0) * 30,
      'round', 'SF',
      'players', v_players
    ));
  end if;

  return v_details;
end;
$$;

revoke all on function public.tour_manager_classic_combo_details(uuid) from public, anon, authenticated;
grant execute on function public.tour_manager_classic_combo_details(uuid) to service_role;

create or replace function public.tour_manager_apply_station_combo(
  p_station_key text,
  p_season int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lineup record;
  v_contract_count int;
  v_r32_count int;
  v_r16_count int;
  v_qf_count int;
  v_sf_count int;
  v_finalists int;
  v_champions int;
  v_value_champions int;
  v_jewels int;
  v_jewel_bonus int;
  v_atp_r16 int;
  v_wta_r16 int;
  v_atp_qf int;
  v_wta_qf int;
  v_atp_sf int;
  v_wta_sf int;
  v_atp_f int;
  v_wta_f int;
  v_gross int;
  v_multi_bonus int;
  v_all_r16_bonus int;
  v_dual_bonus int;
  v_champ_bonus int;
  v_raw_bonus int;
  v_entitled_bonus int;
  v_paid_bonus int;
  v_bonus int;
  v_balance int;
  v_applied int := 0;
  v_combo_details jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

	for v_lineup in
	  select *
	  from public.tour_manager_lineups
	  where station_key = p_station_key
	    and season = p_season
	    and status in ('submitted','locked','settling','settled')
  loop
    v_multi_bonus := 0;
    v_all_r16_bonus := 0;
    v_dual_bonus := 0;
    v_champ_bonus := 0;
    v_jewel_bonus := 0;
    v_raw_bonus := 0;
    v_entitled_bonus := 0;
    v_bonus := 0;
    v_combo_details := '[]'::jsonb;

    if p_station_key = '2026-w27-wimbledon' then
      select
        count(*) filter (where is_active),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and reached_round = 'W'),
        count(*) filter (where is_active and reached_round = 'W' and price <= 450),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        coalesce(max(case
          when is_active and price <= 300 and reached_round = 'W' then 680
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 530
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 380
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 280
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16') then 180
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32') then 80
          else 0
        end), 0),
        coalesce(sum(earned_points), 0)
      into
        v_contract_count, v_r32_count, v_r16_count, v_qf_count, v_sf_count,
        v_finalists, v_champions, v_value_champions,
        v_atp_r16, v_wta_r16, v_atp_qf, v_wta_qf, v_atp_sf, v_wta_sf, v_atp_f, v_wta_f,
        v_jewel_bonus, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count >= 3 then
        if v_sf_count >= 3 then
          v_multi_bonus := 480;
        elsif v_qf_count >= 3 then
          v_multi_bonus := 320;
        elsif v_r16_count >= 3 then
          v_multi_bonus := 180;
        elsif v_r32_count >= 3 then
          v_multi_bonus := 80;
        end if;

        if v_r16_count = v_contract_count then
          v_all_r16_bonus := 100;
        end if;
      end if;

      if v_atp_f > 0 and v_wta_f > 0 then
        v_dual_bonus := 450;
      elsif v_atp_sf > 0 and v_wta_sf > 0 then
        v_dual_bonus := 300;
      elsif v_atp_qf > 0 and v_wta_qf > 0 then
        v_dual_bonus := 170;
      elsif v_atp_r16 > 0 and v_wta_r16 > 0 then
        v_dual_bonus := 80;
      end if;

      if v_value_champions > 0 then
        v_champ_bonus := 150;
      elsif v_champions > 0 then
        v_champ_bonus := 50;
      end if;

      v_raw_bonus := v_multi_bonus + v_all_r16_bonus + v_dual_bonus + v_jewel_bonus + v_champ_bonus;
      v_entitled_bonus := least(v_raw_bonus, 700);
      v_combo_details := public.tour_manager_wimbledon_combo_details(v_lineup.id);
    else
      select count(*) filter (where is_active),
             count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
             count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
             count(*) filter (where is_active and reached_round = 'W'),
             count(*) filter (where is_active and tier in ('C','D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
             coalesce(sum(earned_points), 0)
      into v_contract_count, v_qf_count, v_finalists, v_champions, v_jewels, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count > 0 and v_qf_count * 100 >= v_contract_count * 60 then
        v_entitled_bonus := v_entitled_bonus + least(round(v_gross * 0.08)::int, 80);
      end if;
      if v_finalists >= 2 then
        v_entitled_bonus := v_entitled_bonus + 60;
      end if;
      if v_champions >= 1 then
        v_entitled_bonus := v_entitled_bonus + 40;
      end if;
      v_entitled_bonus := v_entitled_bonus + greatest(v_jewels, 0) * 30;
      v_raw_bonus := v_entitled_bonus;
      v_combo_details := public.tour_manager_classic_combo_details(v_lineup.id);
    end if;

    select coalesce(sum(amount), 0)::int into v_paid_bonus
    from public.tour_manager_wallet_ledger
    where lineup_id = v_lineup.id
      and type = 'station_combo_bonus';

    v_bonus := greatest(v_entitled_bonus - v_paid_bonus, 0);

    if v_bonus > 0 then
      update public.tour_manager_wallets
      set balance = balance + v_bonus,
          updated_at = now()
      where user_id = v_lineup.user_id and season = v_lineup.season
      returning balance into v_balance;

      insert into public.tour_manager_wallet_ledger (
        user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
      )
      values (
        v_lineup.user_id, v_lineup.season, v_lineup.station_key, v_lineup.id,
        'station_combo_bonus', v_bonus, v_balance, '本站组合奖励',
        case when p_station_key = '2026-w27-wimbledon' then
          jsonb_build_object(
            'combo_version', 'wimbledon_2026_daily_delta',
            'combo_cap', 700,
            'raw_bonus', v_raw_bonus,
            'entitled_bonus', v_entitled_bonus,
            'paid_before', v_paid_bonus,
            'combo_delta', v_bonus,
            'gross', v_gross,
            'contract_count', v_contract_count,
            'r32_count', v_r32_count,
            'r16_count', v_r16_count,
            'qf_count', v_qf_count,
            'sf_count', v_sf_count,
            'finalists', v_finalists,
            'champions', v_champions,
            'multi_bonus', v_multi_bonus,
            'all_r16_bonus', v_all_r16_bonus,
            'dual_bonus', v_dual_bonus,
            'jewel_bonus', v_jewel_bonus,
            'champion_bonus', v_champ_bonus,
            'combo_details', v_combo_details
          )
        else
          jsonb_build_object(
            'combo_version', 'classic_daily_delta',
            'raw_bonus', v_raw_bonus,
            'entitled_bonus', v_entitled_bonus,
            'paid_before', v_paid_bonus,
            'combo_delta', v_bonus,
            'gross', v_gross,
            'qf_count', v_qf_count,
            'contract_count', v_contract_count,
            'finalists', v_finalists,
            'champions', v_champions,
            'jewels', v_jewels,
            'combo_details', v_combo_details
          )
        end
      );
      v_applied := v_applied + 1;
    end if;
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.tour_manager_apply_station_combo(text, int) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_station_combo(text, int) to service_role;

update public.tour_manager_wallet_ledger wl
set metadata = coalesce(wl.metadata, '{}'::jsonb) ||
  jsonb_build_object(
    'combo_details', case
      when wl.station_key = '2026-w27-wimbledon'
        then public.tour_manager_wimbledon_combo_details(wl.lineup_id)
      else public.tour_manager_classic_combo_details(wl.lineup_id)
    end,
    'combo_details_backfilled_at', now()
  )
where wl.type = 'station_combo_bonus'
  and wl.lineup_id is not null
  and (
    wl.metadata->'combo_details' is null
    or jsonb_typeof(wl.metadata->'combo_details') <> 'array'
    or case
      when jsonb_typeof(wl.metadata->'combo_details') = 'array'
        then jsonb_array_length(wl.metadata->'combo_details') = 0
      else true
    end
  );

create or replace function public.tour_manager_settle_completed_matches(
  p_station_key text,
  p_season int,
  p_settled_for_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_contract record;
  v_player_key text;
  v_reached text;
  v_is_final boolean;
  v_target_points int;
  v_delta int;
  v_balance int;
  v_settlement_id uuid;
  v_settlements int := 0;
  v_points int := 0;
  v_station_events int;
  v_completed_finals int;
  v_combo_count int := 0;
  v_first_round_key text;
  v_first_actual_round_key text;
  v_is_bye_first_match boolean;
  v_is_bye_first_loss boolean;
  v_baseline_round text;
  v_baseline_points int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  update public.tour_manager_lineups l
  set status = 'locked',
      locked_at = coalesce(locked_at, now())
  where l.station_key = p_station_key
    and l.season = p_season
    and l.status = 'submitted'
    and exists (
      select 1
      from public.tour_manager_events e
      where e.station_key = p_station_key
        and e.season = p_season
        and coalesce(e.submission_cutoff_at, e.submission_closes_at) is not null
        and now() > coalesce(e.submission_cutoff_at, e.submission_closes_at)
    );

  for v_match in
    select m.*, e.level, e.draw_size
    from public.tour_manager_matches m
    join public.tour_manager_events e on e.event_key = m.event_key
    where e.station_key = p_station_key
      and e.season = p_season
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and m.round_key in ('R128','R64','R32','R16','QF','SF','F')
  loop
    for v_player_key in
      select v_match.player1_key
      union all
      select v_match.player2_key
    loop
      if v_player_key is null then
        continue;
      end if;

      for v_contract in
        select lp.*, l.user_id, l.season, l.station_key, ep.first_round
        from public.tour_manager_lineup_players lp
        join public.tour_manager_lineups l on l.id = lp.lineup_id
        left join public.tour_manager_event_players ep
          on ep.event_key = lp.event_key
         and ep.player_key = lp.player_key
        where l.station_key = p_station_key
          and l.season = p_season
          and l.status in ('submitted','locked','settling','settled')
          and lp.event_key = v_match.event_key
          and lp.player_key = v_player_key
          and (v_match.scheduled_at is null or lp.created_at <= v_match.scheduled_at)
          and (lp.replaced_at is null or v_match.scheduled_at is null or v_match.scheduled_at < lp.replaced_at)
      loop
        v_baseline_round := coalesce(v_contract.metadata->>'transfer_baseline_round', 'OUT');
        v_baseline_points := case
          when coalesce(v_contract.metadata->>'transfer_baseline_points', '') ~ '^-?[0-9]+$'
            then greatest((v_contract.metadata->>'transfer_baseline_points')::int, 0)
          else 0
        end;

        v_first_round_key := public.tour_manager_first_round_key(v_match.draw_size);
        v_first_actual_round_key := public.tour_manager_next_round_key(v_first_round_key);
        v_is_bye_first_match :=
          upper(coalesce(v_contract.first_round, '')) = 'BYE'
          and v_baseline_points = 0
          and v_match.round_key = v_first_actual_round_key;
        v_is_bye_first_loss := v_is_bye_first_match and v_player_key <> v_match.winner_key;

        if v_player_key = v_match.winner_key then
          v_reached := public.tour_manager_next_round_key(v_match.round_key);
          v_is_final := v_reached = 'W';
        else
          v_reached := case
            when v_is_bye_first_loss then v_first_round_key
            else v_match.round_key
          end;
          v_is_final := true;
        end if;

        v_target_points := public.tour_manager_round_points(v_match.tour, v_match.level, v_reached, v_match.draw_size);

        if public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(coalesce(v_contract.reached_round, 'OUT'))
           or (v_is_final and v_reached <> 'W' and lower(coalesce(v_contract.metadata->>'is_eliminated', 'false')) not in ('true','1','yes')) then
          update public.tour_manager_lineup_players
          set reached_round = case
                when public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(coalesce(reached_round, 'OUT')) then v_reached
                else reached_round
              end,
              metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                'last_settled_match_key', v_match.match_key,
                'last_settled_round', v_match.round_key,
                'is_eliminated', v_is_final and v_reached <> 'W',
                'status_zh', case when v_is_final and v_reached <> 'W' then '出局' else coalesce(metadata->>'status_zh', '') end,
                'first_round_key', v_first_round_key,
                'bye_first_match_adjusted', v_is_bye_first_loss
              )
          where id = v_contract.id;
        end if;

        v_delta := greatest(v_target_points - v_baseline_points - coalesce(v_contract.earned_points, 0), 0);
        if v_delta <= 0 then
          continue;
        end if;

        v_settlement_id := null;
        insert into public.tour_manager_settlements (
          lineup_id, contract_id, user_id, event_key, player_key, round_key,
          points_delta, is_final, source, settled_for_date
        )
        values (
          v_contract.lineup_id, v_contract.id, v_contract.user_id,
          v_match.event_key, v_player_key, v_reached,
          v_delta, v_is_final,
          jsonb_build_object(
            'match_key', v_match.match_key,
            'source_url', v_match.source_url,
            'winner_key', v_match.winner_key,
            'scheduled_at', v_match.scheduled_at,
            'target_points', v_target_points,
            'draw_size', v_match.draw_size,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          ),
          p_settled_for_date
        )
        on conflict (contract_id, round_key) do nothing
        returning id into v_settlement_id;

        if v_settlement_id is null then
          continue;
        end if;

        update public.tour_manager_lineup_players
        set earned_points = earned_points + v_delta
        where id = v_contract.id;

        update public.tour_manager_wallets
        set balance = balance + v_delta,
            updated_at = now()
        where user_id = v_contract.user_id and season = v_contract.season
        returning balance into v_balance;

        insert into public.tour_manager_wallet_ledger (
          user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
        )
        values (
          v_contract.user_id, v_contract.season, v_contract.station_key, v_contract.lineup_id,
          'player_points_delta', v_delta, v_balance,
          '球员收益结算',
          jsonb_build_object(
            'event_key', v_match.event_key,
            'player_key', v_player_key,
            'round_key', v_reached,
            'match_key', v_match.match_key,
            'is_final', v_is_final,
            'target_points', v_target_points,
            'draw_size', v_match.draw_size,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          )
        );

        v_settlements := v_settlements + 1;
        v_points := v_points + v_delta;
        v_settlement_id := null;
      end loop;
    end loop;
  end loop;

  update public.tour_manager_lineups
  set status = 'settling'
  where station_key = p_station_key
    and season = p_season
    and status = 'locked'
    and exists (
      select 1
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = tour_manager_lineups.id
        and lp.earned_points > 0
    );

  v_combo_count := public.tour_manager_apply_station_combo(p_station_key, p_season);

  select count(*) into v_station_events
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status <> 'cancelled';

  select count(distinct e.event_key) into v_completed_finals
  from public.tour_manager_events e
  join public.tour_manager_matches m
    on m.event_key = e.event_key
   and m.round_key = 'F'
   and m.status in ('completed','walkover','retired')
   and m.winner_key is not null
  where e.station_key = p_station_key
    and e.season = p_season
    and e.market_status <> 'cancelled';

  if v_station_events > 0 and v_completed_finals = v_station_events then
    update public.tour_manager_events
    set market_status = 'settled'
    where station_key = p_station_key
      and season = p_season
      and market_status in ('open','locked');

    update public.tour_manager_lineups
    set status = 'settled',
        settled_at = coalesce(settled_at, now())
    where station_key = p_station_key
      and season = p_season
      and status in ('submitted','locked','settling');
  end if;

  return jsonb_build_object(
    'station_key', p_station_key,
    'season', p_season,
    'settlements', v_settlements,
    'points_delta', v_points,
    'combo_lineups', v_combo_count,
    'finals_completed', v_completed_finals,
    'event_count', v_station_events
  );
end;
$$;

revoke all on function public.tour_manager_settle_completed_matches(text, int, date) from public, anon, authenticated;
grant execute on function public.tour_manager_settle_completed_matches(text, int, date) to service_role;

-- 补正历史：有完赛输球记录但合同 metadata 没标出局的球员。
update public.tour_manager_lineup_players lp
set metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_eliminated', true,
      'status_zh', '出局',
      'elimination_repaired_at', now(),
      'last_settled_match_key', m.match_key,
      'last_settled_round', m.round_key
    )
from public.tour_manager_lineups l
cross join public.tour_manager_matches m
where lp.lineup_id = l.id
  and m.event_key = lp.event_key
  and m.status in ('completed','walkover','retired')
  and m.winner_key is not null
  and (m.player1_key = lp.player_key or m.player2_key = lp.player_key)
  and m.winner_key <> lp.player_key
  and l.season = 2026
  and l.status in ('submitted','locked','settling','settled')
  and lower(coalesce(lp.metadata->>'is_eliminated', 'false')) not in ('true','1','yes')
  and public.tour_manager_round_order(m.round_key) <= public.tour_manager_round_order(coalesce(lp.reached_round, 'OUT'));
