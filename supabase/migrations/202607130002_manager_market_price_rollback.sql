-- Restore the Bastad + Athens market to publication v1 prices and reconcile every
-- still-effective contract with station-grant-first funding. The migration is
-- idempotent: contracts already at the target price are ignored on later runs.

begin;

lock table public.tour_manager_event_players in share row exclusive mode;
lock table public.tour_manager_lineups in share row exclusive mode;
lock table public.tour_manager_lineup_players in share row exclusive mode;
lock table public.tour_manager_wallets in share row exclusive mode;
lock table public.tour_manager_wallet_ledger in share row exclusive mode;

create temporary table manager_market_price_rollback_targets (
  event_key text not null,
  player_key text not null,
  target_price int not null check (target_price >= 0),
  primary key (event_key, player_key)
) on commit drop;

insert into manager_market_price_rollback_targets (event_key, player_key, target_price)
values
  ('atp-2026-w29-bastad-nordea-open', 'ATP|sebastian-ofner', 40),
  ('wta-2026-w29-athens-open', 'WTA|clara-tauson', 85),
  ('wta-2026-w29-athens-open', 'WTA|sapfo-sakellaridi', 45),
  ('wta-2026-w29-athens-open', 'WTA|marianne-argyrokastriti', 45),
  ('wta-2026-w29-athens-open', 'WTA|sara-bejlek', 105),
  ('wta-2026-w29-athens-open', 'WTA|martha-matoula', 45),
  ('wta-2026-w29-athens-open', 'WTA|zheng-qinwen', 95),
  ('wta-2026-w29-athens-open', 'WTA|harriet-dart', 55),
  ('wta-2026-w29-athens-open', 'WTA|maria-sakkari', 80),
  ('wta-2026-w29-athens-open', 'WTA|tereza-valentova', 95),
  ('wta-2026-w29-athens-open', 'WTA|alina-korneeva', 75),
  ('wta-2026-w29-athens-open', 'WTA|ann-li', 65),
  ('wta-2026-w29-athens-open', 'WTA|miriana-tona', 15),
  ('wta-2026-w29-athens-open', 'WTA|lilli-tagger', 15),
  ('wta-2026-w29-athens-open', 'WTA|viktoria-morvayova', 15),
  ('wta-2026-w29-athens-open', 'WTA|elena-micic', 15),
  ('wta-2026-w29-athens-open', 'WTA|mina-hodzic', 15),
  ('wta-2026-w29-athens-open', 'WTA|ito-aoi', 15);

update public.tour_manager_event_players ep
set price = target.target_price,
    source = coalesce(ep.source, '{}'::jsonb) || jsonb_build_object(
      'market_price_lock', jsonb_build_object(
        'rollback_key', '2026-w29-publication-v1-price-rollback',
        'publication_version', 1,
        'target_price', target.target_price,
        'applied_at', now()
      )
    ),
    updated_at = now()
from manager_market_price_rollback_targets target
where ep.event_key = target.event_key
  and ep.player_key = target.player_key
  and ep.price is distinct from target.target_price;

do $$
declare
  v_lineup public.tour_manager_lineups%rowtype;
  v_changes jsonb;
  v_refund_changes jsonb;
  v_charge_changes jsonb;
  v_refund int;
  v_charge int;
  v_station_release int;
  v_station_charge int;
  v_wallet_release int;
  v_wallet_delta int;
  v_remaining int;
  v_balance_before int;
  v_balance_after_refund int;
  v_balance_after int;
  v_new_lineup_cost int;
  v_lineup_cost_after_refund int;
  v_new_station_used int;
  v_station_used_after_refund int;
  v_new_wallet_used int;
  v_wallet_used_after_refund int;
