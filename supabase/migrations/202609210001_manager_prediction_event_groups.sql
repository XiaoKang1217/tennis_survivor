begin;

-- Only this dual-WTA station uses one question per event; other stations keep tour uniqueness.
alter table public.tour_manager_daily_prediction_games
  add column if not exists selection_group text generated always as (
    case when station_key = '2026-w39-seoul-singapore' then event_key else tour end
  ) stored;
alter table public.tour_manager_daily_prediction_games
  drop constraint if exists tour_manager_daily_prediction_station_key_contest_date_tour_key;
create unique index if not exists tour_manager_prediction_group_once_idx
  on public.tour_manager_daily_prediction_games(station_key, contest_date, selection_group);

-- Keep the legacy RPC usable after replacing its conflict target.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.tour_manager_refresh_daily_prediction_games(text,integer,date)'::regprocedure);
  definition := replace(definition, 'on conflict (station_key, contest_date, tour) do nothing',
    'on conflict (station_key, contest_date, selection_group) do nothing');
  execute definition;
end $$;

commit;
