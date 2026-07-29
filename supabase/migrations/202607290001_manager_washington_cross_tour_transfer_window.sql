-- 华盛顿 ATP + WTA：统一开放换人窗口，并允许同站男女球员互换。

update public.tour_manager_events
set
  transfer_window_opens_at = '2026-07-29T10:30:00+08:00'::timestamptz,
  transfer_window_closes_at = '2026-07-29T22:45:00+08:00'::timestamptz,
  transfer_window_note = '本站换人窗口为 07/29 10:30 - 07/29 22:45；ATP/WTA 同一窗口开放，男女可以互换。',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cross_tour_transfer', true),
  updated_at = now()
where station_key = '2026-w31-washington'
  and season = 2026
  and tour in ('ATP', 'WTA')
  and event_key in (
    'atp-2026-w31-washington-mubadala-citi-dc-open',
    'wta-2026-w31-washington-mubadala-citi-dc-open'
  );

do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.tour_manager_events
  where station_key = '2026-w31-washington'
    and season = 2026
    and tour in ('ATP', 'WTA')
    and transfer_window_opens_at = '2026-07-29T10:30:00+08:00'::timestamptz
    and transfer_window_closes_at = '2026-07-29T22:45:00+08:00'::timestamptz
    and lower(coalesce(metadata->>'cross_tour_transfer', 'false')) in ('true', '1', 'yes');

  if v_count <> 2 then
    raise exception 'washington_transfer_window_update_incomplete: expected 2 events, got %', v_count;
  end if;
end
$$;
