-- Restore daily Combo delta settlement after normal-tour Combo V2, and rerun
-- the idempotent historical elimination-state repair. Requires 202607120001
-- (station configs); the badge schema migration may be present but is not a
-- dependency of this compatibility patch.

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
  v_lineup record;
  v_combo_version text;
  v_combo_cap int;
  v_contract_count int;
  v_r32_count int;
  v_r16_count int;
  v_qf_count int;
  v_sf_count int;
  v_finalists int;
  v_champions int;
  v_value_champions int;
  v_jewels int;
  v_atp_r16 int;
  v_wta_r16 int;
  v_atp_qf int;
  v_wta_qf int;
  v_atp_sf int;
  v_wta_sf int;
  v_atp_f int;
  v_wta_f int;
  v_gross int;
  v_stable_bonus int;
  v_multi_bonus int;
  v_all_r16_bonus int;
  v_dual_bonus int;
  v_jewel_bonus int;
  v_champ_bonus int;
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select
    combo_version,
    coalesce((metadata #>> '{combo,total_cap}')::int, 0)
  into v_combo_version, v_combo_cap
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  if v_combo_version is null then
    v_combo_version := case
      when p_station_key = '2026-w27-wimbledon' then 'wimbledon_2026'
      else 'classic'
    end;
  end if;
  if v_combo_version = 'normal_2026_v2' and coalesce(v_combo_cap, 0) <= 0 then
    v_combo_cap := 200;
  end if;

  for v_lineup in
    select *
    from public.tour_manager_lineups
    where station_key = p_station_key
      and season = p_season
      and status in ('submitted', 'locked', 'settling', 'settled')
    order by id
  loop
    -- Serialize entitlement checks per lineup so overlapping settlement jobs
    -- cannot both observe the same paid total and issue the same delta twice.
    perform pg_advisory_xact_lock(
      hashtextextended('tour_manager_combo:' || v_lineup.id::text, 0)
    );

    v_contract_count := 0;
    v_r32_count := 0;
    v_r16_count := 0;
    v_qf_count := 0;
    v_sf_count := 0;
    v_finalists := 0;
    v_champions := 0;
    v_value_champions := 0;
    v_jewels := 0;
    v_atp_r16 := 0;
    v_wta_r16 := 0;
    v_atp_qf := 0;
    v_wta_qf := 0;
    v_atp_sf := 0;
    v_wta_sf := 0;
    v_atp_f := 0;
    v_wta_f := 0;
    v_gross := 0;
    v_stable_bonus := 0;
    v_multi_bonus := 0;
    v_all_r16_bonus := 0;
    v_dual_bonus := 0;
    v_jewel_bonus := 0;
    v_champ_bonus := 0;
    v_small_bonus := 0;
    v_raw_bonus := 0;
    v_entitled_bonus := 0;
    v_paid_bonus := 0;
    v_bonus_delta := 0;
    v_combo_details := '[]'::jsonb;
    v_delta_details := '[]'::jsonb;
    v_combo_summary := '';

    if v_combo_version = 'normal_2026_v2' then
      select
        count(*) filter (where is_active),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        coalesce(max(case
          when is_active and tier in ('C', 'D') and reached_round = 'W' then 125
          when is_active and tier in ('C', 'D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 80
          when is_active and tier in ('C', 'D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 45
          when is_active and tier in ('C', 'D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 20
          else 0
        end), 0),
        -- Gross income is station-to-date realized player income. Replaced
        -- contracts keep already-earned points, while the incoming contract's
        -- transfer baseline prevents old rounds from being earned twice.
        coalesce(sum(earned_points), 0)
      into
        v_contract_count, v_qf_count, v_sf_count, v_finalists,
        v_atp_qf, v_wta_qf, v_atp_sf, v_wta_sf, v_atp_f, v_wta_f,
        v_jewel_bonus, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count >= 2 and v_qf_count * 100 >= v_contract_count * 50 then
        v_stable_bonus := least(round(v_gross * 0.08)::int, 50);
      end if;

      if v_atp_f > 0 and v_wta_f > 0 then
        v_dual_bonus := 80;
      elsif v_atp_sf > 0 and v_wta_sf > 0 then
        v_dual_bonus := 45;
      elsif v_atp_qf > 0 and v_wta_qf > 0 then
        v_dual_bonus := 20;
      end if;

      if v_lineup.lineup_cost > 0 and v_lineup.lineup_cost <= v_lineup.station_grant then
        if v_gross * 10 >= v_lineup.lineup_cost * 25 then
          v_small_bonus := 90;
        elsif v_gross * 10 >= v_lineup.lineup_cost * 15 then
          v_small_bonus := 50;
        elsif v_gross >= v_lineup.lineup_cost then
          v_small_bonus := 20;
        end if;
      end if;

      v_raw_bonus := v_stable_bonus + v_dual_bonus + v_jewel_bonus + v_small_bonus;
      v_entitled_bonus := least(v_raw_bonus, v_combo_cap);

      if v_stable_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'steady', 'label', '稳健经营', 'bonus', v_stable_bonus));
      end if;
      if v_dual_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'dual', 'label', '双线经营', 'bonus', v_dual_bonus));
      end if;
      if v_jewel_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'jewel', 'label', '慧眼识珠', 'bonus', v_jewel_bonus));
      end if;
      if v_small_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'small_budget', 'label', '小本经营', 'bonus', v_small_bonus));
      end if;
    elsif v_combo_version = 'wimbledon_2026' then
      select
        count(*) filter (where is_active),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and reached_round = 'W'),
        count(*) filter (where is_active and reached_round = 'W' and price <= 450),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        coalesce(max(case
          when is_active and price <= 300 and reached_round = 'W' then 680
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 530
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 380
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 280
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16') then 180
          when is_active and price <= 300 and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R32') then 80
          else 0
        end), 0),
        coalesce(sum(earned_points), 0)
      into
        v_contract_count, v_r32_count, v_r16_count, v_qf_count, v_sf_count,
        v_finalists, v_champions, v_value_champions,
        v_atp_r16, v_wta_r16, v_atp_qf, v_wta_qf, v_atp_sf, v_wta_sf, v_atp_f, v_wta_f,
        v_jewel_bonus, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count >= 3 then
        if v_sf_count >= 3 then v_multi_bonus := 480;
        elsif v_qf_count >= 3 then v_multi_bonus := 320;
        elsif v_r16_count >= 3 then v_multi_bonus := 180;
        elsif v_r32_count >= 3 then v_multi_bonus := 80;
        end if;
        if v_r16_count = v_contract_count then v_all_r16_bonus := 100; end if;
      end if;

      if v_atp_f > 0 and v_wta_f > 0 then v_dual_bonus := 450;
      elsif v_atp_sf > 0 and v_wta_sf > 0 then v_dual_bonus := 300;
      elsif v_atp_qf > 0 and v_wta_qf > 0 then v_dual_bonus := 170;
      elsif v_atp_r16 > 0 and v_wta_r16 > 0 then v_dual_bonus := 80;
      end if;

      if v_value_champions > 0 then v_champ_bonus := 150;
      elsif v_champions > 0 then v_champ_bonus := 50;
      end if;

      v_raw_bonus := v_multi_bonus + v_all_r16_bonus + v_dual_bonus + v_jewel_bonus + v_champ_bonus;
      v_entitled_bonus := least(v_raw_bonus, 700);

      if v_multi_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'multi', 'label', '多点开花', 'bonus', v_multi_bonus)); end if;
      if v_all_r16_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'all_r16', 'label', '全员进阶', 'bonus', v_all_r16_bonus)); end if;
      if v_dual_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'dual', 'label', '双线经营', 'bonus', v_dual_bonus)); end if;
      if v_jewel_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'jewel', 'label', '慧眼识珠', 'bonus', v_jewel_bonus)); end if;
      if v_champ_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'champion', 'label', '冠军经纪', 'bonus', v_champ_bonus)); end if;
    else
      select
        count(*) filter (where is_active),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and reached_round = 'W'),
        count(*) filter (where is_active and tier in ('C', 'D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF')),
        coalesce(sum(earned_points), 0)
      into v_contract_count, v_qf_count, v_finalists, v_champions, v_jewels, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count > 0 and v_qf_count * 100 >= v_contract_count * 60 then
        v_stable_bonus := least(round(v_gross * 0.08)::int, 80);
      end if;
      if v_finalists >= 2 then v_multi_bonus := 60; end if;
      if v_champions >= 1 then v_champ_bonus := 40; end if;
      v_jewel_bonus := greatest(v_jewels, 0) * 30;

      v_raw_bonus := v_stable_bonus + v_multi_bonus + v_champ_bonus + v_jewel_bonus;
      v_entitled_bonus := v_raw_bonus;

      if v_stable_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'steady', 'label', '稳健', 'bonus', v_stable_bonus)); end if;
      if v_multi_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'final_team', 'label', '决赛团队', 'bonus', v_multi_bonus)); end if;
      if v_champ_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'champion', 'label', '冠军经纪', 'bonus', v_champ_bonus)); end if;
      if v_jewel_bonus > 0 then v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('key', 'jewel', 'label', '慧眼识珠', 'bonus', v_jewel_bonus)); end if;
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
          'combo_cap', case when v_combo_version = 'wimbledon_2026' then 700 else v_combo_cap end,
          'gross', v_gross,
          'contract_count', v_contract_count,
          'qf_count', v_qf_count,
          'sf_count', v_sf_count,
          'finalists', v_finalists,
          'champions', v_champions,
          'stable_bonus', v_stable_bonus,
          'multi_bonus', v_multi_bonus,
          'all_r16_bonus', v_all_r16_bonus,
          'dual_bonus', v_dual_bonus,
          'jewel_bonus', v_jewel_bonus,
          'champion_bonus', v_champ_bonus,
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

