-- 巡回赛经纪人：个人 ledger 不再截断；后台轮次分按赛事签位数计算。

create or replace function public.tour_manager_round_points(
  p_tour text,
  p_level text,
  p_round_key text,
  p_draw_size int
)
returns int
language sql
immutable
as $$
  with norm as (
    select
      upper(coalesce(p_tour, 'WTA')) as tour,
      upper(coalesce(p_level, '500')) as level,
      upper(coalesce(p_round_key, 'OUT')) as round_key,
      case
        when coalesce(p_draw_size, 32) >= 128 then '128'
        when coalesce(p_draw_size, 32) >= 96 then '96'
        when coalesce(p_draw_size, 32) >= 64 then '64'
        when coalesce(p_draw_size, 32) >= 56 then '56'
        when coalesce(p_draw_size, 32) >= 48 then '48'
        when coalesce(p_draw_size, 32) >= 32 then '32'
        when coalesce(p_draw_size, 32) >= 28 then '28'
        else '32'
      end as bucket
  )
  select case tour
    when 'ATP' then case level
      when '250' then case
        when bucket in ('28','32') then case round_key when 'R16' then 25 when 'QF' then 50 when 'SF' then 100 when 'F' then 165 when 'W' then 250 else 0 end
        when bucket = '48' then case round_key when 'R32' then 13 when 'R16' then 25 when 'QF' then 50 when 'SF' then 100 when 'F' then 165 when 'W' then 250 else 0 end
        else case round_key when 'R16' then 25 when 'QF' then 50 when 'SF' then 100 when 'F' then 165 when 'W' then 250 else 0 end
      end
      when '500' then case
        when bucket in ('28','32') then case round_key when 'R16' then 50 when 'QF' then 100 when 'SF' then 200 when 'F' then 330 when 'W' then 500 else 0 end
        when bucket = '48' then case round_key when 'R32' then 25 when 'R16' then 50 when 'QF' then 100 when 'SF' then 200 when 'F' then 330 when 'W' then 500 else 0 end
        else case round_key when 'R16' then 50 when 'QF' then 100 when 'SF' then 200 when 'F' then 330 when 'W' then 500 else 0 end
      end
      when '1000' then case
        when bucket in ('56','64') then case round_key when 'R64' then 10 when 'R32' then 50 when 'R16' then 100 when 'QF' then 200 when 'SF' then 400 when 'F' then 650 when 'W' then 1000 else 0 end
        when bucket = '96' then case round_key when 'R128' then 10 when 'R64' then 30 when 'R32' then 50 when 'R16' then 100 when 'QF' then 200 when 'SF' then 400 when 'F' then 650 when 'W' then 1000 else 0 end
        else case round_key when 'R32' then 50 when 'R16' then 100 when 'QF' then 200 when 'SF' then 400 when 'F' then 650 when 'W' then 1000 else 0 end
      end
      when 'GS' then case round_key
        when 'R128' then 10 when 'R64' then 50 when 'R32' then 100 when 'R16' then 200
        when 'QF' then 400 when 'SF' then 800 when 'F' then 1300 when 'W' then 2000 else 0 end
      else 0 end
    else case level
      when '250' then case
        when bucket in ('28','32') then case round_key when 'R32' then 1 when 'R16' then 30 when 'QF' then 54 when 'SF' then 98 when 'F' then 163 when 'W' then 250 else 0 end
        when bucket = '48' then case round_key when 'R64' then 1 when 'R32' then 18 when 'R16' then 30 when 'QF' then 54 when 'SF' then 98 when 'F' then 163 when 'W' then 250 else 0 end
        else case round_key when 'R32' then 1 when 'R16' then 30 when 'QF' then 54 when 'SF' then 98 when 'F' then 163 when 'W' then 250 else 0 end
      end
      when '500' then case
        when bucket in ('28','32') then case round_key when 'R32' then 1 when 'R16' then 60 when 'QF' then 108 when 'SF' then 195 when 'F' then 325 when 'W' then 500 else 0 end
        when bucket = '48' then case round_key when 'R64' then 1 when 'R32' then 30 when 'R16' then 60 when 'QF' then 108 when 'SF' then 195 when 'F' then 325 when 'W' then 500 else 0 end
        else case round_key when 'R32' then 1 when 'R16' then 60 when 'QF' then 108 when 'SF' then 195 when 'F' then 325 when 'W' then 500 else 0 end
      end
      when '1000' then case
        when bucket in ('56','64') then case round_key when 'R64' then 10 when 'R32' then 65 when 'R16' then 120 when 'QF' then 215 when 'SF' then 390 when 'F' then 650 when 'W' then 1000 else 0 end
        when bucket = '96' then case round_key when 'R128' then 10 when 'R64' then 35 when 'R32' then 65 when 'R16' then 120 when 'QF' then 215 when 'SF' then 390 when 'F' then 650 when 'W' then 1000 else 0 end
        else case round_key when 'R32' then 65 when 'R16' then 120 when 'QF' then 215 when 'SF' then 390 when 'F' then 650 when 'W' then 1000 else 0 end
      end
      when 'GS' then case round_key
        when 'R128' then 10 when 'R64' then 70 when 'R32' then 130 when 'R16' then 240
        when 'QF' then 430 when 'SF' then 780 when 'F' then 1300 when 'W' then 2000 else 0 end
      else 0 end
  end
  from norm
