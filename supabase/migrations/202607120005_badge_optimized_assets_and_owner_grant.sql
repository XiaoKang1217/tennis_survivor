-- 徽章运行时轻量资源，以及站长账号全徽章授权。

update public.tour_manager_badges
set
  image_url = case badge_key
    when 'sinner-fox' then 'assets/manager/badges/ui-v5/optimized/sinner-badge-640.webp'
    when 'alcaraz-duck' then 'assets/manager/badges/ui-v5/optimized/alcaraz-badge-final-hq-640.webp'
    when 'djoko-goat' then 'assets/manager/badges/ui-v5/optimized/djokovic-badge-640.webp'
    when 'rublev-cat' then 'assets/manager/badges/ui-v5/optimized/lubu-badge-640.webp'
    when 'zheng-queen' then 'assets/manager/badges/ui-v5/optimized/zheng-badge-640.webp'
    when 'wang-xinyu-mermaid' then 'assets/manager/badges/ui-v5/optimized/mermaid-badge-640.webp'
    when 'luwang-friend' then 'assets/manager/badges/ui-v5/optimized/luwang-badge-640.webp'
    when 'wimbledon-2026' then 'assets/manager/badges/ui-v5/optimized/wimbledon-badge-640.webp'
    else image_url
  end,
  thumb_url = case badge_key
    when 'sinner-fox' then 'assets/manager/badges/ui-v5/optimized/sinner-badge-640.webp'
    when 'alcaraz-duck' then 'assets/manager/badges/ui-v5/optimized/alcaraz-badge-final-hq-640.webp'
    when 'djoko-goat' then 'assets/manager/badges/ui-v5/optimized/djokovic-badge-640.webp'
    when 'rublev-cat' then 'assets/manager/badges/ui-v5/optimized/lubu-badge-640.webp'
    when 'zheng-queen' then 'assets/manager/badges/ui-v5/optimized/zheng-badge-640.webp'
    when 'wang-xinyu-mermaid' then 'assets/manager/badges/ui-v5/optimized/mermaid-badge-640.webp'
    when 'luwang-friend' then 'assets/manager/badges/ui-v5/optimized/luwang-badge-640.webp'
    when 'wimbledon-2026' then 'assets/manager/badges/ui-v5/optimized/wimbledon-badge-640.webp'
    else thumb_url
  end,
  updated_at = now()
where badge_key in (
  'sinner-fox','alcaraz-duck','djoko-goat','rublev-cat',
  'zheng-queen','wang-xinyu-mermaid','luwang-friend','wimbledon-2026'
);

insert into public.tour_manager_user_badges as existing_badge (
  user_id,
  badge_key,
  purchased_at,
  is_equipped,
  metadata,
  grant_notified_at
)
select
  p.id,
  b.badge_key,
  now(),
  false,
  jsonb_build_object(
    'acquisition', 'owner_grant',
    'grant_reason', 'site_owner_full_collection'
  ),
  now()
from public.profiles p
join public.tour_manager_badges b
  on b.badge_key in (
    'sinner-fox','alcaraz-duck','djoko-goat','rublev-cat',
    'zheng-queen','wang-xinyu-mermaid','luwang-friend','wimbledon-2026'
  )
where trim(p.display_name) = '尊贵的娃老师'
on conflict (user_id, badge_key) do update
set
  metadata = coalesce(existing_badge.metadata, '{}'::jsonb)
    || jsonb_build_object('owner_collection_unlocked', true),
  updated_at = now();
