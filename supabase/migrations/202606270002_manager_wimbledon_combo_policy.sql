-- 巡回赛经纪人：温网使用独立 combo 规则；历史站点继续使用旧 combo。

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
  v_multi_bonus int;
  v_all_r16_bonus int;
  v_dual_bonus int;
  v_champ_bonus int;
  v_raw_bonus int;
  v_bonus int;
  v_balance int;
  v_applied int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
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

    v_multi_bonus := 0;
    v_all_r16_bonus := 0;
    v_dual_bonus := 0;
    v_champ_bonus := 0;
    v_jewel_bonus := 0;
    v_raw_bonus := 0;
    v_bonus := 0;

    if p_station_key = '2026-w27-wimbledon' then
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
        if v_sf_count >= 3 then
          v_multi_bonus := 480;
        elsif v_qf_count >= 3 then
          v_multi_bonus := 320;
        elsif v_r16_count >= 3 then
          v_multi_bonus := 180;
        elsif v_r32_count >= 3 then
          v_multi_bonus := 80;
        end if;

        if v_r16_count = v_contract_count then
          v_all_r16_bonus := 100;
        end if;
      end if;

      if v_atp_f > 0 and v_wta_f > 0 then
        v_dual_bonus := 450;
      elsif v_atp_sf > 0 and v_wta_sf > 0 then
        v_dual_bonus := 300;
      elsif v_atp_qf > 0 and v_wta_qf > 0 then
        v_dual_bonus := 170;
      elsif v_atp_r16 > 0 and v_wta_r16 > 0 then
        v_dual_bonus := 80;
      end if;

      if v_value_champions > 0 then
        v_champ_bonus := 150;
      elsif v_champions > 0 then
        v_champ_bonus := 50;
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
      if v_finalists >= 2 then
        v_bonus := v_bonus + 60;
      end if;
      if v_champions >= 1 then
        v_bonus := v_bonus + 40;
      end if;
      v_bonus := v_bonus + greatest(v_jewels, 0) * 30;
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
        case when p_station_key = '2026-w27-wimbledon' then
          jsonb_build_object(
            'combo_version', 'wimbledon_2026',
            'combo_cap', 700,
            'raw_bonus', v_raw_bonus,
            'gross', v_gross,
            'contract_count', v_contract_count,
            'r32_count', v_r32_count,
            'r16_count', v_r16_count,
            'qf_count', v_qf_count,
            'sf_count', v_sf_count,
            'finalists', v_finalists,
            'champions', v_champions,
            'multi_bonus', v_multi_bonus,
            'all_r16_bonus', v_all_r16_bonus,
            'dual_bonus', v_dual_bonus,
            'jewel_bonus', v_jewel_bonus,
            'champion_bonus', v_champ_bonus
          )
        else
          jsonb_build_object(
            'combo_version', 'classic',
            'gross', v_gross,
            'qf_count', v_qf_count,
            'contract_count', v_contract_count,
            'finalists', v_finalists,
            'champions', v_champions,
            'jewels', v_jewels
          )
        end
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
