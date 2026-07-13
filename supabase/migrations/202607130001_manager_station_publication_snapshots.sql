-- Immutable station publication archives.
-- One row is a complete, replayable view of a manager station at publication time.

create extension if not exists pgcrypto;

create table if not exists public.tour_manager_station_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  station_key text not null,
  season int not null,
  publication_version int not null check (publication_version > 0),
  publication_kind text not null default 'initial_open'
    check (publication_kind in ('initial_open', 'window_amendment', 'market_amendment', 'manual_backfill')),
  snapshot_schema_version int not null default 1 check (snapshot_schema_version > 0),
  published_at timestamptz not null,
  event_keys text[] not null default '{}',
  station_grant int not null check (station_grant >= 0),
  combo_version text not null,
  price_version_id uuid references public.tour_manager_price_versions(id) on delete restrict,
  price_version int,
  hash_algorithm text not null default 'sha256' check (hash_algorithm = 'sha256'),
  data_hash text not null check (data_hash ~ '^[0-9a-f]{64}$'),
  canonical_payload text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (station_key, season, publication_version),
  unique (station_key, season, data_hash)
);

create index if not exists tour_manager_station_publication_snapshots_published_idx
on public.tour_manager_station_publication_snapshots(season desc, published_at desc, station_key);

create or replace function public.tour_manager_validate_station_publication_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_payload jsonb;
  v_expected_hash text;
  v_snapshot_event_keys text[];
  v_row_event_keys text[];
  v_snapshot_price_version int;
  v_snapshot_price_version_id uuid;
begin
  begin
    v_payload := new.canonical_payload::jsonb;
  exception when others then
    raise exception 'station_publication_snapshot_invalid_canonical_json';
  end;

  if v_payload <> new.snapshot then
    raise exception 'station_publication_snapshot_payload_mismatch';
  end if;

  v_expected_hash := encode(digest(convert_to(new.canonical_payload, 'UTF8'), 'sha256'), 'hex');
  if new.data_hash <> v_expected_hash then
    raise exception 'station_publication_snapshot_hash_mismatch';
  end if;

  if coalesce(new.snapshot #>> '{publication,station_key}', '') <> new.station_key
     or coalesce((new.snapshot #>> '{publication,season}')::int, -1) <> new.season
     or coalesce((new.snapshot #>> '{publication,version}')::int, -1) <> new.publication_version
     or coalesce(new.snapshot #>> '{publication,kind}', '') <> new.publication_kind
     or (new.snapshot #>> '{publication,published_at}')::timestamptz is distinct from new.published_at
     or coalesce((new.snapshot #>> '{schema_version}')::int, -1) <> new.snapshot_schema_version then
    raise exception 'station_publication_snapshot_identity_mismatch';
  end if;

  select coalesce(array_agg(item ->> 'event_key' order by item ->> 'event_key'), array[]::text[])
    into v_snapshot_event_keys
  from jsonb_array_elements(new.snapshot -> 'events') as item;

  select coalesce(array_agg(event_key order by event_key), array[]::text[])
    into v_row_event_keys
  from unnest(new.event_keys) as event_key;

  v_snapshot_price_version := nullif(new.snapshot #>> '{pricing,selected_version,version}', '')::int;
  v_snapshot_price_version_id := nullif(new.snapshot #>> '{pricing,selected_version,id}', '')::uuid;

  if v_snapshot_event_keys is distinct from v_row_event_keys
     or coalesce((new.snapshot #>> '{station_config,station_grant}')::int, -1) <> new.station_grant
     or coalesce(new.snapshot #>> '{station_config,combo_version}', '') <> new.combo_version
     or v_snapshot_price_version is distinct from new.price_version
     or v_snapshot_price_version_id is distinct from new.price_version_id then
    raise exception 'station_publication_snapshot_index_metadata_mismatch';
  end if;

  return new;
end;
$$;

create or replace function public.tour_manager_reject_station_publication_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'station_publication_snapshots_are_immutable';
end;
$$;

drop trigger if exists tour_manager_validate_station_publication_snapshot
on public.tour_manager_station_publication_snapshots;
create trigger tour_manager_validate_station_publication_snapshot
before insert on public.tour_manager_station_publication_snapshots
for each row execute function public.tour_manager_validate_station_publication_snapshot();

drop trigger if exists tour_manager_reject_station_publication_snapshot_mutation
on public.tour_manager_station_publication_snapshots;
create trigger tour_manager_reject_station_publication_snapshot_mutation
before update or delete on public.tour_manager_station_publication_snapshots
for each row execute function public.tour_manager_reject_station_publication_snapshot_mutation();

alter table public.tour_manager_station_publication_snapshots enable row level security;

drop policy if exists tour_manager_station_publication_snapshots_read
on public.tour_manager_station_publication_snapshots;
create policy tour_manager_station_publication_snapshots_read
on public.tour_manager_station_publication_snapshots
for select
using (true);

revoke all on public.tour_manager_station_publication_snapshots from public, anon, authenticated;
grant select on public.tour_manager_station_publication_snapshots to anon, authenticated;
grant select, insert on public.tour_manager_station_publication_snapshots to service_role;

comment on table public.tour_manager_station_publication_snapshots is
  'Immutable, hash-verified station publication archives used to replay the exact market, rules, prices and windows shown at release time.';
comment on column public.tour_manager_station_publication_snapshots.canonical_payload is
  'Deterministically serialized snapshot text. SHA-256 is calculated over these exact UTF-8 bytes.';