$$;

create or replace function public.tour_manager_round_points(
  p_tour text,
  p_level text,
  p_round_key text
)
returns int
language sql
immutable
as $$
  select public.tour_manager_round_points(p_tour, p_level, p_round_key, 32)
$$;

create or replace function public.tour_manager_price_tier(
  p_price int,
  p_tour text,
  p_level text,
  p_draw_size int
)
returns text
language plpgsql
immutable
as $$
declare
  v_winner numeric := greatest(public.tour_manager_round_points(p_tour, p_level, 'W', p_draw_size), 1);
  v_ratio numeric := greatest(coalesce(p_price, 0), 0) / v_winner;
begin
  if v_ratio >= 0.62 then return 'S'; end if;
  if v_ratio >= 0.46 then return 'A'; end if;
  if v_ratio >= 0.29 then return 'B'; end if;
  if v_ratio >= 0.16 then return 'C'; end if;
  return 'D';
end;
$$;

create or replace function public.tour_manager_price_tier(
  p_price int,
  p_tour text,
  p_level text
)
returns text
language plpgsql
immutable
as $$
begin
  return public.tour_manager_price_tier(p_price, p_tour, p_level, 32);
end;
$$;

create or replace function public.tour_manager_get_my_state(
  p_station_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_lineup public.tour_manager_lineups;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select * into v_lineup
  from public.tour_manager_lineups
  where user_id = v_user and station_key = p_station_key
  order by submitted_at desc
  limit 1;

  return jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'lineup', case when v_lineup.id is null then null else to_jsonb(v_lineup) end,
    'contracts', coalesce((
      select jsonb_agg(to_jsonb(lp) order by lp.created_at)
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = v_lineup.id
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(wl) order by wl.created_at desc)
      from public.tour_manager_wallet_ledger wl
      where wl.user_id = v_user
        and wl.season = p_season
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.tour_manager_transfer_player(
  p_lineup_id uuid,
  p_out_contract_id uuid,
  p_in_contract jsonb,
  p_fee_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lineup public.tour_manager_lineups;
  v_out public.tour_manager_lineup_players;
  v_in public.tour_manager_event_players;
  v_event public.tour_manager_events;
  v_balance int;
  v_new_price int;
  v_refund int;
  v_fee int;
  v_delta int;
  v_in_id uuid;
  v_open timestamptz;
  v_close timestamptz;
  v_out_eliminated boolean := false;
  v_baseline_round text := 'OUT';
  v_baseline_points int := 0;
  v_old_lineup_cost int := 0;
  v_old_station_used int := 0;
  v_old_wallet_used int := 0;
  v_new_lineup_cost int := 0;
  v_new_station_used int := 0;
  v_new_wallet_used int := 0;
  v_station_used_delta int := 0;
  v_wallet_used_delta int := 0;
  v_wallet_delta int := 0;
  v_station_remaining int := 0;
  v_refund_remaining int := 0;
  v_wallet_release int := 0;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select * into v_lineup
  from public.tour_manager_lineups
  where id = p_lineup_id and user_id = v_user
  for update;

  if v_lineup.id is null then
    raise exception 'lineup_not_found';
  end if;
  if v_lineup.transfer_count >= v_lineup.max_transfers then
    raise exception 'transfer_limit_reached';
  end if;
  if v_lineup.status not in ('submitted','locked','settling') then
    raise exception 'lineup_not_transferable';
  end if;

  select * into v_out
  from public.tour_manager_lineup_players
  where id = p_out_contract_id and lineup_id = p_lineup_id and is_active
  for update;

  if v_out.id is null then
    raise exception 'out_contract_not_found';
  end if;

  select ep.* into v_in
  from public.tour_manager_event_players ep
  join public.tour_manager_events e on e.event_key = ep.event_key
  where ep.event_key = p_in_contract->>'event_key'
    and ep.player_key = p_in_contract->>'player_key'
    and e.market_status in ('open','locked')
  limit 1;

  if v_in.player_key is null then
    raise exception 'invalid_new_contract';
  end if;
  if v_in.event_key <> v_out.event_key then
    raise exception 'transfer_event_mismatch';
  end if;

  select * into v_event
  from public.tour_manager_events
  where event_key = v_out.event_key;

  if v_event.station_key <> v_lineup.station_key then
    raise exception 'contract_not_in_station';
  end if;

  v_open := coalesce(v_event.transfer_window_opens_at, v_event.round1_completed_at);
  v_close := coalesce(v_event.transfer_window_closes_at, v_event.round2_first_match_at);
  if v_open is null or v_close is null then
    raise exception 'transfer_window_pending';
  end if;
  if now() < v_open then
    raise exception 'transfer_window_not_open';
  end if;
  if now() > v_close then
    raise exception 'transfer_window_closed';
  end if;

  if exists (
    select 1
    from public.tour_manager_matches m
    where m.event_key = v_in.event_key
      and (m.player1_key = v_in.player_key or m.player2_key = v_in.player_key)
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and m.winner_key <> v_in.player_key
  ) then
    raise exception 'incoming_player_eliminated';
  end if;

  if exists (
    select 1
    from public.tour_manager_matches m
    where m.event_key = v_in.event_key
      and (m.player1_key = v_in.player_key or m.player2_key = v_in.player_key)
      and coalesce(m.round_order, public.tour_manager_round_order(m.round_key)) >= 2
      and (m.status in ('live','completed','walkover','retired') or (m.scheduled_at is not null and m.scheduled_at <= now()))
  ) then
    raise exception 'incoming_player_next_match_started';
  end if;

  if exists (
    select 1 from public.tour_manager_lineup_players lp
    where lp.lineup_id = p_lineup_id and lp.player_key = v_in.player_key and lp.is_active
  ) then
    raise exception 'player_already_active';
  end if;

  select exists (
    select 1
    from public.tour_manager_matches m
    where m.event_key = v_out.event_key
      and (m.player1_key = v_out.player_key or m.player2_key = v_out.player_key)
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and m.winner_key <> v_out.player_key
  ) into v_out_eliminated;

  v_out_eliminated := v_out_eliminated
    or lower(coalesce(v_out.metadata->>'is_eliminated', '')) in ('true','1','yes')
    or lower(coalesce(v_out.metadata->>'eliminated', '')) in ('true','1','yes')
    or lower(coalesce(v_out.metadata->>'status', '')) = 'eliminated'
    or coalesce(v_out.metadata->>'status_zh', '') = '出局';

  select s.reached_round,
         public.tour_manager_round_points(v_in.tour, v_event.level, s.reached_round, v_event.draw_size)
    into v_baseline_round, v_baseline_points
  from (
    select case
             when m.winner_key = v_in.player_key then public.tour_manager_next_round_key(m.round_key)
             else m.round_key
           end as reached_round,
           m.scheduled_at,
           m.match_key
    from public.tour_manager_matches m
    where m.event_key = v_in.event_key
      and (m.player1_key = v_in.player_key or m.player2_key = v_in.player_key)
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and (m.scheduled_at is null or m.scheduled_at <= now())
  ) s
  where s.reached_round is not null
  order by public.tour_manager_round_order(s.reached_round) desc,
           public.tour_manager_round_points(v_in.tour, v_event.level, s.reached_round, v_event.draw_size) desc,
           s.scheduled_at desc nulls last,
           s.match_key desc
  limit 1;

  v_baseline_round := coalesce(v_baseline_round, 'OUT');
  v_baseline_points := coalesce(v_baseline_points, 0);

  v_new_price := v_in.price;
  if v_new_price <= 0 then
    raise exception 'invalid_new_contract';
  end if;

  v_refund := case when v_out_eliminated then 0 else round(v_out.price * 0.70) end;
  v_fee := ceil(v_new_price * v_lineup.transfer_fee_rate);
  v_delta := v_new_price + v_fee - v_refund;

  v_old_lineup_cost := greatest(coalesce(v_lineup.lineup_cost, 0), 0);
  v_old_station_used := greatest(coalesce(v_lineup.station_grant_used, 0), 0);
  v_old_wallet_used := greatest(coalesce(v_lineup.wallet_used, 0), 0);
  v_new_lineup_cost := greatest(v_old_lineup_cost + v_delta, 0);
  if v_delta >= 0 then
    v_station_remaining := greatest(coalesce(v_lineup.station_grant, 0) - v_old_station_used, 0);
    v_station_used_delta := least(v_delta, v_station_remaining);
    v_wallet_used_delta := greatest(v_delta - v_station_used_delta, 0);
    v_wallet_delta := -v_wallet_used_delta;
  else
    v_refund_remaining := -v_delta;
    v_wallet_release := least(v_refund_remaining, v_old_wallet_used);
    v_wallet_used_delta := -v_wallet_release;
    v_station_used_delta := 0;
    v_wallet_delta := v_refund_remaining;
  end if;
  v_new_station_used := greatest(v_old_station_used + v_station_used_delta, 0);
  v_new_wallet_used := greatest(v_old_wallet_used + v_wallet_used_delta, 0);

  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user and season = v_lineup.season
  for update;

  if v_wallet_used_delta > coalesce(v_balance, 0) then
    raise exception 'insufficient_wallet_for_transfer';
  end if;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, reached_round, is_transfer, metadata
  )
  values (
    p_lineup_id, v_in.event_key, v_in.player_key, v_in.tour, v_in.name_zh, v_in.name_en, v_new_price,
    public.tour_manager_price_tier(v_in.price, v_in.tour, v_event.level, v_event.draw_size),
    coalesce(p_in_contract->>'predicted_round', 'OUT'),
    v_baseline_round,
    true,
    to_jsonb(v_in) || jsonb_build_object(
      'client_prediction', coalesce(p_in_contract->>'predicted_round', 'OUT'),
      'level', v_event.level,
      'draw_size', v_event.draw_size,
      'transfer_baseline_round', v_baseline_round,
      'transfer_baseline_points', v_baseline_points
    )
  )
  returning id into v_in_id;

  update public.tour_manager_lineup_players
  set is_active = false, replaced_at = now(), replaced_by_contract_id = v_in_id
  where id = p_out_contract_id;

  update public.tour_manager_wallets
  set balance = balance + v_wallet_delta
  where user_id = v_user and season = v_lineup.season
  returning balance into v_balance;

  update public.tour_manager_lineups
  set transfer_count = transfer_count + 1,
      lineup_cost = v_new_lineup_cost,
      station_grant_used = v_new_station_used,
      wallet_used = v_new_wallet_used
  where id = p_lineup_id;

  insert into public.tour_manager_transfers (
    lineup_id, user_id, season, station_key, out_contract_id, in_contract_id,
    refund_amount, sunk_loss, new_contract_price, fee_amount, wallet_delta
  )
  values (
    p_lineup_id, v_user, v_lineup.season, v_lineup.station_key,
    p_out_contract_id, v_in_id, v_refund, v_out.price - v_refund,
    v_new_price, v_fee, v_wallet_delta
  );

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, v_lineup.season, v_lineup.station_key, p_lineup_id,
    'transfer_delta', v_wallet_delta, v_balance,
    '换人窗口调仓',
    jsonb_build_object(
      'out_player', v_out.name_zh,
      'in_player', v_in.name_zh,
      'refund', v_refund,
      'refund_policy', case when v_out_eliminated then 'eliminated_no_refund' else 'active_70_percent' end,
      'out_player_eliminated', v_out_eliminated,
      'sunk_loss', v_out.price - v_refund,
      'fee', v_fee,
      'new_price', v_new_price,
      'fee_rate', v_lineup.transfer_fee_rate,
      'event_key', v_event.event_key,
      'tour', v_event.tour,
      'cost', greatest(v_delta, 0),
      'gross', greatest(-v_delta, 0),
      'net', -v_delta,
      'transfer_total_cost', v_delta,
      'transfer_station_grant_delta', v_station_used_delta,
      'transfer_station_grant_used', greatest(v_station_used_delta, 0),
      'transfer_station_grant_released', greatest(-v_station_used_delta, 0),
      'transfer_wallet_delta', v_wallet_delta,
      'transfer_wallet_charge', greatest(v_wallet_used_delta, 0),
      'transfer_wallet_refund', greatest(v_wallet_delta, 0),
      'lineup_cost_before', v_old_lineup_cost,
      'lineup_cost_after', v_new_lineup_cost,
      'station_grant_used_before', v_old_station_used,
      'station_grant_used_after', v_new_station_used,
      'wallet_used_before', v_old_wallet_used,
      'wallet_used_after', v_new_wallet_used,
      'in_player_baseline_round', v_baseline_round,
      'in_player_baseline_points', v_baseline_points,
      'window_opens_at', v_open,
      'window_closes_at', v_close
    )
  );

  return public.tour_manager_get_my_state(v_lineup.station_key, v_lineup.season);
end;
$$;

revoke all on function public.tour_manager_transfer_player(uuid, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.tour_manager_transfer_player(uuid, uuid, jsonb, numeric) to authenticated;

create or replace function public.tour_manager_settle_completed_matches(
  p_station_key text,
  p_season int,
  p_settled_for_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_contract record;
  v_player_key text;
  v_reached text;
  v_is_final boolean;
  v_target_points int;
  v_delta int;
  v_balance int;
  v_settlement_id uuid;
  v_settlements int := 0;
  v_points int := 0;
  v_station_events int;
  v_completed_finals int;
  v_combo_count int := 0;
  v_first_round_key text;
  v_first_actual_round_key text;
  v_is_bye_first_match boolean;
  v_is_bye_first_loss boolean;
  v_baseline_round text;
  v_baseline_points int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  update public.tour_manager_lineups l
  set status = 'locked',
      locked_at = coalesce(locked_at, now())
  where l.station_key = p_station_key
    and l.season = p_season
    and l.status = 'submitted'
    and exists (
      select 1
      from public.tour_manager_events e
      where e.station_key = p_station_key
        and e.season = p_season
        and coalesce(e.submission_cutoff_at, e.submission_closes_at) is not null
        and now() > coalesce(e.submission_cutoff_at, e.submission_closes_at)
    );

  for v_match in
    select m.*, e.level, e.draw_size
    from public.tour_manager_matches m
    join public.tour_manager_events e on e.event_key = m.event_key
    where e.station_key = p_station_key
      and e.season = p_season
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and m.round_key in ('R128','R64','R32','R16','QF','SF','F')
  loop
    for v_player_key in
      select v_match.player1_key
      union all
      select v_match.player2_key
    loop
      if v_player_key is null then
        continue;
      end if;

      for v_contract in
        select lp.*, l.user_id, l.season, l.station_key, ep.first_round
        from public.tour_manager_lineup_players lp
        join public.tour_manager_lineups l on l.id = lp.lineup_id
        left join public.tour_manager_event_players ep
          on ep.event_key = lp.event_key
         and ep.player_key = lp.player_key
        where l.station_key = p_station_key
          and l.season = p_season
          and l.status in ('submitted','locked','settling','settled')
          and lp.event_key = v_match.event_key
          and lp.player_key = v_player_key
          and (v_match.scheduled_at is null or lp.created_at <= v_match.scheduled_at)
          and (lp.replaced_at is null or v_match.scheduled_at is null or v_match.scheduled_at < lp.replaced_at)
      loop
        v_baseline_round := coalesce(v_contract.metadata->>'transfer_baseline_round', 'OUT');
        v_baseline_points := case
          when coalesce(v_contract.metadata->>'transfer_baseline_points', '') ~ '^-?[0-9]+$'
            then greatest((v_contract.metadata->>'transfer_baseline_points')::int, 0)
          else 0
        end;

        v_first_round_key := public.tour_manager_first_round_key(v_match.draw_size);
        v_first_actual_round_key := public.tour_manager_next_round_key(v_first_round_key);
        v_is_bye_first_match :=
          upper(coalesce(v_contract.first_round, '')) = 'BYE'
          and v_baseline_points = 0
          and v_match.round_key = v_first_actual_round_key;
        v_is_bye_first_loss := v_is_bye_first_match and v_player_key <> v_match.winner_key;

        if v_player_key = v_match.winner_key then
          v_reached := public.tour_manager_next_round_key(v_match.round_key);
          v_is_final := v_reached = 'W';
        else
          v_reached := case
            when v_is_bye_first_loss then v_first_round_key
            else v_match.round_key
          end;
          v_is_final := true;
        end if;

        v_target_points := public.tour_manager_round_points(v_match.tour, v_match.level, v_reached, v_match.draw_size);

        if public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(v_contract.reached_round) then
          update public.tour_manager_lineup_players
          set reached_round = v_reached,
              metadata = metadata || jsonb_build_object(
                'last_settled_match_key', v_match.match_key,
                'last_settled_round', v_match.round_key,
                'is_eliminated', v_is_final and v_reached <> 'W',
                'first_round_key', v_first_round_key,
                'bye_first_match_adjusted', v_is_bye_first_loss
              )
          where id = v_contract.id;
        end if;

        v_delta := greatest(v_target_points - v_baseline_points - coalesce(v_contract.earned_points, 0), 0);
        if v_delta <= 0 then
          continue;
        end if;

        v_settlement_id := null;
        insert into public.tour_manager_settlements (
          lineup_id, contract_id, user_id, event_key, player_key, round_key,
          points_delta, is_final, source, settled_for_date
        )
        values (
          v_contract.lineup_id, v_contract.id, v_contract.user_id,
          v_match.event_key, v_player_key, v_reached,
          v_delta, v_is_final,
          jsonb_build_object(
            'match_key', v_match.match_key,
            'source_url', v_match.source_url,
            'winner_key', v_match.winner_key,
            'scheduled_at', v_match.scheduled_at,
            'target_points', v_target_points,
            'draw_size', v_match.draw_size,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          ),
          p_settled_for_date
        )
        on conflict (contract_id, round_key) do nothing
        returning id into v_settlement_id;

        if v_settlement_id is null then
          continue;
        end if;

        update public.tour_manager_lineup_players
        set earned_points = earned_points + v_delta
        where id = v_contract.id;

        update public.tour_manager_wallets
        set balance = balance + v_delta
        where user_id = v_contract.user_id and season = v_contract.season
        returning balance into v_balance;

        insert into public.tour_manager_wallet_ledger (
          user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
        )
        values (
          v_contract.user_id, v_contract.season, v_contract.station_key, v_contract.lineup_id,
          'player_points_delta', v_delta, v_balance,
          '球员收益结算',
          jsonb_build_object(
            'event_key', v_match.event_key,
            'player_key', v_player_key,
            'round_key', v_reached,
            'match_key', v_match.match_key,
            'is_final', v_is_final,
            'target_points', v_target_points,
            'draw_size', v_match.draw_size,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          )
        );

        v_settlements := v_settlements + 1;
        v_points := v_points + v_delta;
        v_settlement_id := null;
      end loop;
    end loop;
  end loop;

  update public.tour_manager_lineups
  set status = 'settling'
  where station_key = p_station_key
    and season = p_season
    and status = 'locked'
    and exists (
      select 1
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = tour_manager_lineups.id
        and lp.earned_points > 0
    );

  select count(*) into v_station_events
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status <> 'cancelled';

  select count(distinct e.event_key) into v_completed_finals
  from public.tour_manager_events e
  join public.tour_manager_matches m
    on m.event_key = e.event_key
   and m.round_key = 'F'
   and m.status in ('completed','walkover','retired')
   and m.winner_key is not null
  where e.station_key = p_station_key
    and e.season = p_season
    and e.market_status <> 'cancelled';

  if v_station_events > 0 and v_completed_finals = v_station_events then
    v_combo_count := public.tour_manager_apply_station_combo(p_station_key, p_season);
    update public.tour_manager_events
    set market_status = 'settled'
    where station_key = p_station_key
      and season = p_season
      and market_status in ('open','locked');
  end if;

  return jsonb_build_object(
    'station_key', p_station_key,
    'season', p_season,
    'settlements', v_settlements,
    'points_delta', v_points,
    'combo_lineups', v_combo_count,
    'finals_completed', v_completed_finals,
    'event_count', v_station_events
  );
end;
$$;

revoke all on function public.tour_manager_settle_completed_matches(text, int, date) from public, anon, authenticated;
grant execute on function public.tour_manager_settle_completed_matches(text, int, date) to service_role;
