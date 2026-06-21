-- 巡回赛经纪人：本站净收益榜
-- 口径：本站净收益 = 球员结算收益 + combo 奖励。

create or replace view public.tour_manager_station_net_leaderboard
as
with lineup_base as (
  select
    l.id as lineup_id,
    l.user_id,
    l.season,
    l.station_key,
    l.submitted_at,
    coalesce(p.display_name, '炉友') as display_name
  from public.tour_manager_lineups l
  left join public.profiles p on p.id = l.user_id
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
  station_net_income,
  player_settlement_income,
  combo_bonus,
  submitted_at
from scored;

grant select on public.tour_manager_station_net_leaderboard to anon, authenticated;
