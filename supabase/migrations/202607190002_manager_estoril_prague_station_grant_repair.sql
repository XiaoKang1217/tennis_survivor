-- Restore the published Estoril + Prague station grant and refund principal
-- that was charged while the backend fell back to 45 + 45 = 90.

begin;

lock table public.tour_manager_station_configs in share row exclusive mode;
lock table public.tour_manager_lineups in share row exclusive mode;
lock table public.tour_manager_wallets in share row exclusive mode;
lock table public.tour_manager_wallet_ledger in share row exclusive mode;

insert into public.tour_manager_station_configs (
  station_key,
  season,
  station_grant,
  combo_version,
  metadata
)
values (
  '2026-w30-estoril-prague',
  2026,
  200,
  'normal_2026_v2',
  jsonb_build_object(
    'combo', jsonb_build_object(
      'total_cap', 200,
      'steady', jsonb_build_object(
        'min_players', 2,
        'qf_ratio', 0.5,
        'gross_rate', 0.08,
        'cap', 50
      ),
      'dual_tour', jsonb_build_object('QF', 20, 'SF', 45, 'F', 80, 'W', 120),
      'value_pick', jsonb_build_object(
        'tiers', jsonb_build_array('C', 'D'),
        'QF', 20,
        'SF', 45,
        'F', 80,
        'W', 125,
        'max_triggers', 1
      ),
      'small_budget', jsonb_build_object(
        'max_cost', 200,
        'gross_multipliers', jsonb_build_array(1, 1.5, 2.5),
        'bonuses', jsonb_build_array(20, 50, 90)
      )
    ),
    'source', 'data/manager/active_events.json',
    'repair_key', '2026-w30-station-grant-200'
  )
)
on conflict (station_key, season) do update
set station_grant = excluded.station_grant,
    combo_version = excluded.combo_version,
    metadata = excluded.metadata,
    updated_at = now();

do $$
declare
  v_station_key constant text := '2026-w30-estoril-prague';
  v_season constant int := 2026;
  v_station_grant constant int := 200;
  v_repair_key constant text := '2026-w30-station-grant-200';
  v_lineup record;
  v_station_used_after int;
  v_wallet_used_after int;
  v_principal_refund int;
  v_balance_after int;
begin
  for v_lineup in
    select lineup.*
    from public.tour_manager_lineups lineup
    where lineup.station_key = v_station_key
      and lineup.season = v_season
      and lineup.status in ('submitted', 'locked', 'settling', 'settled')
    order by lineup.submitted_at, lineup.id
    for update
  loop
    v_station_used_after := least(greatest(v_lineup.lineup_cost, 0), v_station_grant);
    v_wallet_used_after := greatest(v_lineup.lineup_cost - v_station_grant, 0);
    v_principal_refund := greatest(v_lineup.wallet_used - v_wallet_used_after, 0);

    if exists (
      select 1
      from public.tour_manager_wallet_ledger ledger
      where ledger.user_id = v_lineup.user_id
        and ledger.season = v_lineup.season
        and ledger.station_key = v_lineup.station_key
        and ledger.lineup_id = v_lineup.id
        and ledger.type = 'lineup_principal_allocation_refund'
        and ledger.metadata ->> 'repair_key' = v_repair_key
    ) then
      if v_lineup.station_grant <> v_station_grant
        or v_lineup.station_grant_used <> v_station_used_after
        or v_lineup.wallet_used <> v_wallet_used_after then
        raise exception 'station_grant_repair_already_paid_but_lineup_mismatch:%', v_lineup.id;
      end if;
      continue;
    end if;

    update public.tour_manager_wallets
    set balance = balance + v_principal_refund,
        updated_at = now()
    where user_id = v_lineup.user_id
      and season = v_lineup.season
    returning balance into v_balance_after;

    if not found then
      raise exception 'wallet_not_found_for_station_grant_repair:%', v_lineup.user_id;
    end if;

    update public.tour_manager_lineups
    set station_grant = v_station_grant,
        station_grant_used = v_station_used_after,
        wallet_used = v_wallet_used_after,
        updated_at = now()
    where id = v_lineup.id;

    update public.tour_manager_wallet_ledger
    set amount = v_station_grant,
        description = '本站签约金发放',
        metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(coalesce(metadata, '{}'::jsonb), '{station_grant}', to_jsonb(v_station_grant), true),
                '{station_grant_used}', to_jsonb(v_station_used_after), true
              ),
              '{wallet_used}', to_jsonb(v_wallet_used_after), true
            ),
            '{bonus}', to_jsonb(v_station_grant), true
          ),
          '{net}', to_jsonb(v_station_grant), true
        )
    where user_id = v_lineup.user_id
      and season = v_lineup.season
      and station_key = v_lineup.station_key
      and lineup_id = v_lineup.id
      and type = 'station_grant_issued';

    if v_principal_refund > 0 then
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
        'lineup_principal_allocation_refund',
        v_principal_refund,
        v_balance_after,
        '本站签约金配置修复，退还错误扣除的本金',
        jsonb_build_object(
          'repair_key', v_repair_key,
          'reason', 'published_station_grant_missing_from_backend',
          'wallet_delta', v_principal_refund,
          'principal_refund', v_principal_refund,
          'lineup_cost', v_lineup.lineup_cost,
          'station_grant_before', v_lineup.station_grant,
          'station_grant_after', v_station_grant,
          'station_grant_used_before', v_lineup.station_grant_used,
          'station_grant_used_after', v_station_used_after,
          'wallet_used_before', v_lineup.wallet_used,
          'wallet_used_after', v_wallet_used_after,
          'cost', 0,
          'gross', 0,
          'bonus', 0,
          'net', v_principal_refund,
          'exclude_from_income', true
        )
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if (public.tour_manager_station_rules('2026-w30-estoril-prague', 2026) ->> 'station_grant')::int <> 200 then
    raise exception 'estoril_prague_station_grant_rule_verification_failed';
  end if;

  if exists (
    select 1
    from public.tour_manager_lineups lineup
    where lineup.station_key = '2026-w30-estoril-prague'
      and lineup.season = 2026
      and lineup.status in ('submitted', 'locked', 'settling', 'settled')
      and (
        lineup.station_grant <> 200
        or lineup.station_grant_used <> least(greatest(lineup.lineup_cost, 0), 200)
        or lineup.wallet_used <> greatest(lineup.lineup_cost - 200, 0)
      )
  ) then
    raise exception 'estoril_prague_lineup_allocation_verification_failed';
  end if;
end;
$$;

commit;

select
  count(*) as repaired_users,
  coalesce(sum(amount), 0) as principal_refunded
from public.tour_manager_wallet_ledger
where station_key = '2026-w30-estoril-prague'
  and season = 2026
  and type = 'lineup_principal_allocation_refund'
  and metadata ->> 'repair_key' = '2026-w30-station-grant-200';
