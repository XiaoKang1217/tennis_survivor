-- Grant every active Bastad + Athens participant 120 principal as a one-time
-- operator compensation. The ledger row is intentionally counted as other
-- station income by the frontend.

begin;

lock table public.tour_manager_lineups in share row exclusive mode;
lock table public.tour_manager_wallets in share row exclusive mode;
lock table public.tour_manager_wallet_ledger in share row exclusive mode;

do $$
declare
  v_station_key constant text := '2026-w29-bastad-athens';
  v_season constant int := 2026;
  v_amount constant int := 120;
  v_compensation_key constant text := '2026-w29-participation-compensation-120';
  v_lineup record;
  v_balance int;
begin
  for v_lineup in
    select lineup.id, lineup.user_id, lineup.season, lineup.station_key
    from public.tour_manager_lineups lineup
    where lineup.station_key = v_station_key
      and lineup.season = v_season
      and lineup.status in ('submitted', 'locked', 'settling', 'settled')
      and not exists (
        select 1
        from public.tour_manager_wallet_ledger ledger
        where ledger.user_id = lineup.user_id
          and ledger.season = lineup.season
          and ledger.station_key = lineup.station_key
          and ledger.type = 'station_participation_compensation'
          and ledger.metadata ->> 'compensation_key' = v_compensation_key
      )
    order by lineup.submitted_at, lineup.id
    for update
  loop
    update public.tour_manager_wallets
    set balance = balance + v_amount,
        updated_at = now()
    where user_id = v_lineup.user_id
      and season = v_lineup.season
    returning balance into v_balance;

    if not found then
      raise exception 'wallet_not_found_for_participation_compensation:%', v_lineup.user_id;
    end if;

    insert into public.tour_manager_wallet_ledger (
      user_id,
      season,
      station_key,
      lineup_id,
      type,
      amount,
      balance_after,
      description,
      metadata
    )
    values (
      v_lineup.user_id,
      v_lineup.season,
      v_lineup.station_key,
      v_lineup.id,
      'station_participation_compensation',
      v_amount,
      v_balance,
      '本站参赛补偿',
      jsonb_build_object(
        'compensation_key', v_compensation_key,
        'reason', 'market_price_and_qualifier_placement_incident',
        'income_category', 'other',
        'wallet_delta', v_amount,
        'cost', 0,
        'gross', 0,
        'bonus', 0,
        'net', v_amount,
        'exclude_from_income', false
      )
    );
  end loop;
end;
$$;

do $$
declare
  v_compensation_key constant text := '2026-w29-participation-compensation-120';
begin
  if exists (
    select 1
    from public.tour_manager_lineups lineup
    where lineup.station_key = '2026-w29-bastad-athens'
      and lineup.season = 2026
      and lineup.status in ('submitted', 'locked', 'settling', 'settled')
      and (
        select count(*)
        from public.tour_manager_wallet_ledger ledger
        where ledger.user_id = lineup.user_id
          and ledger.season = lineup.season
          and ledger.station_key = lineup.station_key
          and ledger.type = 'station_participation_compensation'
          and ledger.metadata ->> 'compensation_key' = v_compensation_key
          and ledger.amount = 120
      ) <> 1
  ) then
    raise exception 'station_participation_compensation_verification_failed';
  end if;
end;
$$;

-- Claiming this notice updates the compensation ledger itself, so the same
-- account cannot receive the popup again from another browser or device.
create or replace function public.tour_manager_take_station_compensation_notice(
  p_station_key text default '2026-w29-bastad-athens',
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ledger record;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select
    ledger.id,
    ledger.amount,
    ledger.station_key,
    ledger.description,
    ledger.created_at
  into v_ledger
  from public.tour_manager_wallet_ledger ledger
  where ledger.user_id = v_user
    and ledger.season = p_season
    and ledger.station_key = p_station_key
    and ledger.type = 'station_participation_compensation'
    and ledger.metadata ->> 'compensation_key' = '2026-w29-participation-compensation-120'
    and nullif(ledger.metadata ->> 'notice_claimed_at', '') is null
  order by ledger.created_at, ledger.id
  limit 1
  for update skip locked;

  if v_ledger.id is null then
    return null;
  end if;

  update public.tour_manager_wallet_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'notice_claimed_at', now(),
        'notice_claimed_by_user_id', v_user
      )
  where id = v_ledger.id;

  return jsonb_build_object(
    'amount', v_ledger.amount,
    'station_key', v_ledger.station_key,
    'description', v_ledger.description,
    'credited_at', v_ledger.created_at
  );
end;
$$;

revoke all on function public.tour_manager_take_station_compensation_notice(text, int) from public, anon;
grant execute on function public.tour_manager_take_station_compensation_notice(text, int) to authenticated;

commit;
