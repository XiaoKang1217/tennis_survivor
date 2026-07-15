-- Daily ATP/WTA match predictions for Tour Manager.
-- One match per tour and China-facing contest day, selected from the complete official event day.

create table if not exists public.tour_manager_daily_prediction_games (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  station_key text not null,
  contest_date date not null,
  event_date date,
  tour text not null check (tour in ('ATP','WTA')),
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  match_key text not null,
  scheduled_at timestamptz not null,
  closes_at timestamptz not null,
  player1_key text not null,
  player1_name text not null,
  player1_ranking int not null check (player1_ranking > 0),
  player2_key text not null,
  player2_name text not null,
  player2_ranking int not null check (player2_ranking > 0),
  ranking_gap int not null check (ranking_gap >= 0),
  reward_amount int not null default 10 check (reward_amount > 0),
  selection_method text not null default 'closest_world_rank_official_event_day',
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  winner_key text,
  winner_name text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_key, contest_date, tour),
  unique (event_key, match_key),
  check (closes_at <= scheduled_at),
  check (player1_key <> player2_key)
);

alter table public.tour_manager_daily_prediction_games
  add column if not exists event_date date;

create table if not exists public.tour_manager_daily_prediction_picks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tour_manager_daily_prediction_games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  picked_player_key text not null,
  picked_player_name text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  is_correct boolean,
  reward_amount int not null default 0 check (reward_amount >= 0),
  unique (game_id, user_id)
);

create index if not exists tour_manager_daily_prediction_games_lookup_idx
  on public.tour_manager_daily_prediction_games (station_key, season, contest_date, tour);
create index if not exists tour_manager_daily_prediction_games_pending_idx
  on public.tour_manager_daily_prediction_games (status, contest_date);
create index if not exists tour_manager_daily_prediction_picks_user_idx
  on public.tour_manager_daily_prediction_picks (user_id, submitted_at desc);
create unique index if not exists tour_manager_daily_prediction_reward_once_idx
  on public.tour_manager_wallet_ledger (user_id, ((metadata ->> 'prediction_pick_id')))
  where type = 'daily_prediction_reward';

alter table public.tour_manager_daily_prediction_games enable row level security;
alter table public.tour_manager_daily_prediction_picks enable row level security;

drop policy if exists "daily prediction games are public" on public.tour_manager_daily_prediction_games;
create policy "daily prediction games are public"
  on public.tour_manager_daily_prediction_games for select
  using (true);

drop policy if exists "users read own daily prediction picks" on public.tour_manager_daily_prediction_picks;
create policy "users read own daily prediction picks"
  on public.tour_manager_daily_prediction_picks for select
  using (auth.uid() = user_id);

grant select on public.tour_manager_daily_prediction_games to anon, authenticated;
grant select on public.tour_manager_daily_prediction_picks to authenticated;

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
  v_replaced int := 0;
  v_legacy_replaced int := 0;
  v_deleted int := 0;
  v_missing text[] := '{}';
begin
  if nullif(trim(p_station_key), '') is null then
    raise exception 'station_key_required';
  end if;

  -- Pre-launch repair: remove only questions created by the old China-calendar
  -- selector. Picks cascade with the invalid test question; official-day questions
  -- created below remain protected once anyone submits.
  delete from public.tour_manager_daily_prediction_games g
  where g.station_key = p_station_key
    and g.season = p_season
    and g.contest_date = p_contest_date
    and g.status = 'open'
    and now() < g.closes_at
    and g.selection_method = 'closest_world_rank';
  get diagnostics v_legacy_replaced = row_count;
  v_replaced := v_replaced + v_legacy_replaced;

  foreach v_tour in array array['ATP','WTA'] loop
    if exists (
      select 1 from public.tour_manager_daily_prediction_games g
      where g.station_key = p_station_key
        and g.season = p_season
        and g.contest_date = p_contest_date
        and g.tour = v_tour
        and (
          g.status <> 'open'
          or now() >= g.closes_at
          or exists (
            select 1 from public.tour_manager_daily_prediction_picks p
            where p.game_id = g.id
          )
        )
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
          and not (
            used.station_key = p_station_key
            and used.season = p_season
            and used.contest_date = p_contest_date
            and used.tour = v_tour
          )
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

    update public.tour_manager_daily_prediction_games g
    set event_date = v_match.event_date,
        selection_method = 'closest_world_rank_official_event_day',
        updated_at = now()
    where g.station_key = p_station_key
      and g.season = p_season
      and g.contest_date = p_contest_date
      and g.tour = v_tour
      and g.event_key = v_match.event_key
      and g.match_key = v_match.match_key;
    if found then
      v_existing := v_existing + 1;
      continue;
    end if;

    delete from public.tour_manager_daily_prediction_games g
    where g.station_key = p_station_key
      and g.season = p_season
      and g.contest_date = p_contest_date
      and g.tour = v_tour
      and g.status = 'open'
      and now() < g.closes_at
      and not exists (
        select 1 from public.tour_manager_daily_prediction_picks p
        where p.game_id = g.id
      );
    get diagnostics v_deleted = row_count;
    v_replaced := v_replaced + v_deleted;

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
    'replaced_total', v_replaced,
    'replaced_unpicked', v_replaced - v_legacy_replaced,
    'replaced_legacy', v_legacy_replaced,
    'created', v_created,
    'existing', v_existing,
    'missing_tours', to_jsonb(v_missing)
  );