begin
  for v_lineup in
    select l.*
    from public.tour_manager_lineups l
    where l.station_key = '2026-w29-bastad-athens'
      and l.season = 2026
      and l.status in ('submitted', 'locked', 'settling')
      and exists (
        select 1
        from public.tour_manager_lineup_players lp
        join manager_market_price_rollback_targets target
          on target.event_key = lp.event_key
         and target.player_key = lp.player_key
        where lp.lineup_id = l.id
          and lp.is_active
          and lp.price is distinct from target.target_price
      )
    order by l.submitted_at, l.id
    for update
  loop
    select
      sum(greatest(lp.price - target.target_price, 0))::int,
      sum(greatest(target.target_price - lp.price, 0))::int,
      jsonb_agg(
        jsonb_build_object(
          'contract_id', lp.id,
          'event_key', lp.event_key,
          'player_key', lp.player_key,
          'name_zh', lp.name_zh,
          'old_price', lp.price,
          'new_price', target.target_price,
          'difference', target.target_price - lp.price
        ) order by lp.event_key, lp.player_key
      ),
      jsonb_agg(
        jsonb_build_object(
          'contract_id', lp.id,
          'event_key', lp.event_key,
          'player_key', lp.player_key,
          'name_zh', lp.name_zh,
          'old_price', lp.price,
          'new_price', target.target_price,
          'difference', target.target_price - lp.price
        ) order by lp.event_key, lp.player_key
      ) filter (where target.target_price < lp.price),
      jsonb_agg(
        jsonb_build_object(
          'contract_id', lp.id,
          'event_key', lp.event_key,
          'player_key', lp.player_key,
          'name_zh', lp.name_zh,
          'old_price', lp.price,
          'new_price', target.target_price,
          'difference', target.target_price - lp.price
        ) order by lp.event_key, lp.player_key
      ) filter (where target.target_price > lp.price)
    into v_refund, v_charge, v_changes, v_refund_changes, v_charge_changes
    from public.tour_manager_lineup_players lp
    join manager_market_price_rollback_targets target
      on target.event_key = lp.event_key
     and target.player_key = lp.player_key
    where lp.lineup_id = v_lineup.id
      and lp.is_active
      and lp.price is distinct from target.target_price;

    if v_changes is null then
      continue;
    end if;

    if exists (
      select 1
      from public.tour_manager_wallet_ledger ledger
      where ledger.lineup_id = v_lineup.id
        and ledger.metadata ->> 'rollback_key' = '2026-w29-publication-v1-price-rollback'
    ) then
      raise exception 'market_price_rollback_ledger_exists_but_contracts_still_mismatch:%', v_lineup.id;
    end if;

    select wallet.balance
      into v_balance_before
    from public.tour_manager_wallets wallet
    where wallet.user_id = v_lineup.user_id
      and wallet.season = v_lineup.season
    for update;

    if v_balance_before is null then
      raise exception 'market_price_rollback_wallet_not_found:%', v_lineup.user_id;
    end if;

    v_refund := coalesce(v_refund, 0);
    v_charge := coalesce(v_charge, 0);

    -- Apply refunds first, restoring station grant before principal. Then fund
    -- charges from the newly available station grant before principal.
    v_station_release := least(v_refund, greatest(coalesce(v_lineup.station_grant_used, 0), 0));
    v_remaining := v_refund - v_station_release;
    if v_remaining > greatest(coalesce(v_lineup.wallet_used, 0), 0) then
      raise exception 'market_price_rollback_allocation_mismatch:user=% lineup=% refund=% station_used=% wallet_used=%',
        v_lineup.user_id, v_lineup.id, v_refund, v_lineup.station_grant_used, v_lineup.wallet_used;
    end if;
    v_wallet_release := v_remaining;
    v_station_used_after_refund := greatest(coalesce(v_lineup.station_grant_used, 0) - v_station_release, 0);
    v_wallet_used_after_refund := greatest(coalesce(v_lineup.wallet_used, 0) - v_wallet_release, 0);
    v_lineup_cost_after_refund := greatest(coalesce(v_lineup.lineup_cost, 0) - v_refund, 0);
    v_balance_after_refund := v_balance_before + v_wallet_release;

    v_station_charge := least(
      v_charge,
      greatest(coalesce(v_lineup.station_grant, 0) - v_station_used_after_refund, 0)
    );
    v_remaining := v_charge - v_station_charge;
    v_wallet_delta := v_wallet_release - v_remaining;

    if v_balance_before + v_wallet_delta < 0 then
      raise exception 'market_price_rollback_insufficient_principal:user=% lineup=% need=% balance=%',
        v_lineup.user_id, v_lineup.id, -v_wallet_delta, v_balance_before;
    end if;

    v_new_lineup_cost := v_lineup_cost_after_refund + v_charge;
    v_new_station_used := v_station_used_after_refund + v_station_charge;
    v_new_wallet_used := v_wallet_used_after_refund + v_remaining;
    v_balance_after := v_balance_before + v_wallet_delta;

    if v_new_station_used + v_new_wallet_used <> v_new_lineup_cost then
      raise exception 'market_price_rollback_final_allocation_mismatch:user=% lineup=% cost=% station_used=% wallet_used=%',
        v_lineup.user_id, v_lineup.id, v_new_lineup_cost, v_new_station_used, v_new_wallet_used;
    end if;

    update public.tour_manager_lineup_players lp
    set price = target.target_price,
        tier = public.tour_manager_price_tier(
          target.target_price,
          lp.tour,
          event.level,
          event.draw_size
        ),
        metadata = jsonb_set(
          jsonb_set(
            coalesce(lp.metadata, '{}'::jsonb),
            '{price}',
            to_jsonb(target.target_price),
            true
          ),
          '{market_price_rollback}',
          jsonb_build_object(
            'rollback_key', '2026-w29-publication-v1-price-rollback',
            'publication_version', 1,
            'old_price', lp.price,
            'new_price', target.target_price,
            'applied_at', now()
          ),
          true
        )
    from manager_market_price_rollback_targets target,
         public.tour_manager_events event
    where lp.lineup_id = v_lineup.id
      and lp.is_active
      and lp.event_key = target.event_key
      and lp.player_key = target.player_key
      and event.event_key = lp.event_key
      and lp.price is distinct from target.target_price;

    update public.tour_manager_wallets
    set balance = v_balance_after,
        updated_at = now()
    where user_id = v_lineup.user_id
      and season = v_lineup.season;

    update public.tour_manager_lineups
    set lineup_cost = v_new_lineup_cost,
        station_grant_used = v_new_station_used,
        wallet_used = v_new_wallet_used,
        predicted_net = coalesce(predicted_gross, 0) + coalesce(predicted_bonus, 0) - v_new_lineup_cost,
        updated_at = now()
    where id = v_lineup.id;

    if v_refund > 0 then
      insert into public.tour_manager_wallet_ledger (
        user_id, season, station_key, lineup_id, type, amount,
        balance_after, description, metadata
      )
      values (
        v_lineup.user_id,
        v_lineup.season,
        v_lineup.station_key,
        v_lineup.id,
        'market_price_rollback_refund',
        v_refund,
        v_balance_after_refund,
        '市场价格回退补偿',
        jsonb_build_object(
          'rollback_key', '2026-w29-publication-v1-price-rollback',
          'publication_version', 1,
          'total_adjustment', v_refund,
          'wallet_delta', v_wallet_release,
          'station_grant_delta', -v_station_release,
          'station_grant_refund', v_station_release,
          'station_grant_charge', 0,
          'principal_refund', v_wallet_release,
          'principal_charge', 0,
          'lineup_cost_before', v_lineup.lineup_cost,
          'lineup_cost_after', v_lineup_cost_after_refund,
          'station_grant_used_before', v_lineup.station_grant_used,
          'station_grant_used_after', v_station_used_after_refund,
          'wallet_used_before', v_lineup.wallet_used,
          'wallet_used_after', v_wallet_used_after_refund,
          'wallet_balance_before', v_balance_before,
          'wallet_balance_after', v_balance_after_refund,
          'cost', 0,
          'gross', v_refund,
          'net', v_refund,
          'exclude_from_income', true,
          'players', v_refund_changes
        )
      );
    end if;

    if v_charge > 0 then
      insert into public.tour_manager_wallet_ledger (
        user_id, season, station_key, lineup_id, type, amount,
        balance_after, description, metadata
      )
      values (
        v_lineup.user_id,
        v_lineup.season,
        v_lineup.station_key,
        v_lineup.id,
        'market_price_rollback_charge',
        -v_charge,
        v_balance_after,
        '市场价格回退扣款',
        jsonb_build_object(
          'rollback_key', '2026-w29-publication-v1-price-rollback',
          'publication_version', 1,
          'total_adjustment', v_charge,
          'wallet_delta', -v_remaining,
          'station_grant_delta', v_station_charge,
          'station_grant_refund', 0,
          'station_grant_charge', v_station_charge,
          'principal_refund', 0,
          'principal_charge', v_remaining,
          'lineup_cost_before', v_lineup_cost_after_refund,
          'lineup_cost_after', v_new_lineup_cost,
          'station_grant_used_before', v_station_used_after_refund,
          'station_grant_used_after', v_new_station_used,
          'wallet_used_before', v_wallet_used_after_refund,
          'wallet_used_after', v_new_wallet_used,
          'wallet_balance_before', v_balance_after_refund,
          'wallet_balance_after', v_balance_after,
          'cost', v_charge,
          'gross', 0,
          'net', -v_charge,
          'exclude_from_income', true,
          'players', v_charge_changes
        )
      );
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from manager_market_price_rollback_targets target
    left join public.tour_manager_event_players ep
      on ep.event_key = target.event_key
     and ep.player_key = target.player_key
    where ep.player_key is null
       or ep.price is distinct from target.target_price
  ) then
    raise exception 'market_price_rollback_event_price_verification_failed';
  end if;

  if exists (
    select 1
    from public.tour_manager_lineup_players lp
    join public.tour_manager_lineups lineup on lineup.id = lp.lineup_id
    join manager_market_price_rollback_targets target
      on target.event_key = lp.event_key
     and target.player_key = lp.player_key
    where lineup.station_key = '2026-w29-bastad-athens'
      and lineup.season = 2026
      and lineup.status in ('submitted', 'locked', 'settling')
      and lp.is_active
      and lp.price is distinct from target.target_price
  ) then
    raise exception 'market_price_rollback_contract_price_verification_failed';
  end if;

  if exists (
    select 1
    from public.tour_manager_lineups lineup
    where lineup.station_key = '2026-w29-bastad-athens'
      and lineup.season = 2026
      and lineup.status in ('submitted', 'locked', 'settling')
      and coalesce(lineup.station_grant_used, 0) + coalesce(lineup.wallet_used, 0)
          <> coalesce(lineup.lineup_cost, 0)
  ) then
    raise exception 'market_price_rollback_lineup_allocation_verification_failed';
  end if;
