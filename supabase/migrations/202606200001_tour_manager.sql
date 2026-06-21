-- 巡回赛经纪人生产化 schema
-- 用途：赛站元数据、球员身价、钱包、阵容提交、换人、账本、配置大厅和榜单。
-- 执行位置：Supabase SQL editor / migration pipeline。

create extension if not exists pgcrypto;

create table if not exists public.tour_manager_events (
  event_key text primary key,
  season int not null,
  station_key text not null,
  tour text not null check (tour in ('ATP','WTA')),
  event_id text,
  name text not null,
  name_zh text,
  level text not null check (level in ('250','500','1000','GS')),
  surface text not null check (surface in ('grass','clay','hard','hard_out','hard_in','indoor_hard')),
  draw_size int not null check (draw_size > 0),
  start_date date,
  end_date date,
  draw_status text not null default 'pending' check (draw_status in ('pending','published','updated','final')),
  market_status text not null default 'draw_pending' check (market_status in ('draw_pending','open','locked','settled','cancelled')),
  submission_opens_at timestamptz,
  submission_closes_at timestamptz,
  transfer_window_days int not null default 2,
  transfer_fee_rate numeric(5,4) not null default 0.10,
  source_urls text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tour_manager_data_sources (
  source_key text primary key,
  source_type text not null check (source_type in ('official_site','elo','calendar','manual')),
  tour text check (tour in ('ATP','WTA')),
  name text not null,
  base_url text not null,
  cadence text,
  enabled boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tour_manager_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text references public.tour_manager_data_sources(source_key),
  import_type text not null check (import_type in ('events','draw','schedule','results','rankings','elo','photos','pricing')),
  season int,
  tour text check (tour in ('ATP','WTA')),
  event_key text references public.tour_manager_events(event_key) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  fetched_url text,
  content_checksum text,
  rows_found int not null default 0,
  rows_written int not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.tour_manager_players (
  tour text not null check (tour in ('ATP','WTA')),
  player_key text not null,
  name_en text not null,
  name_zh text,
  official_profile_id text,
  official_profile_url text,
  tennis_abstract_slug text,
  country_code text,
  birth_date date,
  handedness text,
  photo_url text,
  photo_source text,
  photo_status text not null default 'pending' check (photo_status in ('pending','ready','missing','manual','error')),
  photo_storage_path text,
  photo_updated_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tour, player_key)
);

create table if not exists public.tour_manager_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  tour text not null check (tour in ('ATP','WTA')),
  ranking_type text not null default 'singles' check (ranking_type in ('singles')),
  ranking_date date not null,
  snapshot_date date not null default current_date,
  rank int not null check (rank > 0),
  player_key text not null,
  name_en text not null,
  points int,
  movement int,
  source_url text not null,
  import_run_id uuid references public.tour_manager_import_runs(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tour, ranking_type, ranking_date, rank),
  unique (tour, ranking_type, ranking_date, player_key)
);

create table if not exists public.tour_manager_elo_snapshots (
  id uuid primary key default gen_random_uuid(),
  tour text not null check (tour in ('ATP','WTA')),
  snapshot_date date not null default current_date,
  player_key text not null,
  name_en text not null,
  overall_elo numeric(8,2),
  hard_elo numeric(8,2),
  clay_elo numeric(8,2),
  grass_elo numeric(8,2),
  overall_rank int,
  hard_rank int,
  clay_rank int,
  grass_rank int,
  source_url text not null,
  import_run_id uuid references public.tour_manager_import_runs(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tour, snapshot_date, player_key)
);

create table if not exists public.tour_manager_draw_entries (
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  draw_version int not null default 1,
  draw_position int not null,
  tour text not null check (tour in ('ATP','WTA')),
  player_key text,
  placeholder_key text,
  name_en text,
  name_zh text,
  seed int,
  entry_status text not null default 'direct' check (
    entry_status in ('direct','seed','wildcard','qualifier','qualifier_placeholder','lucky_loser','alternate','withdrawn')
  ),
  first_round_opponent_key text,
  path jsonb not null default '{}'::jsonb,
  source_url text,
  import_run_id uuid references public.tour_manager_import_runs(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, draw_version, draw_position)
);

