-- Grant only to the verified 80 valid US Open participants; never charge or equip.
begin;

create or replace function public.tour_manager_take_us_open_badge_grant_notice()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_notice jsonb;
begin
  if v_user is null then raise exception 'auth_required'; end if;
  select ub.id, to_jsonb(b) into v_id, v_notice
  from public.tour_manager_user_badges ub
  join public.tour_manager_badges b using (badge_key)
  where ub.user_id = v_user
    and ub.badge_key = 'usopen-night-2026'
    and ub.metadata->>'acquisition' = 'us_open_event_grant'
    and ub.grant_notified_at is null
  for update of ub skip locked;
  if v_id is null then return null; end if;
  update public.tour_manager_user_badges
  set grant_notified_at = now(), updated_at = now() where id = v_id;
  return v_notice;
end;
$$;
revoke all on function public.tour_manager_take_us_open_badge_grant_notice() from public, anon;
grant execute on function public.tour_manager_take_us_open_badge_grant_notice() to authenticated;

-- Freeze eligible IDs for this transaction and fail closed if participation changed.
create temporary table us_open_badge_recipients on commit drop as
select distinct user_id from public.tour_manager_lineups
where station_key = '2026-w35-us-open' and season = 2026
  and status in ('submitted','locked','settling','settled');

do $$
begin
  if (select count(*) from us_open_badge_recipients) <> 80 then
    raise exception 'Expected exactly 80 US Open participants; no grants applied';
  end if;
  if not exists (select 1 from public.tour_manager_badges
    where badge_key = 'usopen-night-2026' and is_active) then
    raise exception 'US Open badge is missing or inactive';
  end if;
end;
$$;

with awarded as (
  insert into public.tour_manager_user_badges
    (user_id, badge_key, is_equipped, metadata, grant_notified_at)
  select user_id, 'usopen-night-2026', false,
    jsonb_build_object('acquisition','us_open_event_grant',
      'grant_event','2026_us_open_manager','grant_station_key','2026-w35-us-open',
      'grant_title','2026美网限定·不夜之境','grant_ref','20260920-usopen-participants'), null
  from us_open_badge_recipients
  on conflict (user_id, badge_key) do nothing
  returning user_id
)
select (select count(*) from us_open_badge_recipients) as eligible_users,
  count(*) as newly_granted,
  (select count(*) from us_open_badge_recipients) - count(*) as already_owned_skipped
from awarded;

commit;