end;
$$;

create or replace function public.tour_manager_get_daily_predictions(
  p_station_key text,
  p_season int default 2026,
  p_contest_date date default (timezone('Asia/Shanghai', now()))::date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'station_key', p_station_key,
    'season', p_season,
    'contest_date', p_contest_date,
    'games', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'tour', g.tour,
        'event_key', g.event_key,
        'match_key', g.match_key,
        'event_date', g.event_date,
        'scheduled_at', g.scheduled_at,
        'closes_at', g.closes_at,
        'player1_key', g.player1_key,
        'player1_name', g.player1_name,
        'player1_ranking', g.player1_ranking,
        'player2_key', g.player2_key,
        'player2_name', g.player2_name,
        'player2_ranking', g.player2_ranking,
        'ranking_gap', g.ranking_gap,
        'reward_amount', g.reward_amount,
        'status', case when g.status = 'open' and now() >= g.closes_at then 'closed' else g.status end,
        'winner_key', g.winner_key,
        'winner_name', g.winner_name,
        'my_pick', case when p.id is null then null else jsonb_build_object(
          'id', p.id,
          'picked_player_key', p.picked_player_key,
          'picked_player_name', p.picked_player_name,
          'submitted_at', p.submitted_at,
          'is_correct', p.is_correct,
          'reward_amount', p.reward_amount,
          'settled_at', p.settled_at
        ) end
      ) order by case g.tour when 'ATP' then 1 else 2 end
    ), '[]'::jsonb)
  )
  from public.tour_manager_daily_prediction_games g
  left join public.tour_manager_daily_prediction_picks p
    on p.game_id = g.id and p.user_id = auth.uid()
  where g.station_key = p_station_key
    and g.season = p_season
    and g.contest_date = p_contest_date;
$$;

