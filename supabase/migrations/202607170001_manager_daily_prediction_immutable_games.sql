-- Freeze each published daily prediction question and enrich reward ledger rows.
-- This is a compatibility migration for databases that already ran 202607150001.

alter table public.tour_manager_daily_prediction_games
  add column if not exists event_date date;

-- Some databases ran an earlier daily-prediction draft without this helper.
-- Keep this migration self-contained so the refresh RPC can always resolve the
-- exact argument types supplied by tour_manager_matches.scheduled_at.
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

create or replace function public.tour_manager_refresh_daily_prediction_games(
  p_station_key text,
  p_season int default 2026,
  p_contest_date date default (timezone('Asia/Shanghai', now()))::date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tour text;
  v_event_date date;
  v_match record;
  v_created int := 0;
  v_existing int := 0;
  v_missing text[] := '{}';
begin
  if nullif(trim(p_station_key), '') is null then
    raise exception 'station_key_required';
  end if;

  foreach v_tour in array array['ATP','WTA'] loop
    -- The first successfully published question is the permanent snapshot for
    -- this station/date/tour. Later schedule and ranking refreshes cannot replace it.
    if exists (
      select 1 from public.tour_manager_daily_prediction_games g
      where g.station_key = p_station_key
        and g.season = p_season
        and g.contest_date = p_contest_date
        and g.tour = v_tour
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    select public.tour_manager_match_event_date(
      m.raw,
      m.scheduled_at,
      e.metadata ->> 'timezone'
    )
    into v_event_date
    from public.tour_manager_matches m
    join public.tour_manager_events e on e.event_key = m.event_key
    where e.station_key = p_station_key
      and e.season = p_season
      and m.tour = v_tour
      and m.status = 'scheduled'
      and m.scheduled_at is not null
      and m.scheduled_at > now()
    order by m.scheduled_at asc, m.match_key asc
    limit 1;

    if v_event_date is null then
      v_missing := array_append(v_missing, v_tour);
      continue;
    end if;

    select
      m.event_key,
      m.match_key,
      v_event_date as event_date,
      m.scheduled_at,
      m.player1_key,
      coalesce(nullif(m.player1_name, ''), p1.name_zh, p1.name_en, m.player1_key) as player1_name,
      p1.ranking as player1_ranking,
      m.player2_key,
      coalesce(nullif(m.player2_name, ''), p2.name_zh, p2.name_en, m.player2_key) as player2_name,
      p2.ranking as player2_ranking,
      abs(p1.ranking - p2.ranking) as ranking_gap
    into v_match
    from public.tour_manager_matches m
    join public.tour_manager_events e on e.event_key = m.event_key
    join public.tour_manager_event_players p1
      on p1.event_key = m.event_key and p1.player_key = m.player1_key
    join public.tour_manager_event_players p2
      on p2.event_key = m.event_key and p2.player_key = m.player2_key
    where e.station_key = p_station_key
      and e.season = p_season
      and m.tour = v_tour
      and m.status = 'scheduled'
      and m.scheduled_at is not null
      and public.tour_manager_match_event_date(
        m.raw,
        m.scheduled_at,
        e.metadata ->> 'timezone'
      ) = v_event_date
      and m.scheduled_at > now()
      and m.player1_key is not null
      and m.player2_key is not null
      and p1.ranking is not null and p1.ranking > 0
      and p2.ranking is not null and p2.ranking > 0
      and not exists (
        select 1 from public.tour_manager_daily_prediction_games used
        where used.event_key = m.event_key and used.match_key = m.match_key
      )
    order by
      abs(p1.ranking - p2.ranking) asc,
      m.scheduled_at desc,
      coalesce(m.match_order, 2147483647) asc,
      m.match_key asc
    limit 1;

    if not found then
      v_missing := array_append(v_missing, v_tour);
      continue;
    end if;

    insert into public.tour_manager_daily_prediction_games (
      season, station_key, contest_date, event_date, tour, event_key, match_key,
      scheduled_at, closes_at,
      player1_key, player1_name, player1_ranking,
      player2_key, player2_name, player2_ranking,
      ranking_gap, reward_amount, selection_method
    ) values (
      p_season, p_station_key, p_contest_date, v_match.event_date, v_tour, v_match.event_key, v_match.match_key,
      v_match.scheduled_at, v_match.scheduled_at,
      v_match.player1_key, v_match.player1_name, v_match.player1_ranking,
      v_match.player2_key, v_match.player2_name, v_match.player2_ranking,
      v_match.ranking_gap, 10, 'closest_world_rank_official_event_day'
    )
    on conflict (station_key, contest_date, tour) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  return jsonb_build_object(
    'station_key', p_station_key,
    'season', p_season,
    'contest_date', p_contest_date,
    'replaced_total', 0,
    'replaced_unpicked', 0,
    'replaced_legacy', 0,
    'created', v_created,
    'existing', v_existing,
    'missing_tours', to_jsonb(v_missing)
  );
end;
$$;

revoke all on function public.tour_manager_refresh_daily_prediction_games(text,int,date) from public, anon, authenticated;
grant execute on function public.tour_manager_refresh_daily_prediction_games(text,int,date) to service_role;

create or replace function public.tour_manager_enrich_daily_prediction_reward_ledger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_player_key text;
  v_player_name text;
  v_tour text;
begin
  if new.type <> 'daily_prediction_reward' then
    return new;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  v_player_key := coalesce(
    nullif(new.metadata ->> 'income_player_key', ''),
    nullif(new.metadata ->> 'picked_player_key', ''),
    nullif(new.metadata ->> 'winner_key', '')
  );
  v_player_name := coalesce(
    nullif(new.metadata ->> 'income_player_name', ''),
    nullif(new.metadata ->> 'picked_player_name', ''),
    nullif(new.metadata ->> 'winner_name', '')
  );
  v_tour := nullif(new.metadata ->> 'tour', '');

  new.metadata := new.metadata || jsonb_strip_nulls(jsonb_build_object(
    'income_player_key', v_player_key,
    'income_player_name', v_player_name
  ));

  if v_player_name is not null then
    new.description := concat_ws(
      ' · ',
      '每日竞猜奖励',
      v_tour,
      '猜中' || v_player_name
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tour_manager_enrich_daily_prediction_reward_ledger_trg
  on public.tour_manager_wallet_ledger;
create trigger tour_manager_enrich_daily_prediction_reward_ledger_trg
before insert or update of type, description, metadata
on public.tour_manager_wallet_ledger
for each row
execute function public.tour_manager_enrich_daily_prediction_reward_ledger();

-- Existing prediction rewards already contain picked/winner snapshots. Normalize
-- them once so old and new rows share the same frontend contract.
update public.tour_manager_wallet_ledger
set metadata = coalesce(metadata, '{}'::jsonb)
where type = 'daily_prediction_reward';
