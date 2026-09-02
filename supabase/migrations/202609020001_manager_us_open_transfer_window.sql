-- US Open 2026: open the shared ATP/WTA transfer window.
--
-- Transfers use the existing transfer RPC accounting only: no welfare discount
-- is recalculated during transfer, regardless of current principal.

update public.tour_manager_events
set
  transfer_window_opens_at = '2026-09-02T13:00:00+08:00'::timestamptz,
  transfer_window_closes_at = '2026-09-02T22:45:00+08:00'::timestamptz,
  transfer_window_note = '本站换人窗口为 09/02 13:00 - 09/02 22:45；ATP/WTA 同一窗口开放，男女可互换，手续费 15%。换人时不管本金多少不再享受低保折扣。若换下提交时冻结的全村希望，换入球员自动继承全村希望。',
  transfer_fee_rate = 0.15,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'cross_tour_transfer', true,
    'transfer_welfare_discount', false
  ),
  updated_at = now()
where station_key = '2026-w35-us-open'
  and season = 2026
  and tour in ('ATP', 'WTA')
  and event_key in (
    'atp-2026-w35-us-open',
    'wta-2026-w35-us-open'
  );

update public.tour_manager_lineups
set transfer_fee_rate = 0.15,
    updated_at = now()
where station_key = '2026-w35-us-open'
  and season = 2026
  and status in ('submitted', 'locked', 'settling');

create or replace function public.tour_manager_apply_us_open_transfer_village_hope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lineup_village_key text;
  v_out_key text;
  v_in_key text;
  v_in_name text;
begin
  if new.station_key <> '2026-w35-us-open' then
    return new;
  end if;

  select village_hope_player_key
    into v_lineup_village_key
  from public.tour_manager_lineups
  where id = new.lineup_id
  for update;

  select player_key
    into v_out_key
  from public.tour_manager_lineup_players
  where id = new.out_contract_id;

  select player_key, coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key)
    into v_in_key, v_in_name
  from public.tour_manager_lineup_players
  where id = new.in_contract_id;

  if v_out_key is null or v_in_key is null then
    return new;
  end if;

  if coalesce(v_lineup_village_key, '') <> '' and v_lineup_village_key = v_out_key then
    update public.tour_manager_lineups
    set village_hope_player_key = v_in_key,
        village_hope_player_name = v_in_name,
        updated_at = now()
    where id = new.lineup_id
      and station_key = '2026-w35-us-open';

    update public.tour_manager_lineup_players
    set metadata = jsonb_set(
          coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'village_hope_replaced_by_player_key', v_in_key,
              'village_hope_replaced_by_player_name', v_in_name,
              'village_hope_replaced_at', now()
            ),
          '{is_village_hope}',
          'false'::jsonb,
          true
        )
    where id = new.out_contract_id;

    update public.tour_manager_lineup_players
    set metadata = jsonb_set(
          coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
              'village_hope_player_key', v_in_key,
              'village_hope_player_name', v_in_name,
              'village_hope_inherited_from_player_key', v_out_key,
              'village_hope_inherited_at', now()
            ),
          '{is_village_hope}',
          'true'::jsonb,
          true
        )
    where id = new.in_contract_id;
  else
    update public.tour_manager_lineup_players
    set metadata = jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{is_village_hope}',
          'false'::jsonb,
          true
        )
    where id = new.in_contract_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tour_manager_us_open_transfer_village_hope_guard on public.tour_manager_transfers;
create trigger tour_manager_us_open_transfer_village_hope_guard
after insert on public.tour_manager_transfers
for each row execute function public.tour_manager_apply_us_open_transfer_village_hope();

do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from public.tour_manager_events
  where station_key = '2026-w35-us-open'
    and season = 2026
    and tour in ('ATP', 'WTA')
    and event_key in (
      'atp-2026-w35-us-open',
      'wta-2026-w35-us-open'
    )
    and transfer_window_opens_at = '2026-09-02T13:00:00+08:00'::timestamptz
    and transfer_window_closes_at = '2026-09-02T22:45:00+08:00'::timestamptz
    and transfer_fee_rate = 0.15
    and lower(coalesce(metadata->>'cross_tour_transfer', 'false')) in ('true', '1', 'yes')
    and lower(coalesce(metadata->>'transfer_welfare_discount', 'true')) in ('false', '0', 'no');

  if v_count <> 2 then
    raise exception 'us_open_transfer_window_update_incomplete: expected 2 events, got %', v_count;
  end if;
end
$$;