revoke all on function public.tour_manager_apply_station_combo(text, int) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_station_combo(text, int) to service_role;

-- Repair lineups that the superseded one-shot Combo function marked settled
-- before every non-cancelled event in the station had a completed final.
with station_progress as (
  select
    e.station_key,
    e.season,
    count(distinct e.event_key) filter (where e.market_status <> 'cancelled') as event_count,
    count(distinct m.event_key) filter (
      where e.market_status <> 'cancelled'
        and m.round_key = 'F'
        and m.status in ('completed', 'walkover', 'retired')
        and m.winner_key is not null
    ) as completed_finals,
    bool_or(
      e.market_status <> 'cancelled'
      and coalesce(e.submission_cutoff_at, e.submission_closes_at) is not null
      and now() > coalesce(e.submission_cutoff_at, e.submission_closes_at)
    ) as cutoff_passed
  from public.tour_manager_events e
  left join public.tour_manager_matches m on m.event_key = e.event_key
  group by e.station_key, e.season
),
prematurely_settled as (
  select
    l.id,
    case
      when sp.cutoff_passed then
        case when exists (
          select 1
          from public.tour_manager_lineup_players lp
          where lp.lineup_id = l.id
            and lp.earned_points > 0
        ) then 'settling' else 'locked' end
      else 'submitted'
    end as restored_status
  from public.tour_manager_lineups l
  join station_progress sp
    on sp.station_key = l.station_key
   and sp.season = l.season
  where l.status = 'settled'
    and l.station_key in ('2026-w27-wimbledon', '2026-w29-bastad-athens')
    and sp.event_count > sp.completed_finals
)
update public.tour_manager_lineups l
set status = ps.restored_status,
    settled_at = null
