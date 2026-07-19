-- Grant the seven newly released badges to the site owner.
-- This migration is idempotent and intentionally preserves the equipped badge.

do $$
declare
  v_user_id uuid;
  v_profile_count integer;
  v_badge_count integer;
  v_badge_keys constant text[] := array[
    'gauff-energy',
    'swiatek-whirlwind',
    'alcaraz-bee-duck',
    'who-is-leather',
    'rotten-cabbage',
    'federer-eternal',
    'nadal-clay-soul'
  ];
begin
  select count(*)::integer
  into v_profile_count
  from public.profiles
  where trim(display_name) = '尊贵的娃老师';

  if v_profile_count <> 1 then
    raise exception
      'Expected exactly one profile named 尊贵的娃老师, found %',
      v_profile_count;
  end if;

  select id
  into v_user_id
  from public.profiles
  where trim(display_name) = '尊贵的娃老师';

  select count(*)::integer
  into v_badge_count
  from public.tour_manager_badges
  where badge_key = any(v_badge_keys);

  if v_badge_count <> cardinality(v_badge_keys) then
    raise exception
      'Expected all % new badge catalog entries, found %',
      cardinality(v_badge_keys),
      v_badge_count;
  end if;

  insert into public.tour_manager_user_badges as existing_badge (
    user_id,
    badge_key,
    purchased_at,
    is_equipped,
    metadata,
    grant_notified_at
  )
  select
    v_user_id,
    b.badge_key,
    now(),
    false,
    jsonb_build_object(
      'acquisition', 'owner_grant',
      'grant_reason', 'site_owner_seven_badge_collection',
      'owner_collection_unlocked', true
    ),
    now()
  from public.tour_manager_badges b
  where b.badge_key = any(v_badge_keys)
  on conflict (user_id, badge_key) do update
  set
    metadata = coalesce(existing_badge.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'owner_collection_unlocked', true,
        'seven_badge_owner_grant', true
      ),
    updated_at = now();
end
$$;