create table if not exists public.tour_manager_matches (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  match_key text not null,
  tour text not null check (tour in ('ATP','WTA')),
  round_key text not null,
  round_order int,
  match_order int,
  scheduled_at timestamptz,
  court text,
  player1_key text,
  player1_name text,
  player2_key text,
  player2_name text,
  winner_key text,
  winner_name text,
  score text,
  status text not null default 'scheduled' check (status in ('scheduled','live','completed','walkover','retired','cancelled')),
  source_url text,
  import_run_id uuid references public.tour_manager_import_runs(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_key, match_key)
);

create table if not exists public.tour_manager_price_versions (
  id uuid primary key default gen_random_uuid(),
  station_key text not null,
  season int not null,
  version int not null,
  status text not null default 'draft' check (status in ('draft','published','locked','archived')),
  formula_version text not null default 'v1',
  weights jsonb not null default '{"base":0.35,"surface":0.25,"draw":0.20,"form":0.15,"manual":0.05}'::jsonb,
  generated_from jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  locked_at timestamptz,
  unique (station_key, season, version)
);

create table if not exists public.tour_manager_price_version_players (
  price_version_id uuid not null references public.tour_manager_price_versions(id) on delete cascade,
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  player_key text not null,
  tour text not null check (tour in ('ATP','WTA')),
  name_en text,
  name_zh text,
  official_rank int,
  official_points int,
  overall_elo numeric(8,2),
  surface_elo numeric(8,2),
  base_score numeric(6,2) not null default 50,
  surface_score numeric(6,2) not null default 50,
  draw_score numeric(6,2) not null default 50,
  form_score numeric(6,2) not null default 50,
  manual_score numeric(6,2) not null default 0,
  total_score numeric(6,2) not null default 50,
  expected_points numeric(8,2),
  expected_round text,
  breakeven_round text,
  price int not null check (price >= 0),
  tier text,
  source_facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (price_version_id, event_key, player_key)
);

create table if not exists public.tour_manager_event_players (
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  player_key text not null,
  tour text not null check (tour in ('ATP','WTA')),
  name_zh text not null,
  name_en text,
  profile_id text,
  seed int,
  ranking int,
  draw_position int,
  first_round text,
  is_qualifier_placeholder boolean not null default false,
  base_score numeric(6,2) not null default 50,
  surface_score numeric(6,2) not null default 50,
  draw_score numeric(6,2) not null default 50,
  form_score numeric(6,2) not null default 50,
  manual_score numeric(6,2) not null default 0,
  total_score numeric(6,2) generated always as (
    base_score * 0.35
    + surface_score * 0.25
    + draw_score * 0.20
    + form_score * 0.15
    + manual_score * 0.05
  ) stored,
  price int not null check (price >= 0),
  photo_url text,
  photo_status text not null default 'pending' check (photo_status in ('pending','ready','missing','manual','error')),
  photo_storage_path text,
  photo_updated_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_key, player_key)
);

create table if not exists public.tour_manager_wallets (
  user_id uuid not null references auth.users(id) on delete cascade,
  season int not null,
  balance int not null default 300 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, season)
);

create table if not exists public.tour_manager_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season int not null,
  station_key text,
  lineup_id uuid,
  type text not null,
  amount int not null,
  balance_after int,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_manager_lineups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season int not null,
  station_key text not null,
  status text not null default 'submitted' check (status in ('draft','submitted','locked','settling','settled','cancelled')),
  lineup_cost int not null default 0,
  station_grant int not null default 0,
  station_grant_used int not null default 0,
  wallet_used int not null default 0,
  submission_bonus int not null default 10,
  min_players int not null,
  max_players int not null,
  transfer_count int not null default 0,
  max_transfers int not null default 1,
  transfer_fee_rate numeric(5,4) not null default 0.10,
  predicted_gross int not null default 0,
  predicted_bonus int not null default 0,
  predicted_net int not null default 0,
  lineup_style text,
  predictions jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  locked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, station_key)
);

