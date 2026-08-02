-- Canada ATP + WTA: extend the authoritative lineup submission deadline to
-- 2026-08-02 22:45 China time. Keep both backend gates aligned with the
-- event JSON consumed by the frontend and manager sync workflow.

update public.tour_manager_events
set
  submission_cutoff_at = '2026-08-02T22:45:00+08:00'::timestamptz,
  submission_closes_at = '2026-08-02T22:45:00+08:00'::timestamptz,
  updated_at = now()
where station_key = '2026-w32-canada'
  and season = 2026
  and tour in ('ATP', 'WTA');

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
    and submission_cutoff_at = '2026-08-02T22:45:00+08:00'::timestamptz
    and submission_closes_at = '2026-08-02T22:45:00+08:00'::timestamptz;

  if v_count <> 2 then
    raise exception 'canada_submission_cutoff_update_incomplete: expected 2 events, got %', v_count;
  end if;
end
$$;
