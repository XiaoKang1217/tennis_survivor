-- Public cumulative-income leaderboard.
-- Income definitions intentionally match the daily income popup:
-- positive player settlement + Combo + daily prediction reward only.

drop view if exists public.tour_manager_career_income_leaderboard;
create view public.tour_manager_career_income_leaderboard
as
with participation as (
  select
    l.user_id,
    l.season,
    count(distinct l.station_key)::int as station_count
  from public.tour_manager_lineups l
  where l.status in ('submitted','locked','settling','settled')
  group by l.user_id, l.season
),
income as (
  select
    wl.user_id,
    wl.season,
    coalesce(sum(wl.amount) filter (
      where wl.amount > 0
        and wl.type in ('player_points_delta','points_delta')
    ), 0)::int as player_income,
    coalesce(sum(wl.amount) filter (
      where wl.amount > 0
        and wl.type = 'station_combo_bonus'
    ), 0)::int as combo_income,
    coalesce(sum(wl.amount) filter (
      where wl.amount > 0
        and wl.type = 'daily_prediction_reward'
    ), 0)::int as prediction_income
  from public.tour_manager_wallet_ledger wl
  where wl.type in (
    'player_points_delta',
    'points_delta',
    'station_combo_bonus',
    'daily_prediction_reward'
  )
  group by wl.user_id, wl.season
),
scored as (
  select
    p.user_id,
    p.season,
    coalesce(profile.display_name, '炉友') as display_name,
    ab.badge_key,
    ab.title as badge_title,
    ab.subtitle as badge_subtitle,
    ab.image_url as badge_image_url,
    ab.thumb_url as badge_thumb_url,
    ab.rarity as badge_rarity,
    coalesce(i.player_income, 0)::int as player_income,
    coalesce(i.combo_income, 0)::int as combo_income,
    coalesce(i.prediction_income, 0)::int as prediction_income,
    (
      coalesce(i.player_income, 0)
      + coalesce(i.combo_income, 0)
      + coalesce(i.prediction_income, 0)
    )::int as total_income,
    p.station_count
  from participation p
  left join income i on i.user_id = p.user_id and i.season = p.season
  left join public.profiles profile on profile.id = p.user_id
  left join public.tour_manager_active_badges ab on ab.user_id = p.user_id
  where p.user_id <> '186fe1bf-4fa5-4199-b559-e7d56c36fe90'::uuid
    and coalesce(profile.display_name, '') <> 'test111'
)
select
  row_number() over (
    partition by season
    order by total_income desc, player_income desc, combo_income desc,
      prediction_income desc, station_count desc, display_name asc, user_id
  )::int as rank_no,
  season,
  display_name,
  badge_key,
  badge_title,
  badge_subtitle,
  badge_image_url,
  badge_thumb_url,
  badge_rarity,
  total_income,
  player_income,
  combo_income,
  prediction_income,
  station_count,
  round(total_income::numeric / nullif(station_count, 0), 1) as average_income_per_station
from scored;

grant select on public.tour_manager_career_income_leaderboard to anon, authenticated;