create table if not exists public.tour_manager_lineup_players (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references public.tour_manager_lineups(id) on delete cascade,
  event_key text not null references public.tour_manager_events(event_key),
  player_key text not null,
  tour text not null check (tour in ('ATP','WTA')),
  name_zh text not null,
  name_en text,
  price int not null check (price >= 0),
  tier text,
  predicted_round text not null default 'OUT',
  reached_round text not null default 'OUT',
  earned_points int not null default 0,
  is_active boolean not null default true,
  is_transfer boolean not null default false,
  replaced_at timestamptz,
  replaced_by_contract_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_manager_transfers (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references public.tour_manager_lineups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  season int not null,
  station_key text not null,
  out_contract_id uuid not null references public.tour_manager_lineup_players(id),
  in_contract_id uuid not null references public.tour_manager_lineup_players(id),
  refund_amount int not null default 0,
  sunk_loss int not null default 0,
  new_contract_price int not null default 0,
  fee_amount int not null default 0,
  wallet_delta int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_manager_settlements (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references public.tour_manager_lineups(id) on delete cascade,
  contract_id uuid not null references public.tour_manager_lineup_players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  player_key text not null,
  round_key text not null,
  points_delta int not null default 0,
  is_final boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  settled_for_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (contract_id, round_key, settled_for_date)
);

create index if not exists tour_manager_lineups_station_idx on public.tour_manager_lineups(station_key, status);
create index if not exists tour_manager_lineup_players_lineup_idx on public.tour_manager_lineup_players(lineup_id);
create index if not exists tour_manager_wallet_ledger_user_idx on public.tour_manager_wallet_ledger(user_id, created_at desc);
create index if not exists tour_manager_import_runs_source_idx on public.tour_manager_import_runs(source_key, started_at desc);
create index if not exists tour_manager_players_name_idx on public.tour_manager_players(tour, name_en);
create index if not exists tour_manager_rankings_player_idx on public.tour_manager_ranking_snapshots(tour, player_key, ranking_date desc);
create index if not exists tour_manager_elo_player_idx on public.tour_manager_elo_snapshots(tour, player_key, snapshot_date desc);
create index if not exists tour_manager_draw_entries_event_idx on public.tour_manager_draw_entries(event_key, draw_version);
create index if not exists tour_manager_matches_event_idx on public.tour_manager_matches(event_key, round_order, match_order);
create index if not exists tour_manager_price_versions_station_idx on public.tour_manager_price_versions(station_key, season, status);

alter table public.tour_manager_events enable row level security;
alter table public.tour_manager_data_sources enable row level security;
alter table public.tour_manager_import_runs enable row level security;
alter table public.tour_manager_players enable row level security;
alter table public.tour_manager_ranking_snapshots enable row level security;
alter table public.tour_manager_elo_snapshots enable row level security;
alter table public.tour_manager_draw_entries enable row level security;
alter table public.tour_manager_matches enable row level security;
alter table public.tour_manager_price_versions enable row level security;
alter table public.tour_manager_price_version_players enable row level security;
alter table public.tour_manager_event_players enable row level security;
alter table public.tour_manager_wallets enable row level security;
alter table public.tour_manager_wallet_ledger enable row level security;
alter table public.tour_manager_lineups enable row level security;
alter table public.tour_manager_lineup_players enable row level security;
alter table public.tour_manager_transfers enable row level security;
alter table public.tour_manager_settlements enable row level security;

drop policy if exists tour_manager_events_read on public.tour_manager_events;
create policy tour_manager_events_read on public.tour_manager_events
for select using (true);

drop policy if exists tour_manager_event_players_read on public.tour_manager_event_players;
create policy tour_manager_event_players_read on public.tour_manager_event_players
for select using (true);

drop policy if exists tour_manager_data_sources_read on public.tour_manager_data_sources;
create policy tour_manager_data_sources_read on public.tour_manager_data_sources
for select using (true);

drop policy if exists tour_manager_import_runs_read on public.tour_manager_import_runs;
create policy tour_manager_import_runs_read on public.tour_manager_import_runs
for select using (status in ('success','partial','skipped'));

drop policy if exists tour_manager_players_read on public.tour_manager_players;
create policy tour_manager_players_read on public.tour_manager_players
for select using (true);

drop policy if exists tour_manager_ranking_snapshots_read on public.tour_manager_ranking_snapshots;
create policy tour_manager_ranking_snapshots_read on public.tour_manager_ranking_snapshots
for select using (true);

drop policy if exists tour_manager_elo_snapshots_read on public.tour_manager_elo_snapshots;
create policy tour_manager_elo_snapshots_read on public.tour_manager_elo_snapshots
for select using (true);

drop policy if exists tour_manager_draw_entries_read on public.tour_manager_draw_entries;
create policy tour_manager_draw_entries_read on public.tour_manager_draw_entries
for select using (true);

drop policy if exists tour_manager_matches_read on public.tour_manager_matches;
create policy tour_manager_matches_read on public.tour_manager_matches
for select using (true);

drop policy if exists tour_manager_price_versions_read_published on public.tour_manager_price_versions;
create policy tour_manager_price_versions_read_published on public.tour_manager_price_versions
for select using (status in ('published','locked'));

drop policy if exists tour_manager_price_version_players_read on public.tour_manager_price_version_players;
create policy tour_manager_price_version_players_read on public.tour_manager_price_version_players
for select using (
  exists (
    select 1
    from public.tour_manager_price_versions pv
    where pv.id = price_version_id
      and pv.status in ('published','locked')
  )
);

drop policy if exists tour_manager_wallets_read_own on public.tour_manager_wallets;
create policy tour_manager_wallets_read_own on public.tour_manager_wallets
for select using (auth.uid() = user_id);

drop policy if exists tour_manager_wallet_ledger_read_own on public.tour_manager_wallet_ledger;
create policy tour_manager_wallet_ledger_read_own on public.tour_manager_wallet_ledger
for select using (auth.uid() = user_id);

drop policy if exists tour_manager_lineups_read_own on public.tour_manager_lineups;
create policy tour_manager_lineups_read_own on public.tour_manager_lineups
for select using (auth.uid() = user_id);

drop policy if exists tour_manager_lineup_players_read_own on public.tour_manager_lineup_players;
create policy tour_manager_lineup_players_read_own on public.tour_manager_lineup_players
for select using (
  exists (
    select 1 from public.tour_manager_lineups l
    where l.id = lineup_id and l.user_id = auth.uid()
  )
);

drop policy if exists tour_manager_transfers_read_own on public.tour_manager_transfers;
create policy tour_manager_transfers_read_own on public.tour_manager_transfers
for select using (auth.uid() = user_id);

drop policy if exists tour_manager_settlements_read_own on public.tour_manager_settlements;
create policy tour_manager_settlements_read_own on public.tour_manager_settlements
for select using (auth.uid() = user_id);

create or replace function public.tour_manager_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tour_manager_events_touch on public.tour_manager_events;
create trigger tour_manager_events_touch
before update on public.tour_manager_events
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_data_sources_touch on public.tour_manager_data_sources;
create trigger tour_manager_data_sources_touch
before update on public.tour_manager_data_sources
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_players_touch on public.tour_manager_players;
create trigger tour_manager_players_touch
before update on public.tour_manager_players
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_draw_entries_touch on public.tour_manager_draw_entries;
create trigger tour_manager_draw_entries_touch
before update on public.tour_manager_draw_entries
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_matches_touch on public.tour_manager_matches;
create trigger tour_manager_matches_touch
before update on public.tour_manager_matches
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_wallets_touch on public.tour_manager_wallets;
create trigger tour_manager_wallets_touch
before update on public.tour_manager_wallets
for each row execute function public.tour_manager_touch_updated_at();

drop trigger if exists tour_manager_lineups_touch on public.tour_manager_lineups;
create trigger tour_manager_lineups_touch
before update on public.tour_manager_lineups
for each row execute function public.tour_manager_touch_updated_at();

create or replace function public.tour_manager_bootstrap_wallet(p_season int default 2026)
returns public.tour_manager_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  insert into public.tour_manager_wallets (user_id, season, balance)
  values (v_user, p_season, 300)
  on conflict (user_id, season) do nothing;

  select * into v_wallet
  from public.tour_manager_wallets
  where user_id = v_user and season = p_season;

  return v_wallet;
end;
$$;

create or replace function public.tour_manager_get_my_state(
  p_station_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_lineup public.tour_manager_lineups;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select * into v_lineup
  from public.tour_manager_lineups
  where user_id = v_user and station_key = p_station_key
  order by submitted_at desc
  limit 1;

  return jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'lineup', case when v_lineup.id is null then null else to_jsonb(v_lineup) end,
    'contracts', coalesce((
      select jsonb_agg(to_jsonb(lp) order by lp.created_at)
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = v_lineup.id
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(wl) order by wl.created_at desc)
      from (
        select *
        from public.tour_manager_wallet_ledger
        where user_id = v_user and season = p_season
        order by created_at desc
        limit 100
      ) wl
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.tour_manager_submit_lineup(
  p_station_key text,
  p_season int,
  p_station_grant int,
  p_min_players int,
  p_max_players int,
  p_transfer_fee_rate numeric,
  p_contracts jsonb,
  p_predictions jsonb default '{}'::jsonb,
  p_predicted_gross int default 0,
  p_predicted_bonus int default 0,
  p_predicted_net int default 0,
  p_lineup_style text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_balance int;
  v_count int;
  v_found int;
  v_cost int;
  v_station_used int;
  v_wallet_used int;
  v_lineup_id uuid;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if p_contracts is null or jsonb_typeof(p_contracts) <> 'array' then
    raise exception 'contracts_must_be_array';
  end if;

  select count(*) into v_count
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req;

  if v_count <> jsonb_array_length(p_contracts) then
    raise exception 'duplicate_contract_player';
  end if;

  if v_count < p_min_players or v_count > p_max_players then
    raise exception 'invalid_lineup_size';
  end if;

  with req as (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  )
  select count(*), coalesce(sum(ep.price), 0)
  into v_found, v_cost
  from req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key
  join public.tour_manager_events e
    on e.event_key = ep.event_key
  where e.market_status = 'open'
    and e.station_key = p_station_key
    and (e.submission_opens_at is null or now() >= e.submission_opens_at)
    and (e.submission_closes_at is null or now() <= e.submission_closes_at);

  if v_found <> v_count then
    raise exception 'invalid_or_closed_contract_player';
  end if;

  v_station_used := least(v_cost, greatest(p_station_grant, 0));
  v_wallet_used := greatest(v_cost - greatest(p_station_grant, 0), 0);

  perform public.tour_manager_bootstrap_wallet(p_season);
  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user and season = p_season
  for update;

  if exists (
    select 1 from public.tour_manager_lineups
    where user_id = v_user and station_key = p_station_key and status <> 'cancelled'
  ) then
    raise exception 'lineup_already_submitted';
  end if;

  if v_balance + greatest(p_station_grant, 0) < v_cost then
    raise exception 'insufficient_budget';
  end if;

  insert into public.tour_manager_lineups (
    user_id, season, station_key, status, lineup_cost, station_grant,
    station_grant_used, wallet_used, min_players, max_players,
    max_transfers, transfer_fee_rate, predictions,
    predicted_gross, predicted_bonus, predicted_net, lineup_style
  )
  values (
    v_user, p_season, p_station_key, 'submitted', v_cost, p_station_grant,
    v_station_used, v_wallet_used, p_min_players, p_max_players,
    1, coalesce(p_transfer_fee_rate, 0.10), coalesce(p_predictions, '{}'::jsonb),
    coalesce(p_predicted_gross, 0), coalesce(p_predicted_bonus, 0),
    coalesce(p_predicted_net, 0), p_lineup_style
  )
  returning id into v_lineup_id;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, metadata
  )
  select
    v_lineup_id,
    ep.event_key,
    ep.player_key,
    ep.tour,
    ep.name_zh,
    ep.name_en,
    ep.price,
    case
      when ep.price >= 300 then 'S'
      when ep.price >= 195 then 'B'
      when ep.price >= 90 then 'C'
      else 'D'
    end,
    coalesce(p_predictions->>ep.player_key, 'OUT'),
    to_jsonb(ep) || jsonb_build_object('client_prediction', coalesce(p_predictions->>ep.player_key, 'OUT'))
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key;

  update public.tour_manager_wallets
  set balance = balance - v_wallet_used + 10
  where user_id = v_user and season = p_season
  returning balance into v_balance;

  if v_wallet_used > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup_id, 'lineup_wallet_spend',
      -v_wallet_used, v_balance - 10, '提交阵容占用经纪人钱包',
      jsonb_build_object('lineup_cost', v_cost, 'station_grant_used', v_station_used)
    );
  end if;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, p_season, p_station_key, v_lineup_id, 'submit_bonus',
    10, v_balance, '提交阵容奖励', jsonb_build_object('lineup_cost', v_cost)
  );

  return public.tour_manager_get_my_state(p_station_key, p_season);
end;
$$;

create or replace function public.tour_manager_transfer_player(
  p_lineup_id uuid,
  p_out_contract_id uuid,
  p_in_contract jsonb,
  p_fee_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lineup public.tour_manager_lineups;
  v_out public.tour_manager_lineup_players;
  v_in public.tour_manager_event_players;
  v_event public.tour_manager_events;
  v_balance int;
  v_new_price int;
  v_refund int;
  v_fee int;
  v_delta int;
  v_in_id uuid;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select * into v_lineup
  from public.tour_manager_lineups
  where id = p_lineup_id and user_id = v_user
  for update;

  if v_lineup.id is null then
    raise exception 'lineup_not_found';
  end if;
  if v_lineup.transfer_count >= v_lineup.max_transfers then
    raise exception 'transfer_limit_reached';
  end if;
  if v_lineup.status not in ('submitted','locked','settling') then
    raise exception 'lineup_not_transferable';
  end if;

  select * into v_out
  from public.tour_manager_lineup_players
  where id = p_out_contract_id and lineup_id = p_lineup_id and is_active
  for update;

  if v_out.id is null then
    raise exception 'out_contract_not_found';
  end if;

  select ep.* into v_in
  from public.tour_manager_event_players ep
  join public.tour_manager_events e on e.event_key = ep.event_key
  where ep.event_key = p_in_contract->>'event_key'
    and ep.player_key = p_in_contract->>'player_key'
    and e.market_status in ('open','locked')
  limit 1;

  if v_in.player_key is null then
    raise exception 'invalid_new_contract';
  end if;

  select * into v_event
  from public.tour_manager_events
  where event_key = v_in.event_key;

  if v_event.start_date is not null
     and now() > (v_event.start_date::timestamptz + make_interval(days => v_event.transfer_window_days)) then
    raise exception 'transfer_window_closed';
  end if;

  if v_event.station_key <> v_lineup.station_key then
    raise exception 'contract_not_in_station';
  end if;

  if exists (
    select 1 from public.tour_manager_lineup_players lp
    where lp.lineup_id = p_lineup_id and lp.player_key = v_in.player_key and lp.is_active
  ) then
    raise exception 'player_already_active';
  end if;

  v_new_price := v_in.price;
  if v_new_price <= 0 then
    raise exception 'invalid_new_contract';
  end if;

  v_refund := round(v_out.price * 0.70);
  v_fee := ceil(v_new_price * coalesce(p_fee_rate, v_lineup.transfer_fee_rate));
  v_delta := v_new_price + v_fee - v_refund;

  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user and season = v_lineup.season
  for update;

  if v_delta > v_balance then
    raise exception 'insufficient_wallet_for_transfer';
  end if;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, is_transfer, metadata
  )
  values (
    p_lineup_id,
    v_in.event_key,
    v_in.player_key,
    v_in.tour,
    v_in.name_zh,
    v_in.name_en,
    v_new_price,
    case
      when v_in.price >= 300 then 'S'
      when v_in.price >= 195 then 'B'
      when v_in.price >= 90 then 'C'
      else 'D'
    end,
    coalesce(p_in_contract->>'predicted_round', 'OUT'),
    true,
    to_jsonb(v_in) || jsonb_build_object('client_prediction', coalesce(p_in_contract->>'predicted_round', 'OUT'))
  )
  returning id into v_in_id;

  update public.tour_manager_lineup_players
  set is_active = false, replaced_at = now(), replaced_by_contract_id = v_in_id
  where id = p_out_contract_id;

  update public.tour_manager_wallets
  set balance = balance - v_delta
  where user_id = v_user and season = v_lineup.season
  returning balance into v_balance;

  update public.tour_manager_lineups
  set transfer_count = transfer_count + 1,
      lineup_cost = lineup_cost + v_delta,
      wallet_used = wallet_used + greatest(v_delta, 0)
  where id = p_lineup_id;

  insert into public.tour_manager_transfers (
    lineup_id, user_id, season, station_key, out_contract_id, in_contract_id,
    refund_amount, sunk_loss, new_contract_price, fee_amount, wallet_delta
  )
  values (
    p_lineup_id, v_user, v_lineup.season, v_lineup.station_key,
    p_out_contract_id, v_in_id, v_refund, v_out.price - v_refund,
    v_new_price, v_fee, -v_delta
  );

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, v_lineup.season, v_lineup.station_key, p_lineup_id,
    'transfer_delta', -v_delta, v_balance,
    '换人窗口调仓',
    jsonb_build_object(
      'out_player', v_out.name_zh,
      'in_player', v_in.name_zh,
      'refund', v_refund,
      'fee', v_fee,
      'new_price', v_new_price
    )
  );

  return public.tour_manager_get_my_state(v_lineup.station_key, v_lineup.season);
end;
$$;

create or replace view public.tour_manager_public_configurations
as
select
  l.station_key,
  l.id as lineup_id,
  case
    when l.status = 'submitted' then '已提交经理'
    else coalesce(p.display_name, '炉友')
  end as display_name,
  case
    when l.status = 'submitted' then '已提交，等待锁定'
    else l.lineup_style
  end as lineup_style,
  l.lineup_cost,
  l.predicted_net,
  l.submitted_at,
  l.status,
  case
    when l.status = 'submitted' then '[]'::jsonb
    else coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', lp.name_zh,
          'tour', lp.tour,
          'price', lp.price,
          'predicted_round', lp.predicted_round,
          'active', lp.is_active
        )
        order by lp.created_at
      ) filter (where lp.id is not null),
      '[]'::jsonb
    )
  end as players
