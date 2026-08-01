-- Canada Masters 2026: frozen low-income signing discount and daily Combo.
--
-- The discount is part of the authoritative submission price, not Combo
-- income. The four result-based Combo items keep the existing serialized
-- entitlement-minus-paid daily settlement and wallet-ledger detail format.

alter table public.tour_manager_lineups
  add column if not exists original_lineup_cost int not null default 0,
  add column if not exists welfare_discount int not null default 0,
  add column if not exists welfare_principal_at_submit int,
  add column if not exists welfare_discount_rate numeric(5,4),
  add column if not exists welfare_use_number int,
  add column if not exists village_hope_player_key text,
  add column if not exists village_hope_player_name text;

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
  v_balance int;
  v_count int;
  v_found int;
  v_original_cost int;
  v_payable_cost int;
  v_station_used int;
  v_wallet_used int;
  v_lineup_id uuid;
  v_players jsonb := '[]'::jsonb;
  v_rules jsonb;
  v_station_grant int;
  v_min_players int;
  v_max_players int;
  v_transfer_fee_rate numeric;
  v_open_events int;
  v_missing_risky_cutoffs int;
  v_cutoff timestamptz;
  v_latest_open timestamptz;
  v_combo_version text;
  v_combo jsonb := '{}'::jsonb;
  v_welfare jsonb := '{}'::jsonb;
  v_welfare_principal_max int := 500;
  v_welfare_min_players int := 3;
  v_welfare_rate numeric := 0.20;
  v_welfare_cap int := 300;
  v_welfare_max_uses int := 3;
  v_welfare_uses int := 0;
  v_welfare_use_number int;
  v_welfare_discount int := 0;
  v_village_hope_player_key text;
  v_village_hope_player_name text;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if p_contracts is null or jsonb_typeof(p_contracts) <> 'array' then
    raise exception 'contracts_must_be_array';
  end if;

  v_rules := public.tour_manager_station_rules(p_station_key, p_season);
  v_station_grant := (v_rules->>'station_grant')::int;
  v_min_players := (v_rules->>'min_players')::int;
  v_max_players := (v_rules->>'max_players')::int;
  v_transfer_fee_rate := (v_rules->>'transfer_fee_rate')::numeric;

  select combo_version, coalesce(metadata->'combo', '{}'::jsonb)
  into v_combo_version, v_combo
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  select count(*),
         min(coalesce(submission_cutoff_at, submission_closes_at)),
         max(submission_opens_at)
  into v_open_events, v_cutoff, v_latest_open
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status = 'open';

  if coalesce(v_open_events, 0) = 0 then
    raise exception 'station_market_not_open';
  end if;
  if v_cutoff is null then
    raise exception 'submission_window_pending';
  end if;
  select count(*)
  into v_missing_risky_cutoffs
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status = 'open'
    and coalesce(submission_cutoff_at, submission_closes_at) is null
    and (start_date is null or start_date <= (v_cutoff at time zone 'UTC')::date);
  if coalesce(v_missing_risky_cutoffs, 0) > 0 then
    raise exception 'submission_window_pending';
  end if;
  if v_latest_open is not null and now() < v_latest_open then
    raise exception 'submission_window_not_open';
  end if;
  if now() >= v_cutoff then
    raise exception 'submission_window_closed';
  end if;

  select count(*) into v_count
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req;

  if v_count <> jsonb_array_length(p_contracts) then
    raise exception 'duplicate_contract_player';
  end if;
  if v_count < v_min_players or v_count > v_max_players then
    raise exception 'invalid_lineup_size';
  end if;

  with req as (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  )
  select count(*), coalesce(sum(ep.price), 0)::int
  into v_found, v_original_cost
  from req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key
  join public.tour_manager_events e
    on e.event_key = ep.event_key
  where e.market_status = 'open'
    and e.station_key = p_station_key
    and e.season = p_season;

  if v_found <> v_count then
    raise exception 'invalid_or_closed_contract_player';
  end if;

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

  -- Low-income relief is Canada-only, based on frozen principal before any
  -- station grant/spend/submit bonus. Cancelled discounted submissions still
  -- count toward the three-use season allowance, preventing withdraw abuse.
  if v_combo_version = 'canada_2026_v1' then
    v_welfare := coalesce(v_combo->'welfare', '{}'::jsonb);
    v_welfare_principal_max := coalesce((v_welfare->>'principal_max')::int, 500);
    v_welfare_min_players := coalesce((v_welfare->>'min_players')::int, 3);
    v_welfare_rate := coalesce((v_welfare->>'discount_rate')::numeric, 0.20);
    v_welfare_cap := coalesce((v_welfare->>'cap')::int, 300);
    v_welfare_max_uses := coalesce((v_welfare->>'max_uses_per_season')::int, 3);

    select count(*)::int
    into v_welfare_uses
    from public.tour_manager_lineups
    where user_id = v_user
      and season = p_season
      and welfare_discount > 0;

    if v_balance <= v_welfare_principal_max
       and v_count >= v_welfare_min_players
       and v_welfare_uses < v_welfare_max_uses then
      v_welfare_discount := least(
        greatest(v_welfare_cap, 0),
        round(v_original_cost * greatest(v_welfare_rate, 0))::int
      );
      v_welfare_use_number := v_welfare_uses + 1;
    end if;
  end if;

  v_payable_cost := greatest(v_original_cost - v_welfare_discount, 0);
  v_station_used := least(v_payable_cost, greatest(v_station_grant, 0));
  v_wallet_used := greatest(v_payable_cost - greatest(v_station_grant, 0), 0);

  if v_balance + greatest(v_station_grant, 0) < v_payable_cost then
    raise exception 'insufficient_budget';
  end if;

  -- The highest original-price contract is frozen at submission. Price ties
  -- use player_key so clients and the authoritative database agree.
  if v_combo_version = 'canada_2026_v1' then
    with req as (
      select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
      from jsonb_array_elements(p_contracts) x
    )
    select ep.player_key, coalesce(nullif(ep.name_zh, ''), nullif(ep.name_en, ''), ep.player_key)
    into v_village_hope_player_key, v_village_hope_player_name
    from req
    join public.tour_manager_event_players ep
      on ep.event_key = req.event_key and ep.player_key = req.player_key
    order by ep.price desc, ep.player_key
    limit 1;
  end if;

  insert into public.tour_manager_lineups (
    user_id, season, station_key, status, lineup_cost, original_lineup_cost,
    welfare_discount, welfare_principal_at_submit, welfare_discount_rate,
    welfare_use_number, village_hope_player_key, village_hope_player_name,
    station_grant, station_grant_used, wallet_used, min_players, max_players,
    max_transfers, transfer_fee_rate, predictions,
    predicted_gross, predicted_bonus, predicted_net, lineup_style
  )
  values (
    v_user, p_season, p_station_key, 'submitted', v_payable_cost, v_original_cost,
    v_welfare_discount, case when v_welfare_discount > 0 then v_balance else null end,
    case when v_welfare_discount > 0 then v_welfare_rate else null end,
    v_welfare_use_number, v_village_hope_player_key, v_village_hope_player_name,
    v_station_grant, v_station_used, v_wallet_used, v_min_players, v_max_players,
    1, v_transfer_fee_rate, coalesce(p_predictions, '{}'::jsonb),
    coalesce(p_predicted_gross, 0), coalesce(p_predicted_bonus, 0),
    coalesce(p_predicted_net, 0), p_lineup_style
  )
  returning id into v_lineup_id;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier,
    predicted_round, metadata
  )
  select
    v_lineup_id, ep.event_key, ep.player_key, ep.tour, ep.name_zh, ep.name_en, ep.price,
    public.tour_manager_price_tier(ep.price, ep.tour, e.level),
    coalesce(p_predictions->>ep.player_key, 'OUT'),
    to_jsonb(ep) || jsonb_build_object(
      'client_prediction', coalesce(p_predictions->>ep.player_key, 'OUT'),
      'level', e.level,
      'original_price', ep.price,
      'is_village_hope', ep.player_key = v_village_hope_player_key
    )
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key
  join public.tour_manager_events e
    on e.event_key = ep.event_key;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_key', lp.player_key,
    'name', coalesce(lp.name_zh, lp.name_en),
    'tour', lp.tour,
    'price', lp.price,
    'tier', lp.tier,
    'predicted_round', lp.predicted_round
  ) order by lp.tour, coalesce(lp.name_zh, lp.name_en)), '[]'::jsonb)
  into v_players
  from public.tour_manager_lineup_players lp
  where lp.lineup_id = v_lineup_id;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after,
    description, metadata
  )
  values (
    v_user, p_season, p_station_key, v_lineup_id, 'station_grant_issued',
    greatest(v_station_grant, 0), v_balance, '本站签约金发放',
    jsonb_build_object(
      'cost', 0,
      'gross', 0,
      'bonus', greatest(v_station_grant, 0),
      'net', greatest(v_station_grant, 0),
      'station_grant', greatest(v_station_grant, 0),
      'station_grant_used', v_station_used,
      'wallet_used', v_wallet_used,
      'original_lineup_cost', v_original_cost,
      'lineup_cost', v_payable_cost,
      'welfare_discount', v_welfare_discount,
      'welfare_principal_at_submit', case when v_welfare_discount > 0 then v_balance else null end,
      'welfare_use_number', v_welfare_use_number,
      'village_hope_player_key', v_village_hope_player_key,
      'village_hope_player_name', v_village_hope_player_name,
      'rules', v_rules,
      'players', v_players
    )
  );

  update public.tour_manager_wallets
  set balance = balance - v_wallet_used + 10
  where user_id = v_user and season = p_season
  returning balance into v_balance;

  if v_wallet_used > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after,
      description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup_id, 'lineup_wallet_spend',
      -v_wallet_used, v_balance - 10, '提交阵容占用经纪人钱包',
      jsonb_build_object(
        'cost', v_payable_cost,
        'gross', coalesce(p_predicted_gross, 0),
        'bonus', coalesce(p_predicted_bonus, 0),
        'net', -v_wallet_used,
        'original_lineup_cost', v_original_cost,
        'lineup_cost', v_payable_cost,
        'welfare_discount', v_welfare_discount,
        'welfare_principal_at_submit', case when v_welfare_discount > 0 then v_balance + v_wallet_used - 10 else null end,
        'welfare_use_number', v_welfare_use_number,
        'village_hope_player_key', v_village_hope_player_key,
        'village_hope_player_name', v_village_hope_player_name,
        'station_grant_used', v_station_used,
        'wallet_used', v_wallet_used,
        'rules', v_rules,
        'players', v_players
      )
    );
  end if;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after,
    description, metadata
  )
  values (
    v_user, p_season, p_station_key, v_lineup_id, 'submit_bonus',
    10, v_balance, '提交阵容奖励',
    jsonb_build_object(
      'cost', v_payable_cost,
      'gross', coalesce(p_predicted_gross, 0),
      'bonus', 10,
      'net', 10,
      'original_lineup_cost', v_original_cost,
      'lineup_cost', v_payable_cost,
      'welfare_discount', v_welfare_discount,
      'welfare_principal_at_submit', case when v_welfare_discount > 0 then v_balance + v_wallet_used - 10 else null end,
      'welfare_use_number', v_welfare_use_number,
      'village_hope_player_key', v_village_hope_player_key,
      'village_hope_player_name', v_village_hope_player_name,
      'station_grant_used', v_station_used,
      'wallet_used', v_wallet_used,
      'rules', v_rules,
      'players', v_players
    )
  );

  return public.tour_manager_get_my_state(p_station_key, p_season);
