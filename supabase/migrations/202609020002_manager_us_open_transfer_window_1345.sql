-- US Open 2026: delay the shared ATP/WTA transfer window because R1 is still active.

update public.tour_manager_events
set
  transfer_window_opens_at = '2026-09-02T13:45:00+08:00'::timestamptz,
  transfer_window_closes_at = '2026-09-02T22:45:00+08:00'::timestamptz,
  transfer_window_note = '本站换人窗口为 09/02 13:45 - 09/02 22:45；ATP/WTA 同一窗口开放，男女可互换，手续费 15%。换人时不管本金多少不再享受低保折扣。若换下提交时冻结的全村希望，换入球员自动继承全村希望。',
  transfer_fee_rate = 0.15,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'cross_tour_transfer', true,
    'transfer_welfare_discount', false
  ),
  updated_at = now()
where station_key = '2026-w35-us-open'
  and season = 2026
  and tour in ('ATP', 'WTA')
  and event_key in (
    'atp-2026-w35-us-open',
    'wta-2026-w35-us-open'
  );

do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.tour_manager_events
  where station_key = '2026-w35-us-open'
    and season = 2026
    and tour in ('ATP', 'WTA')
    and event_key in (
      'atp-2026-w35-us-open',
      'wta-2026-w35-us-open'
    )
    and transfer_window_opens_at = '2026-09-02T13:45:00+08:00'::timestamptz
    and transfer_window_closes_at = '2026-09-02T22:45:00+08:00'::timestamptz
    and transfer_fee_rate = 0.15
    and lower(coalesce(metadata->>'cross_tour_transfer', 'false')) in ('true', '1', 'yes')
    and lower(coalesce(metadata->>'transfer_welfare_discount', 'true')) in ('false', '0', 'no');

  if v_count <> 2 then
    raise exception 'us_open_transfer_window_1345_update_incomplete: expected 2 events, got %', v_count;
  end if;
end
$$;