from public.tour_manager_lineups l
left join public.profiles p on p.id = l.user_id
left join public.tour_manager_lineup_players lp on lp.lineup_id = l.id and lp.is_active
where l.status in ('submitted','locked','settling','settled')
group by l.station_key, l.id, p.display_name, l.lineup_style, l.lineup_cost, l.predicted_net, l.submitted_at, l.status;

create or replace view public.tour_manager_public_leaderboard
as
select
  l.station_key,
  coalesce(p.display_name, '炉友') as display_name,
  count(lp.id) as contract_count,
  max(l.lineup_style) as lineup_style,
  sum(lp.earned_points) as earned_points,
  max(l.predicted_net) as predicted_net,
  max(l.lineup_cost) as lineup_cost,
  max(l.transfer_count) as transfer_count
from public.tour_manager_lineups l
left join public.profiles p on p.id = l.user_id
left join public.tour_manager_lineup_players lp on lp.lineup_id = l.id and lp.is_active
where l.status in ('submitted','locked','settling','settled')
group by l.station_key, l.user_id, p.display_name;

insert into public.tour_manager_data_sources (
  source_key, source_type, tour, name, base_url, cadence, notes
)
values
  ('atp_official', 'official_site', 'ATP', 'ATP official site', 'https://www.atptour.com/en', 'daily during events', '赛事、签表、赛程、结果、官方排名'),
  ('wta_official', 'official_site', 'WTA', 'WTA official site', 'https://www.wtatennis.com', 'daily during events', '赛事、签表、赛程、结果、官方排名'),
  ('tennisabstract_atp_elo', 'elo', 'ATP', 'Tennis Abstract ATP Elo', 'https://tennisabstract.com/reports/atp_elo_ratings.html', 'weekly snapshot before market lock', 'overall/hard/clay/grass Elo'),
  ('tennisabstract_wta_elo', 'elo', 'WTA', 'Tennis Abstract WTA Elo', 'https://tennisabstract.com/reports/wta_elo_ratings.html', 'weekly snapshot before market lock', 'overall/hard/clay/grass Elo'),
  ('manual_adjustment', 'manual', null, 'Manual correction', 'internal://tour-manager/manual-adjustment', 'as needed before market publish', '只记录人工校正来源，不作为自动事实源')
