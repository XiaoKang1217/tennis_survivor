begin;

do $$
declare affected integer;
begin
  update public.tour_manager_events
  set submission_cutoff_at = '2026-09-21T10:45:00+08:00'::timestamptz,
      submission_closes_at = '2026-09-21T10:45:00+08:00'::timestamptz,
      metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{market_message}',
        to_jsonb(replace(coalesce(metadata->>'market_message', ''), '09/21 09:45', '09/21 10:45')))
  where station_key = '2026-w39-seoul-singapore'
    and event_key in ('wta-2026-w39-seoul', 'wta-2026-w39-singapore');
  get diagnostics affected = row_count;
  if affected <> 2 then
    raise exception 'Expected exactly two station events, got %', affected;
  end if;
end $$;

commit;

select event_key,
       submission_cutoff_at at time zone 'Asia/Shanghai' as cutoff_beijing,
       submission_closes_at at time zone 'Asia/Shanghai' as closes_beijing,
       metadata->>'market_message' as market_message
from public.tour_manager_events
where station_key = '2026-w39-seoul-singapore'
order by event_key;
