-- Current-station rule overrides and the normal-tour Combo V2 policy.

create table if not exists public.tour_manager_station_configs (
  station_key text not null,
  season int not null,
  station_grant int check (station_grant >= 0),
  combo_version text not null default 'classic',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (station_key, season)
);

alter table public.tour_manager_station_configs enable row level security;

drop policy if exists tour_manager_station_configs_read on public.tour_manager_station_configs;
create policy tour_manager_station_configs_read
on public.tour_manager_station_configs
for select
using (true);

grant select on public.tour_manager_station_configs to anon, authenticated;
grant all on public.tour_manager_station_configs to service_role;

insert into public.tour_manager_station_configs (
  station_key, season, station_grant, combo_version, metadata
)
values (
  '2026-w29-bastad-athens',
  2026,
  200,
  'normal_2026_v2',
  jsonb_build_object(
    'combo', jsonb_build_object(
      'total_cap', 200,
      'steady', jsonb_build_object('min_players', 2, 'qf_ratio', 0.5, 'gross_rate', 0.08, 'cap', 50),
      'dual_tour', jsonb_build_object('QF', 20, 'SF', 45, 'F', 80),
      'value_pick', jsonb_build_object('tiers', jsonb_build_array('C', 'D'), 'QF', 20, 'SF', 45, 'F', 80, 'W', 125, 'max_triggers', 1),
      'small_budget', jsonb_build_object('max_cost', 200, 'gross_multipliers', jsonb_build_array(1, 1.5, 2.5), 'bonuses', jsonb_build_array(20, 50, 90))
    ),
    'source', 'data/manager/active_events.json'
  )
)
on conflict (station_key, season) do update
set station_grant = excluded.station_grant,
    combo_version = excluded.combo_version,
    metadata = excluded.metadata,
    updated_at = now();

