-- Public badge gallery: expose only display-safe collection data.
-- Badge ownership remains private through the base table RLS policy.

drop view if exists public.tour_manager_badge_gallery;

create view public.tour_manager_badge_gallery
as
with collections as (
  select
    ub.user_id,
    coalesce(nullif(trim(p.display_name), ''), '炉友') as display_name,
    count(*)::int as badge_count,
    coalesce(sum(b.price), 0)::bigint as badge_total_price,
    min(ub.purchased_at) as first_badge_at,
    max(ub.purchased_at) as latest_badge_at,
    jsonb_agg(
      jsonb_build_object(
        'badge_key', b.badge_key,
        'title', b.title,
        'subtitle', b.subtitle,
        'image_url', b.image_url,
        'thumb_url', b.thumb_url,
        'rarity', b.rarity,
        'is_equipped', ub.is_equipped,
        'purchased_at', ub.purchased_at
      )
      order by ub.is_equipped desc, b.sort_order asc, ub.purchased_at asc, b.badge_key asc
    ) as badges
  from public.tour_manager_user_badges ub
  join public.tour_manager_badges b
    on b.badge_key = ub.badge_key
   and b.is_active
  left join public.profiles p on p.id = ub.user_id
  where coalesce(p.display_name, '') <> 'test111'
  group by ub.user_id, coalesce(nullif(trim(p.display_name), ''), '炉友')
), ranked as (
  select
    row_number() over (
      order by badge_count desc, badge_total_price desc, first_badge_at asc, display_name asc, user_id asc
    )::int as rank_no,
    display_name,
    badge_count,
    first_badge_at,
    latest_badge_at,
    badges
  from collections
)
select
  rank_no,
  display_name,
  badge_count,
  badges
from ranked;

comment on view public.tour_manager_badge_gallery is
  '公开徽章展馆：按徽章数、徽章目录总价依次降序排列；仅暴露昵称、徽章数和公开徽章陈列字段。';

revoke all on public.tour_manager_badge_gallery from public;
grant select on public.tour_manager_badge_gallery to anon, authenticated;
