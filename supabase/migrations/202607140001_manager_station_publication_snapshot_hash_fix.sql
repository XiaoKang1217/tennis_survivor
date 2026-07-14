-- Make the immutable station snapshot hash validator work with Supabase's
-- standard pgcrypto installation in the extensions schema.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.tour_manager_validate_station_publication_snapshot()
returns trigger
language plpgsql
set search_path = public, extensions
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

  v_expected_hash := encode(
    digest(convert_to(new.canonical_payload, 'UTF8'), 'sha256'::text),
    'hex'
  );
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

comment on function public.tour_manager_validate_station_publication_snapshot() is
  'Validates canonical station snapshot JSON and SHA-256 using pgcrypto from public or extensions.';