create or replace function public.tour_manager_station_rules(
  p_station_key text,
  p_season int
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_event_count int;
  v_min_players int;
  v_max_players int;
  v_station_grant int;
  v_station_grant_override int;
  v_transfer_fee numeric;
  v_top_level text;
begin
  select
    count(*),
    min(public.tour_manager_level_min_players(level)),
    sum(public.tour_manager_level_max_players(level)),
    sum(public.tour_manager_level_side_grant(level)),
    max(public.tour_manager_level_transfer_fee(level)),
    (array_agg(level order by public.tour_manager_level_rank(level) desc))[1]
  into v_event_count, v_min_players, v_max_players, v_station_grant, v_transfer_fee, v_top_level
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status <> 'cancelled';

  if coalesce(v_event_count, 0) = 0 then
    raise exception 'station_not_found';
  end if;

  select station_grant
  into v_station_grant_override
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  v_station_grant := coalesce(v_station_grant_override, v_station_grant);

  return jsonb_build_object(
    'event_count', v_event_count,
    'min_players', v_min_players,
    'max_players', v_max_players,
    'station_grant', v_station_grant,
    'transfer_fee_rate', v_transfer_fee,
    'top_level', v_top_level
  );
end;
$$;

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
  v_jewel_bonus int;
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
  v_champ_bonus int;
  v_small_bonus int;
  v_raw_bonus int;
  v_bonus int;
  v_balance int;
  v_applied int := 0;
  v_combo_details jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select combo_version, coalesce((metadata #>> '{combo,total_cap}')::int, 0)
  into v_combo_version, v_combo_cap
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  if v_combo_version is null then
    v_combo_version := case when p_station_key = '2026-w27-wimbledon' then 'wimbledon_2026' else 'classic' end;
  end if;
  if v_combo_version = 'normal_2026_v2' and coalesce(v_combo_cap, 0) <= 0 then
    v_combo_cap := 200;
  end if;

  for v_lineup in
    select *
    from public.tour_manager_lineups
    where station_key = p_station_key
      and season = p_season
      and status <> 'cancelled'
  loop
    if exists (
      select 1 from public.tour_manager_wallet_ledger
      where lineup_id = v_lineup.id and type = 'station_combo_bonus'
    ) then
      continue;
    end if;

    v_stable_bonus := 0;
    v_contract_count := 0;
    v_r32_count := 0;
    v_r16_count := 0;
    v_qf_count := 0;
    v_sf_count := 0;
    v_finalists := 0;
    v_champions := 0;
    v_value_champions := 0;
    v_jewels := 0;
    v_gross := 0;
    v_multi_bonus := 0;
    v_all_r16_bonus := 0;
    v_dual_bonus := 0;
    v_champ_bonus := 0;
    v_jewel_bonus := 0;
    v_small_bonus := 0;
    v_raw_bonus := 0;
    v_bonus := 0;
    v_combo_details := '[]'::jsonb;

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
          when is_active and tier in ('C','D') and reached_round = 'W' then 125
          when is_active and tier in ('C','D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F') then 80
          when is_active and tier in ('C','D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('SF') then 45
          when is_active and tier in ('C','D') and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF') then 20
          else 0
        end), 0),
        coalesce(sum(earned_points) filter (where is_active), 0)
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
      v_bonus := least(v_raw_bonus, v_combo_cap);

      if v_stable_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('label', '稳健经营', 'amount', v_stable_bonus));
      end if;
      if v_dual_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('label', '双线经营', 'amount', v_dual_bonus));
      end if;
      if v_jewel_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('label', '慧眼识珠', 'amount', v_jewel_bonus));
      end if;
      if v_small_bonus > 0 then
        v_combo_details := v_combo_details || jsonb_build_array(jsonb_build_object('label', '小本经营', 'amount', v_small_bonus));
      end if;
    elsif v_combo_version = 'wimbledon_2026' then
      select
        count(*) filter (where is_active),
        count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R32')),
        count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and reached_round = 'W'),
        count(*) filter (where is_active and reached_round = 'W' and price <= 450),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R16')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF')),
        count(*) filter (where is_active and tour = 'ATP' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F')),
        count(*) filter (where is_active and tour = 'WTA' and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F')),
        coalesce(max(case
          when is_active and price <= 300 and reached_round = 'W' then 680
          when is_active and price <= 300 and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F') then 530
          when is_active and price <= 300 and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF') then 380
          when is_active and price <= 300 and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF') then 280
          when is_active and price <= 300 and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R16') then 180
          when is_active and price <= 300 and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('R32') then 80
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
      v_bonus := least(v_raw_bonus, 700);
    else
      select count(*) filter (where is_active),
             count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF')),
             count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F')),
             count(*) filter (where is_active and reached_round = 'W'),
             count(*) filter (where is_active and tier in ('C','D') and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF')),
             coalesce(sum(earned_points), 0)
      into v_contract_count, v_qf_count, v_finalists, v_champions, v_jewels, v_gross
      from public.tour_manager_lineup_players
      where lineup_id = v_lineup.id;

      if v_contract_count > 0 and v_qf_count * 100 >= v_contract_count * 60 then
        v_bonus := v_bonus + least(round(v_gross * 0.08)::int, 80);
      end if;
      if v_finalists >= 2 then v_bonus := v_bonus + 60; end if;
      if v_champions >= 1 then v_bonus := v_bonus + 40; end if;
      v_jewel_bonus := greatest(v_jewels, 0) * 30;
      v_bonus := v_bonus + v_jewel_bonus;
      v_raw_bonus := v_bonus;
    end if;

    if v_bonus > 0 then
      update public.tour_manager_wallets
      set balance = balance + v_bonus
      where user_id = v_lineup.user_id and season = v_lineup.season
      returning balance into v_balance;

      insert into public.tour_manager_wallet_ledger (
        user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
      )
      values (
        v_lineup.user_id, v_lineup.season, v_lineup.station_key, v_lineup.id,
        'station_combo_bonus', v_bonus, v_balance, '本站组合奖励',
        jsonb_build_object(
          'combo_version', v_combo_version,
          'raw_bonus', v_raw_bonus,
          'combo_cap', v_combo_cap,
          'gross', v_gross,
          'contract_count', v_contract_count,
          'qf_count', v_qf_count,
          'sf_count', v_sf_count,
          'finalists', v_finalists,
          'champions', v_champions,
          'stable_bonus', v_stable_bonus,
          'dual_bonus', v_dual_bonus,
          'jewel_bonus', v_jewel_bonus,
          'small_budget_bonus', v_small_bonus,
          'combo_details', v_combo_details
        )
      );
      v_applied := v_applied + 1;
    end if;

    update public.tour_manager_lineups
    set status = 'settled',
        settled_at = coalesce(settled_at, now())
    where id = v_lineup.id
      and status in ('submitted','locked','settling');
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.tour_manager_apply_station_combo(text, int) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_station_combo(text, int) to service_role;
