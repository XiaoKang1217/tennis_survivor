-- Washington 2026 has a station-specific Combo policy. Preserve the exact
-- pre-Washington settlement function for every frozen historical station and
-- route only washington_2026_v1 through the new calculator.

alter function public.tour_manager_apply_station_combo(text, int)
  rename to tour_manager_apply_station_combo_legacy_20260719;

create or replace function public.tour_manager_apply_washington_combo(
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
  v_combo_cap int;
  v_steady_min_players int;
  v_steady_qf_ratio numeric;
  v_steady_gross_rate numeric;
  v_steady_cap int;
  v_dual_qf_value int;
  v_dual_sf_value int;
  v_dual_f_value int;
  v_dual_w_value int;
  v_value_max_price int;
  v_value_qf_value int;
  v_value_sf_value int;
  v_value_f_value int;
  v_value_w_value int;
  v_small_max_cost int;
  v_contract_count int;
  v_qf_count int;
  v_sf_count int;
  v_finalists int;
  v_champions int;
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
  v_small_bonus int;
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
  v_dual_round text;
  v_jewel_round text;
  v_small_multiple numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select
    combo_version,
    coalesce((metadata #>> '{combo,total_cap}')::int, 400),
    coalesce((metadata #>> '{combo,steady,min_players}')::int, 2),
    coalesce((metadata #>> '{combo,steady,qf_ratio}')::numeric, 0.5),
    coalesce((metadata #>> '{combo,steady,gross_rate}')::numeric, 0.08),
    coalesce((metadata #>> '{combo,steady,cap}')::int, 80),
    coalesce((metadata #>> '{combo,dual_tour,QF}')::int, 60),
    coalesce((metadata #>> '{combo,dual_tour,SF}')::int, 120),
    coalesce((metadata #>> '{combo,dual_tour,F}')::int, 200),
    coalesce((metadata #>> '{combo,dual_tour,W}')::int, 300),
    coalesce((metadata #>> '{combo,value_pick,max_price}')::int, 100),
    coalesce((metadata #>> '{combo,value_pick,QF}')::int, 20),
    coalesce((metadata #>> '{combo,value_pick,SF}')::int, 45),
    coalesce((metadata #>> '{combo,value_pick,F}')::int, 80),
    coalesce((metadata #>> '{combo,value_pick,W}')::int, 125),
    coalesce((metadata #>> '{combo,small_budget,max_cost}')::int, station_grant, 500)
  into
    v_combo_version, v_combo_cap,
    v_steady_min_players, v_steady_qf_ratio, v_steady_gross_rate, v_steady_cap,
    v_dual_qf_value, v_dual_sf_value, v_dual_f_value, v_dual_w_value,
    v_value_max_price, v_value_qf_value, v_value_sf_value, v_value_f_value, v_value_w_value,
    v_small_max_cost
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  if v_combo_version is distinct from 'washington_2026_v1' then
    raise exception 'washington_combo_version_required:%', coalesce(v_combo_version, 'missing');
  end if;

  for v_lineup in
    select *
    from public.tour_manager_lineups
    where station_key = p_station_key
      and season = p_season
      and status in ('submitted', 'locked', 'settling', 'settled')
    order by id
  loop
    -- Keep the established daily entitlement-minus-paid mechanism serialized
    -- per lineup so overlapping settlement jobs cannot issue the same delta.
    perform pg_advisory_xact_lock(
      hashtextextended('tour_manager_combo:' || v_lineup.id::text, 0)
    );

    v_contract_count := 0;
    v_qf_count := 0;
    v_sf_count := 0;
    v_finalists := 0;
    v_champions := 0;
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
    v_small_bonus := 0;
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
    v_dual_round := null;
    v_jewel_round := null;
    v_small_multiple := 0;

    select
      count(*) filter (where is_active),
      count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
      count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
      count(*) filter (where is_active and reached_round = 'W'),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
      count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
      count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
      count(*) filter (where is_active and tour = 'ATP' and reached_round = 'W'),
      count(*) filter (where is_active and tour = 'WTA' and reached_round = 'W'),
      coalesce(max(case
        when is_active and price <= v_value_max_price and reached_round = 'W' then v_value_w_value
        when is_active and price <= v_value_max_price and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then v_value_f_value
        when is_active and price <= v_value_max_price and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then v_value_sf_value
        when is_active and price <= v_value_max_price and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then v_value_qf_value
        else 0
      end), 0),
      coalesce(sum(earned_points), 0)
    into
      v_contract_count, v_qf_count, v_sf_count, v_finalists, v_champions,
      v_atp_qf, v_wta_qf, v_atp_sf, v_wta_sf, v_atp_f, v_wta_f, v_atp_w, v_wta_w,
      v_jewel_bonus, v_gross
    from public.tour_manager_lineup_players
    where lineup_id = v_lineup.id;

    if v_contract_count >= v_steady_min_players
       and v_qf_count::numeric >= v_contract_count::numeric * v_steady_qf_ratio then
      v_stable_bonus := least(round(v_gross * v_steady_gross_rate)::int, v_steady_cap);
      select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
      into v_steady_players
      from (
        select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
        from public.tour_manager_lineup_players
        where lineup_id = v_lineup.id
          and is_active
          and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')
      ) steady_players;
    end if;

    if v_atp_w > 0 and v_wta_w > 0 then
      v_dual_bonus := v_dual_w_value;
      v_dual_round := 'W';
    elsif v_atp_f > 0 and v_wta_f > 0 then
      v_dual_bonus := v_dual_f_value;
      v_dual_round := 'F';
    elsif v_atp_sf > 0 and v_wta_sf > 0 then
      v_dual_bonus := v_dual_sf_value;
      v_dual_round := 'SF';
    elsif v_atp_qf > 0 and v_wta_qf > 0 then
      v_dual_bonus := v_dual_qf_value;
      v_dual_round := 'QF';
    end if;

    if v_dual_round is not null then
      select coalesce(jsonb_agg(player_name order by tour, created_at), '[]'::jsonb)
      into v_dual_players
      from (
        select tour, coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
        from public.tour_manager_lineup_players
        where lineup_id = v_lineup.id
          and is_active
          and tour in ('ATP', 'WTA')
          and case
            when v_dual_round = 'W' then reached_round = 'W'
            else public.tour_manager_round_order(coalesce(reached_round, 'OUT'))
              >= public.tour_manager_round_order(v_dual_round)
          end
      ) dual_players;
    end if;

    if v_jewel_bonus > 0 then
      select
        jsonb_build_array(coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key)),
        reached_round
      into v_jewel_players, v_jewel_round
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id
        and is_active
        and price <= v_value_max_price
        and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')
      order by public.tour_manager_round_order(coalesce(reached_round, 'OUT')) desc, created_at
      limit 1;
    end if;

    if v_lineup.lineup_cost > 0 and v_lineup.lineup_cost <= v_small_max_cost then
      v_small_multiple := v_gross::numeric / v_lineup.lineup_cost::numeric;
      if v_gross * 4 >= v_lineup.lineup_cost * 6 then
        v_small_bonus := 200;
      elsif v_gross * 4 >= v_lineup.lineup_cost * 5 then
        v_small_bonus := 150;
      elsif v_gross >= v_lineup.lineup_cost then
        v_small_bonus := 100;
      elsif v_gross * 4 >= v_lineup.lineup_cost * 3 then
        v_small_bonus := 50;
      end if;
    end if;

    v_raw_bonus := v_stable_bonus + v_dual_bonus + v_jewel_bonus + v_small_bonus;
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
    if v_small_bonus > 0 then
      v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object(
        'key', 'small_budget', 'label', '小本经营', 'bonus', v_small_bonus,
        'context', jsonb_build_array(
          '毛收益' || v_gross,
          '阵容成本' || v_lineup.lineup_cost,
          '收益倍数' || round(v_small_multiple, 2)
        )
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
      from jsonb_array_elements(v_combo_details) with ordinality as detail(item, ordinality);

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
        user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
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
          'contract_count', v_contract_count,
          'qf_count', v_qf_count,
          'sf_count', v_sf_count,
          'finalists', v_finalists,
          'champions', v_champions,
          'stable_bonus', v_stable_bonus,
          'dual_bonus', v_dual_bonus,
          'jewel_bonus', v_jewel_bonus,
          'small_budget_bonus', v_small_bonus,
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

revoke all on function public.tour_manager_apply_washington_combo(text, int)
  from public, anon, authenticated;
grant execute on function public.tour_manager_apply_washington_combo(text, int)
  to service_role;

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