from prematurely_settled ps
where l.id = ps.id;

-- Idempotent repair: mark historical contracts eliminated when a completed
-- match shows that player lost, but old metadata never recorded the state.
with loss_candidates as (
  select distinct on (lp.id)
    lp.id as contract_id,
    m.match_key,
    m.round_key
  from public.tour_manager_lineup_players lp
  join public.tour_manager_lineups l on l.id = lp.lineup_id
  join public.tour_manager_matches m
    on m.event_key = lp.event_key
   and (m.player1_key = lp.player_key or m.player2_key = lp.player_key)
  where m.status in ('completed', 'walkover', 'retired')
    and m.winner_key is not null
    and m.winner_key <> lp.player_key
    and l.season = 2026
    and l.status in ('submitted', 'locked', 'settling', 'settled')
    and lower(coalesce(lp.metadata->>'is_eliminated', 'false')) not in ('true', '1', 'yes')
    and public.tour_manager_round_order(m.round_key) <= public.tour_manager_round_order(coalesce(lp.reached_round, 'OUT'))
    and (m.scheduled_at is null or lp.created_at <= m.scheduled_at)
    and (lp.replaced_at is null or m.scheduled_at is null or m.scheduled_at < lp.replaced_at)
  order by
    lp.id,
    public.tour_manager_round_order(m.round_key) desc,
    m.scheduled_at desc nulls last,
    m.match_key desc
)
update public.tour_manager_lineup_players lp
set metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
      'is_eliminated', true,
      'status_zh', '出局',
      'elimination_repaired_at', now(),
      'last_settled_match_key', lc.match_key,
      'last_settled_round', lc.round_key
    )
from loss_candidates lc
where lp.id = lc.contract_id;