end;
$$;

revoke all on function public.tour_manager_submit_lineup(
  text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text
) from public, anon;
grant execute on function public.tour_manager_submit_lineup(
  text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text
) to authenticated;

create or replace function public.tour_manager_apply_canada_combo_v1(
  p_station_key text,
  p_season int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lineup record;
  v_combo_version text;
  v_combo jsonb;
  v_combo_cap int;
  v_steady_min_players int;
  v_steady_qf_ratio numeric;
  v_steady_gross_rate numeric;
  v_steady_cap int;
  v_value_max_price int;
  v_contract_count int;
  v_qf_count int;
  v_atp_r16 int;
  v_wta_r16 int;
  v_atp_qf int;
  v_wta_qf int;
  v_atp_sf int;
  v_wta_sf int;
  v_atp_f int;
  v_wta_f int;
  v_atp_w int;
  v_wta_w int;
  v_gross int;
  v_stable_bonus int;
  v_dual_bonus int;
  v_jewel_bonus int;
  v_village_bonus int;
  v_raw_bonus int;
  v_entitled_bonus int;
  v_paid_bonus int;
  v_bonus_delta int;
  v_balance int;
  v_applied int := 0;
  v_combo_details jsonb;
  v_delta_details jsonb;
  v_combo_summary text;
  v_steady_players jsonb;
  v_dual_players jsonb;
  v_jewel_players jsonb;
  v_village_players jsonb;
  v_dual_round text;
  v_jewel_round text;
  v_village_round text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select combo_version, coalesce(metadata->'combo', '{}'::jsonb)
  into v_combo_version, v_combo
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  if v_combo_version is distinct from 'canada_2026_v1' then
    raise exception 'canada_combo_v1_required:%', coalesce(v_combo_version, 'missing');
  end if;

  v_combo_cap := coalesce((v_combo->>'total_cap')::int, 700);
  v_steady_min_players := coalesce((v_combo #>> '{steady,min_players}')::int, 3);
  v_steady_qf_ratio := coalesce((v_combo #>> '{steady,qf_ratio}')::numeric, 0.5);
  v_steady_gross_rate := coalesce((v_combo #>> '{steady,gross_rate}')::numeric, 0.10);
  v_steady_cap := coalesce((v_combo #>> '{steady,cap}')::int, 300);
  v_value_max_price := coalesce((v_combo #>> '{value_pick,max_price}')::int, 150);

  for v_lineup in
    select *
    from public.tour_manager_lineups
    where station_key = p_station_key
      and season = p_season
      and status in ('submitted', 'locked', 'settling', 'settled')
    order by id
  loop
    -- Preserve the production daily Combo invariant: serialize per lineup,
    -- calculate total entitlement, subtract all prior Combo payments, and
    -- insert only a positive delta. No old station function is modified.
    perform pg_advisory_xact_lock(
      hashtextextended('tour_manager_combo:' || v_lineup.id::text, 0)
    );

    v_contract_count := 0;
    v_qf_count := 0;
    v_atp_r16 := 0;
    v_wta_r16 := 0;
    v_atp_qf := 0;
    v_wta_qf := 0;
    v_atp_sf := 0;
    v_wta_sf := 0;
    v_atp_f := 0;
    v_wta_f := 0;
    v_atp_w := 0;
    v_wta_w := 0;
    v_gross := 0;
    v_stable_bonus := 0;
    v_dual_bonus := 0;
    v_jewel_bonus := 0;
    v_village_bonus := 0;
    v_raw_bonus := 0;
    v_entitled_bonus := 0;
    v_paid_bonus := 0;
    v_bonus_delta := 0;
    v_combo_details := '[]'::jsonb;
    v_delta_details := '[]'::jsonb;
    v_combo_summary := '';
    v_steady_players := '[]'::jsonb;
    v_dual_players := '[]'::jsonb;
    v_jewel_players := '[]'::jsonb;
    v_village_players := '[]'::jsonb;
    v_dual_round := null;
    v_jewel_round := null;
    v_village_round := null;

    select
      count(*) filter (where is_active),
      count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
      count(*) filter (where is_active and tour = 'ATP' and reached_round = 'W'),
      count(*) filter (where is_active and tour = 'WTA' and reached_round = 'W'),
      coalesce(sum(earned_points) filter (where is_active), 0)
    into
      v_contract_count, v_qf_count,
      v_atp_r16, v_wta_r16, v_atp_qf, v_wta_qf,
      v_atp_sf, v_wta_sf, v_atp_f, v_wta_f, v_atp_w, v_wta_w,
      v_gross
    from public.tour_manager_lineup_players
    where lineup_id = v_lineup.id;

    if v_contract_count >= v_steady_min_players
       and v_qf_count::numeric >= v_contract_count::numeric * v_steady_qf_ratio then
      v_stable_bonus := least(round(v_gross * v_steady_gross_rate)::int, v_steady_cap);
      select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
      into v_steady_players
      from (
        select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) player_name, created_at
        from public.tour_manager_lineup_players
        where lineup_id = v_lineup.id
          and is_active
          and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')
      ) qualified;
    end if;

    if v_atp_w > 0 and v_wta_w > 0 then
      v_dual_round := 'W';
    elsif v_atp_f > 0 and v_wta_f > 0 then
      v_dual_round := 'F';
    elsif v_atp_sf > 0 and v_wta_sf > 0 then
      v_dual_round := 'SF';
    elsif v_atp_qf > 0 and v_wta_qf > 0 then
      v_dual_round := 'QF';
    elsif v_atp_r16 > 0 and v_wta_r16 > 0 then
      v_dual_round := 'R16';
    end if;

    if v_dual_round is not null then
      v_dual_bonus := coalesce((v_combo #>> array['dual_tour', v_dual_round])::int, 0);
      select coalesce(jsonb_agg(player_name order by tour, created_at), '[]'::jsonb)
      into v_dual_players
      from (
        select tour, coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) player_name, created_at
        from public.tour_manager_lineup_players
        where lineup_id = v_lineup.id
          and is_active
          and tour in ('ATP', 'WTA')
          and case
            when v_dual_round = 'W' then reached_round = 'W'
            else public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_dual_round)
          end
      ) qualified;
    end if;

    select
      coalesce(max(case
        when reached_round = 'W' then coalesce((v_combo #>> '{value_pick,W}')::int, 700)
        when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then coalesce((v_combo #>> '{value_pick,F}')::int, 550)
        when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then coalesce((v_combo #>> '{value_pick,SF}')::int, 350)
        when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then coalesce((v_combo #>> '{value_pick,QF}')::int, 250)
        when public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16') then coalesce((v_combo #>> '{value_pick,R16}')::int, 150)
        else 0
      end), 0)
    into v_jewel_bonus
    from public.tour_manager_lineup_players
    where lineup_id = v_lineup.id
      and is_active
      and price <= v_value_max_price;

    if v_jewel_bonus > 0 then
      select
        jsonb_build_array(coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key)),
        reached_round
      into v_jewel_players, v_jewel_round
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id
        and is_active
        and price <= v_value_max_price
        and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')
      order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, created_at
      limit 1;
    end if;

    select
      jsonb_build_array(coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key)),
      reached_round
    into v_village_players, v_village_round
    from public.tour_manager_lineup_players
    where lineup_id = v_lineup.id
      and player_key = v_lineup.village_hope_player_key
    order by is_active desc, created_at
    limit 1;

    if v_village_round = 'W' then
      v_village_bonus := coalesce((v_combo #>> '{village_hope,W}')::int, 700);
    elsif public.tour_manager_round_order(coalesce(v_village_round, 'OUT')) >= public.tour_manager_round_order('F') then
      v_village_bonus := coalesce((v_combo #>> '{village_hope,F}')::int, 400);
    elsif public.tour_manager_round_order(coalesce(v_village_round, 'OUT')) >= public.tour_manager_round_order('SF') then
      v_village_bonus := coalesce((v_combo #>> '{village_hope,SF}')::int, 250);
    elsif public.tour_manager_round_order(coalesce(v_village_round, 'OUT')) >= public.tour_manager_round_order('QF') then
      v_village_bonus := coalesce((v_combo #>> '{village_hope,QF}')::int, 100);
    elsif public.tour_manager_round_order(coalesce(v_village_round, 'OUT')) >= public.tour_manager_round_order('R16') then
      v_village_bonus := coalesce((v_combo #>> '{village_hope,R16}')::int, 50);
    end if;

    v_raw_bonus := v_stable_bonus + v_dual_bonus + v_jewel_bonus + v_village_bonus;
    v_entitled_bonus := least(v_raw_bonus, v_combo_cap);

    if v_stable_bonus > 0 then
      v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object(
        'key', 'steady', 'label', '稳健经营', 'bonus', v_stable_bonus,
        'players', v_steady_players, 'context', jsonb_build_array('毛收益' || v_gross)
      ));
    end if;
    if v_dual_bonus > 0 then
      v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object(
        'key', 'dual', 'label', '双线经营', 'bonus', v_dual_bonus,
        'players', v_dual_players, 'context', jsonb_build_array(v_dual_round)
      ));
    end if;
    if v_jewel_bonus > 0 then
      v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object(
        'key', 'jewel', 'label', '慧眼识珠', 'bonus', v_jewel_bonus,
        'players', v_jewel_players, 'context', jsonb_build_array(v_jewel_round)
      ));
    end if;
    if v_village_bonus > 0 then
      v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object(
        'key', 'village_hope', 'label', '全村的希望', 'bonus', v_village_bonus,
        'players', v_village_players, 'context', jsonb_build_array(v_village_round)
      ));
    end if;

    select coalesce(sum(amount), 0)::int
    into v_paid_bonus
    from public.tour_manager_wallet_ledger
    where lineup_id = v_lineup.id
      and type = 'station_combo_bonus';

    v_bonus_delta := greatest(v_entitled_bonus - v_paid_bonus, 0);

    if v_bonus_delta > 0 then
      select coalesce(string_agg(item->>'label', ' / ' order by ordinality), '')
      into v_combo_summary
      from jsonb_array_elements(v_combo_details) with ordinality detail(item, ordinality);

      v_delta_details := jsonb_build_array(jsonb_build_object(
        'key', 'combo_delta',
        'label',
          (case when v_paid_bonus > 0 then 'Combo升档补差' else 'Combo首次结算' end) ||
          case when v_combo_summary <> '' then '：' || v_combo_summary else '' end,
        'bonus', v_bonus_delta,
        'entitled_bonus', v_entitled_bonus,
        'paid_before', v_paid_bonus
      ));

      update public.tour_manager_wallets
      set balance = balance + v_bonus_delta,
          updated_at = now()
      where user_id = v_lineup.user_id
        and season = v_lineup.season
      returning balance into v_balance;

      if not found then
        raise exception 'wallet_not_found_for_combo:%', v_lineup.user_id;
      end if;

      insert into public.tour_manager_wallet_ledger (
        user_id, season, station_key, lineup_id, type, amount, balance_after,
        description, metadata
      )
      values (
        v_lineup.user_id, v_lineup.season, v_lineup.station_key, v_lineup.id,
        'station_combo_bonus', v_bonus_delta, v_balance, '本站组合奖励',
        jsonb_build_object(
          'combo_version', v_combo_version || '_daily_delta',
          'raw_bonus', v_raw_bonus,
          'entitled_bonus', v_entitled_bonus,
          'paid_before', v_paid_bonus,
          'combo_delta', v_bonus_delta,
          'combo_cap', v_combo_cap,
          'gross', v_gross,
          'lineup_cost', v_lineup.lineup_cost,
          'original_lineup_cost', v_lineup.original_lineup_cost,
          'contract_count', v_contract_count,
          'qf_count', v_qf_count,
          'stable_bonus', v_stable_bonus,
          'dual_bonus', v_dual_bonus,
          'jewel_bonus', v_jewel_bonus,
          'village_hope_bonus', v_village_bonus,
          'village_hope_player_key', v_lineup.village_hope_player_key,
          'combo_details', v_delta_details,
          'combo_entitled_details', v_combo_details
        )
      );
      v_applied := v_applied + 1;
    end if;
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.tour_manager_apply_canada_combo_v1(text, int)
  from public, anon, authenticated;
grant execute on function public.tour_manager_apply_canada_combo_v1(text, int)
  to service_role;

-- Add one isolated dispatcher branch. The existing Washington and legacy
-- functions are called exactly as before.
create or replace function public.tour_manager_apply_station_combo(
  p_station_key text,
  p_season int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo_version text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select combo_version
  into v_combo_version
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  if v_combo_version = 'canada_2026_v1' then
    return public.tour_manager_apply_canada_combo_v1(p_station_key, p_season);
  end if;

  if v_combo_version = 'washington_2026_v2' then
    return public.tour_manager_apply_washington_combo_v2(p_station_key, p_season);
  end if;

  if v_combo_version = 'washington_2026_v1' then
    return public.tour_manager_apply_washington_combo(p_station_key, p_season);
  end if;

  return public.tour_manager_apply_station_combo_legacy_20260719(p_station_key, p_season);
end;
$$;

revoke all on function public.tour_manager_apply_station_combo(text, int)
  from public, anon, authenticated;
grant execute on function public.tour_manager_apply_station_combo(text, int)
  to service_role;
