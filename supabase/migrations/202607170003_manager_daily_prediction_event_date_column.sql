-- Repair databases created from an early daily-prediction draft that did not
-- yet include event_date. This migration only changes prediction game data;
-- it does not settle picks or modify wallet balances.

alter table public.tour_manager_daily_prediction_games
  add column if not exists event_date date;

create or replace function public.tour_manager_match_event_date(
  p_raw jsonb,
  p_scheduled_at timestamptz,
  p_timezone text default 'UTC'
)
returns date
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_raw ->> 'date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then (p_raw ->> 'date')::date
    else (timezone(coalesce(nullif(trim(p_timezone), ''), 'UTC'), p_scheduled_at))::date
  end;
$$;

update public.tour_manager_daily_prediction_games g
set event_date = public.tour_manager_match_event_date(
  coalesce(m.raw, '{}'::jsonb),
  coalesce(m.scheduled_at, g.scheduled_at),
  e.metadata ->> 'timezone'
)
from public.tour_manager_matches m,
     public.tour_manager_events e
where g.event_date is null
  and m.event_key = g.event_key
  and m.match_key = g.match_key
  and e.event_key = g.event_key;

update public.tour_manager_daily_prediction_games
set event_date = contest_date
where event_date is null;
