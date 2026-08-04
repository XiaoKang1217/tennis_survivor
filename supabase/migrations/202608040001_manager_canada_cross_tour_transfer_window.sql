-- 加拿大 ATP + WTA：统一开放 08/04 换人窗口，允许男女互换，手续费 15%。

update public.tour_manager_events
set
  transfer_window_opens_at = '2026-08-04T11:00:00+08:00'::timestamptz,
  transfer_window_closes_at = '2026-08-04T23:59:00+08:00'::timestamptz,
  transfer_window_note = '本站换人窗口为 08/04 11:00 - 08/04 23:59；ATP/WTA 同一窗口开放，男女可互换，手续费 15%。',
  transfer_fee_rate = 0.15,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cross_tour_transfer', true),
  updated_at = now()
where station_key = '2026-w32-canada'
  and season = 2026
  and tour in ('ATP', 'WTA')
  and event_key in (
    'atp-2026-w32-montreal-national-bank-open',
    'wta-2026-w32-toronto-national-bank-open'
  );

-- 换人 RPC 以阵容上锁时的费率计费，同步存量加拿大阵容为 15%。
update public.tour_manager_lineups
set transfer_fee_rate = 0.15,
    updated_at = now()
where station_key = '2026-w32-canada'
  and season = 2026
  and status in ('submitted', 'locked', 'settling');

do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.tour_manager_events
  where station_key = '2026-w32-canada'
    and season = 2026
    and tour in ('ATP', 'WTA')
    and transfer_window_opens_at = '2026-08-04T11:00:00+08:00'::timestamptz
    and transfer_window_closes_at = '2026-08-04T23:59:00+08:00'::timestamptz
    and transfer_fee_rate = 0.15
    and lower(coalesce(metadata->>'cross_tour_transfer', 'false')) in ('true', '1', 'yes');

  if v_count <> 2 then
    raise exception 'canada_transfer_window_update_incomplete: expected 2 events, got %', v_count;
  end if;
end
$$;