on conflict (source_key) do update
set
  source_type = excluded.source_type,
  tour = excluded.tour,
  name = excluded.name,
  base_url = excluded.base_url,
  cadence = excluded.cadence,
  notes = excluded.notes,
  updated_at = now();

grant select on public.tour_manager_events to anon, authenticated;
grant select on public.tour_manager_data_sources to anon, authenticated;
grant select on public.tour_manager_import_runs to anon, authenticated;
grant select on public.tour_manager_players to anon, authenticated;
grant select on public.tour_manager_ranking_snapshots to anon, authenticated;
grant select on public.tour_manager_elo_snapshots to anon, authenticated;
grant select on public.tour_manager_draw_entries to anon, authenticated;
grant select on public.tour_manager_matches to anon, authenticated;
grant select on public.tour_manager_price_versions to anon, authenticated;
grant select on public.tour_manager_price_version_players to anon, authenticated;
grant select on public.tour_manager_event_players to anon, authenticated;
grant select on public.tour_manager_public_configurations to anon, authenticated;
grant select on public.tour_manager_public_leaderboard to anon, authenticated;
grant execute on function public.tour_manager_bootstrap_wallet(int) to authenticated;
grant execute on function public.tour_manager_get_my_state(text,int) to authenticated;
grant execute on function public.tour_manager_submit_lineup(text,int,int,int,int,numeric,jsonb,jsonb,int,int,int,text) to authenticated;
grant execute on function public.tour_manager_transfer_player(uuid,uuid,jsonb,numeric) to authenticated;
