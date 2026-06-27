-- 巡回赛经纪人：当前本金榜。
-- 口径：直接读取 tour_manager_wallets.balance，按赛季内当前本金排序。

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
  w.balance::int as current_principal,
  w.updated_at
from public.tour_manager_wallets w
left join public.profiles p on p.id = w.user_id;

grant select on public.tour_manager_wallet_leaderboard to anon, authenticated;