end;
$$;

do $$
declare
  v_price_version_id uuid;
  v_next_version int;
begin
  select version_row.id
    into v_price_version_id
  from public.tour_manager_price_versions version_row
  where version_row.station_key = '2026-w29-bastad-athens'
    and version_row.season = 2026
    and version_row.generated_from ->> 'rollback_key' = '2026-w29-publication-v1-price-rollback'
  limit 1;

  if v_price_version_id is null then
    select coalesce(max(version_row.version), 0) + 1
      into v_next_version
    from public.tour_manager_price_versions version_row
    where version_row.station_key = '2026-w29-bastad-athens'
      and version_row.season = 2026;

    insert into public.tour_manager_price_versions (
      station_key, season, version, status, formula_version, generated_from,
      notes, published_at, locked_at
    )
    values (
      '2026-w29-bastad-athens',
      2026,
      v_next_version,
      'locked',
      'station-publication-v1-rollback',
      jsonb_build_object(
        'rollback_key', '2026-w29-publication-v1-price-rollback',
        'publication_version', 1,
        'source', 'data/manager/publications/2026-w29-bastad-athens-v1.json'
      ),
      'Restored the formally published opening market after an unintended pre-cutoff repricing.',
      now(),
      now()
    )
    returning id into v_price_version_id;

    insert into public.tour_manager_price_version_players (
      price_version_id, event_key, player_key, tour, name_en, name_zh,
      official_rank, base_score, surface_score, draw_score, form_score,
      manual_score, total_score, price, tier, source_facts
    )
    select
      v_price_version_id,
      ep.event_key,
      ep.player_key,
      ep.tour,
      ep.name_en,
      ep.name_zh,
      ep.ranking,
      ep.base_score,
      ep.surface_score,
      ep.draw_score,
      ep.form_score,
      ep.manual_score,
      ep.total_score,
      ep.price,
      public.tour_manager_price_tier(ep.price, ep.tour, event.level, event.draw_size),
      coalesce(ep.source, '{}'::jsonb) || jsonb_build_object(
        'rollback_key', '2026-w29-publication-v1-price-rollback'
      )
    from public.tour_manager_event_players ep
    join public.tour_manager_events event on event.event_key = ep.event_key
    where event.station_key = '2026-w29-bastad-athens';
  end if;
end;
$$;

commit;
