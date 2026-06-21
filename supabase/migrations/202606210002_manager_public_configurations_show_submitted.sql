-- 巡回赛经纪人：配置大厅提交后立即公开完整阵容。

create or replace view public.tour_manager_public_configurations
as
select
  l.station_key,
  l.id as lineup_id,
  coalesce(p.display_name, '炉友') as display_name,
  l.lineup_style,
  l.lineup_cost,
  l.predicted_net,
  l.submitted_at,
  l.status,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', lp.name_zh,
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
left join public.tour_manager_lineup_players lp on lp.lineup_id = l.id and lp.is_active
where l.status in ('submitted','locked','settling','settled')
group by l.station_key, l.id, p.display_name, l.lineup_style, l.lineup_cost, l.predicted_net, l.submitted_at, l.status;

grant select on public.tour_manager_public_configurations to anon, authenticated;