create or replace function public.tour_manager_submit_daily_prediction(
  p_game_id uuid,
  p_player_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_game public.tour_manager_daily_prediction_games;
  v_match public.tour_manager_matches;
  v_name text;
  v_pick public.tour_manager_daily_prediction_picks;
begin
  if v_user is null then raise exception 'auth_required'; end if;

  select * into v_game
  from public.tour_manager_daily_prediction_games
  where id = p_game_id
  for update;

  if v_game.id is null then raise exception 'prediction_game_not_found'; end if;
  if v_game.status <> 'open' or now() >= v_game.closes_at then
    raise exception 'prediction_submission_closed';
  end if;

  select * into v_match
  from public.tour_manager_matches
  where event_key = v_game.event_key and match_key = v_game.match_key;

  if v_match.id is null or v_match.status <> 'scheduled' or v_match.scheduled_at <= now() then
    raise exception 'prediction_match_started';
  end if;

  if p_player_key = v_game.player1_key then v_name := v_game.player1_name;
  elsif p_player_key = v_game.player2_key then v_name := v_game.player2_name;
  else raise exception 'invalid_prediction_player';
  end if;

  insert into public.tour_manager_daily_prediction_picks (
    game_id, user_id, picked_player_key, picked_player_name
  ) values (
    v_game.id, v_user, p_player_key, v_name
  )
  on conflict (game_id, user_id) do update set
    picked_player_key = excluded.picked_player_key,
    picked_player_name = excluded.picked_player_name,
    updated_at = now()
  returning * into v_pick;

  return jsonb_build_object(
    'game_id', v_game.id,
    'tour', v_game.tour,
    'picked_player_key', v_pick.picked_player_key,
    'picked_player_name', v_pick.picked_player_name,
    'submitted_at', v_pick.submitted_at,
    'updated_at', v_pick.updated_at,
    'closes_at', v_game.closes_at
  );
end;
$$;

create or replace function public.tour_manager_submit_daily_predictions(
  p_picks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) = 0 then
    raise exception 'prediction_picks_required';
  end if;

  for v_item in select value from jsonb_array_elements(p_picks) loop
    v_result := public.tour_manager_submit_daily_prediction(
      (v_item ->> 'game_id')::uuid,
      v_item ->> 'player_key'
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object('picks', v_results, 'submitted_count', jsonb_array_length(v_results));
end;
$$;

create or replace function public.tour_manager_settle_daily_predictions(
  p_season int default 2026,
  p_through_date date default ((timezone('Asia/Shanghai', now()))::date - 1)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game record;
  v_pick record;
  v_correct boolean;
  v_balance int;
  v_lineup_id uuid;
  v_games_settled int := 0;
  v_games_cancelled int := 0;
  v_picks_settled int := 0;
  v_correct_picks int := 0;
  v_rewards_paid int := 0;
begin
  for v_game in
    select
      g.*,
      m.status as match_status,
      m.winner_key as match_winner_key,
      m.winner_name as match_winner_name
    from public.tour_manager_daily_prediction_games g
    join public.tour_manager_matches m
      on m.event_key = g.event_key and m.match_key = g.match_key
    where g.season = p_season
      and g.status = 'open'
      and g.contest_date <= p_through_date
      and m.status in ('completed','walkover','retired','cancelled')
    order by g.contest_date, g.tour
    for update of g
  loop
    if v_game.match_status = 'cancelled' or v_game.match_winner_key is null then
      update public.tour_manager_daily_prediction_picks
      set settled_at = now(), is_correct = false, reward_amount = 0, updated_at = now()
      where game_id = v_game.id and settled_at is null;

      update public.tour_manager_daily_prediction_games
      set status = 'cancelled', settled_at = now(), updated_at = now()
      where id = v_game.id;
      v_games_cancelled := v_games_cancelled + 1;
      continue;
    end if;

    for v_pick in
      select * from public.tour_manager_daily_prediction_picks
      where game_id = v_game.id and settled_at is null
      order by submitted_at, id
      for update
    loop
      v_correct := v_pick.picked_player_key = v_game.match_winner_key;
      v_balance := null;
      v_lineup_id := null;

      if v_correct then
        insert into public.tour_manager_wallets (user_id, season, balance)
        values (v_pick.user_id, p_season, 300)
        on conflict (user_id, season) do nothing;

        update public.tour_manager_wallets
        set balance = balance + v_game.reward_amount, updated_at = now()
        where user_id = v_pick.user_id and season = p_season
        returning balance into v_balance;

        select l.id into v_lineup_id
        from public.tour_manager_lineups l
        where l.user_id = v_pick.user_id
          and l.station_key = v_game.station_key
          and l.season = p_season
          and l.status <> 'cancelled'
        order by l.submitted_at desc
        limit 1;

        insert into public.tour_manager_wallet_ledger (
          user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
        ) values (
          v_pick.user_id,
          p_season,
          v_game.station_key,
          v_lineup_id,
          'daily_prediction_reward',
          v_game.reward_amount,
          v_balance,
          '每日竞猜奖励',
          jsonb_build_object(
            'prediction_pick_id', v_pick.id,
            'prediction_game_id', v_game.id,
            'contest_date', v_game.contest_date,
            'tour', v_game.tour,
            'event_key', v_game.event_key,
            'match_key', v_game.match_key,
            'picked_player_key', v_pick.picked_player_key,
            'picked_player_name', v_pick.picked_player_name,
            'winner_key', v_game.match_winner_key,
            'winner_name', v_game.match_winner_name,
            'reward', v_game.reward_amount,
            'principal_reward', true
          )
        );

        v_correct_picks := v_correct_picks + 1;
        v_rewards_paid := v_rewards_paid + v_game.reward_amount;
      end if;

      update public.tour_manager_daily_prediction_picks
      set
        settled_at = now(),
        is_correct = v_correct,
        reward_amount = case when v_correct then v_game.reward_amount else 0 end,
        updated_at = now()
      where id = v_pick.id;
      v_picks_settled := v_picks_settled + 1;
    end loop;

    update public.tour_manager_daily_prediction_games
    set
      status = 'settled',
      winner_key = v_game.match_winner_key,
      winner_name = v_game.match_winner_name,
      settled_at = now(),
      updated_at = now()
    where id = v_game.id;
    v_games_settled := v_games_settled + 1;
  end loop;

  return jsonb_build_object(
    'season', p_season,
    'through_date', p_through_date,
    'games_settled', v_games_settled,
    'games_cancelled', v_games_cancelled,
    'picks_settled', v_picks_settled,
    'correct_picks', v_correct_picks,
    'rewards_paid', v_rewards_paid
  );
end;
$$;

revoke all on function public.tour_manager_refresh_daily_prediction_games(text,int,date) from public, anon, authenticated;
grant execute on function public.tour_manager_refresh_daily_prediction_games(text,int,date) to service_role;
revoke all on function public.tour_manager_settle_daily_predictions(int,date) from public, anon, authenticated;
grant execute on function public.tour_manager_settle_daily_predictions(int,date) to service_role;
revoke all on function public.tour_manager_get_daily_predictions(text,int,date) from public;
grant execute on function public.tour_manager_get_daily_predictions(text,int,date) to anon, authenticated;
revoke all on function public.tour_manager_submit_daily_prediction(uuid,text) from public, anon;
grant execute on function public.tour_manager_submit_daily_prediction(uuid,text) to authenticated;
revoke all on function public.tour_manager_submit_daily_predictions(jsonb) from public, anon;
grant execute on function public.tour_manager_submit_daily_predictions(jsonb) to authenticated;

drop view if exists public.tour_manager_station_net_leaderboard;
create or replace view public.tour_manager_station_net_leaderboard
as
with lineup_base as (
  select
    l.id as lineup_id,
    l.user_id,
    l.season,
    l.station_key,
    l.submitted_at,
    coalesce(p.display_name, '炉友') as display_name,
    ab.badge_key,
    ab.title as badge_title,
    ab.thumb_url as badge_thumb_url
  from public.tour_manager_lineups l
  left join public.profiles p on p.id = l.user_id
  left join public.tour_manager_active_badges ab on ab.user_id = l.user_id
  where l.status in ('submitted','locked','settling','settled')
),
ledger_totals as (
  select
    wl.lineup_id,
    coalesce(sum(wl.amount) filter (where wl.type = 'player_points_delta'), 0)::int as player_settlement_income,
    coalesce(sum(wl.amount) filter (where wl.type = 'station_combo_bonus'), 0)::int as combo_bonus
  from public.tour_manager_wallet_ledger wl
  where wl.type in ('player_points_delta','station_combo_bonus')
  group by wl.lineup_id
),
scored as (
  select
    lb.station_key,
    lb.season,
    lb.lineup_id,
    lb.display_name,
    lb.badge_key,
    lb.badge_title,
    lb.badge_thumb_url,
    coalesce(lt.player_settlement_income, 0)::int as player_settlement_income,
    coalesce(lt.combo_bonus, 0)::int as combo_bonus,
    (coalesce(lt.player_settlement_income, 0) + coalesce(lt.combo_bonus, 0))::int as station_net_income,
    lb.submitted_at
  from lineup_base lb
  left join ledger_totals lt on lt.lineup_id = lb.lineup_id
)
select
  row_number() over (
    partition by station_key, season
    order by station_net_income desc, player_settlement_income desc, combo_bonus desc, submitted_at asc, lineup_id
  )::int as rank_no,
  station_key,
  season,
  lineup_id,
  display_name,
  badge_key,
  badge_title,
  badge_thumb_url,
  station_net_income,
  player_settlement_income,
  combo_bonus,
  submitted_at
from scored;

grant select on public.tour_manager_station_net_leaderboard to anon, authenticated;

-- Make a freshly installed migration immediately testable when today's schedule is present.
do $$
declare
  v_station_key text;
  v_season int;
begin
  select e.station_key, e.season
  into v_station_key, v_season
  from public.tour_manager_events e
  join public.tour_manager_matches m on m.event_key = e.event_key
  where m.status = 'scheduled'
    and m.scheduled_at > now()
  order by e.updated_at desc
  limit 1;

  if v_station_key is not null then
    perform public.tour_manager_refresh_daily_prediction_games(
      v_station_key,
      v_season,
      (timezone('Asia/Shanghai', now()))::date
    );
  end if;
end;
$$;
