-- Repair databases that already ran 202607170001 while missing the event-date
-- helper from the original daily-prediction migration. No data or money moves.

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
