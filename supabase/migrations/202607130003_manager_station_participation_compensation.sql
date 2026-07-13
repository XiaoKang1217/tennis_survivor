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

commit;
