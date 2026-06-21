-- 巡回赛经纪人生产闭环补丁：
-- 1. 经济规则由数据库按当前 station events 推导，不信任客户端传参。
-- 2. 提交必须有明确截止时间；转会使用整站 R1 完赛/R2 首场窗口。
-- 3. 预赛/退赛替换 RPC 仅 service_role 可执行。
-- 4. 已完赛赛果可通过 service_role 触发幂等结算。

create or replace function public.tour_manager_round_order(p_round_key text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_round_key, 'OUT'))
    when 'OUT' then 0
    when 'R128' then 1
    when 'R64' then 2
    when 'R32' then 3
    when 'R16' then 4
    when 'QF' then 5
    when 'SF' then 6
    when 'F' then 7
    when 'W' then 8
    else 0
  end
$$;

create or replace function public.tour_manager_next_round_key(p_round_key text)
returns text
language sql
immutable
as $$
  select case upper(coalesce(p_round_key, 'OUT'))
    when 'R128' then 'R64'
    when 'R64' then 'R32'
    when 'R32' then 'R16'
    when 'R16' then 'QF'
    when 'QF' then 'SF'
    when 'SF' then 'F'
    when 'F' then 'W'
    else upper(coalesce(p_round_key, 'OUT'))
  end
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
  select case upper(coalesce(p_tour, 'WTA'))
    when 'ATP' then case upper(coalesce(p_level, '500'))
      when '250' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 0 when 'R16' then 25
        when 'QF' then 50 when 'SF' then 100 when 'F' then 165 when 'W' then 250 else 0 end
      when '500' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 0 when 'R16' then 50
        when 'QF' then 100 when 'SF' then 200 when 'F' then 330 when 'W' then 500 else 0 end
      when '1000' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 50 when 'R16' then 100
        when 'QF' then 200 when 'SF' then 400 when 'F' then 650 when 'W' then 1000 else 0 end
      when 'GS' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 100 when 'R64' then 100 when 'R32' then 100 when 'R16' then 200
        when 'QF' then 400 when 'SF' then 800 when 'F' then 1300 when 'W' then 2000 else 0 end
      else 0 end
    else case upper(coalesce(p_level, '500'))
      when '250' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 1 when 'R16' then 30
        when 'QF' then 54 when 'SF' then 98 when 'F' then 163 when 'W' then 250 else 0 end
      when '500' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 1 when 'R16' then 60
        when 'QF' then 108 when 'SF' then 195 when 'F' then 325 when 'W' then 500 else 0 end
      when '1000' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 0 when 'R64' then 0 when 'R32' then 65 when 'R16' then 120
        when 'QF' then 215 when 'SF' then 390 when 'F' then 650 when 'W' then 1000 else 0 end
      when 'GS' then case upper(coalesce(p_round_key, 'OUT'))
        when 'R128' then 130 when 'R64' then 130 when 'R32' then 130 when 'R16' then 240
        when 'QF' then 430 when 'SF' then 780 when 'F' then 1300 when 'W' then 2000 else 0 end
      else 0 end
  end
$$;

create or replace function public.tour_manager_level_rank(p_level text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_level, '500'))
    when '250' then 1
    when '500' then 2
    when '1000' then 3
    when 'GS' then 4
    else 2
  end
$$;

create or replace function public.tour_manager_level_min_players(p_level text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_level, '500')) when '1000' then 2 when 'GS' then 2 else 1 end
$$;

create or replace function public.tour_manager_level_max_players(p_level text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_level, '500')) when '1000' then 3 when 'GS' then 4 else 2 end
$$;

create or replace function public.tour_manager_level_side_grant(p_level text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_level, '500')) when '250' then 45 when '500' then 65 when '1000' then 120 when 'GS' then 230 else 65 end
$$;

create or replace function public.tour_manager_level_transfer_fee(p_level text)
returns numeric
language sql
immutable
as $$
  select case when public.tour_manager_level_rank(p_level) >= 3 then 0.15 else 0.10 end
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
declare
  v_winner numeric := greatest(public.tour_manager_round_points(p_tour, p_level, 'W'), 1);
  v_ratio numeric := greatest(coalesce(p_price, 0), 0) / v_winner;
begin
  if v_ratio >= 0.62 then return 'S'; end if;
  if v_ratio >= 0.46 then return 'A'; end if;
  if v_ratio >= 0.29 then return 'B'; end if;
  if v_ratio >= 0.16 then return 'C'; end if;
  return 'D';
end;
$$;

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

create unique index if not exists tour_manager_settlements_contract_round_once
on public.tour_manager_settlements(contract_id, round_key);

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
  v_cost int;
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
  into v_found, v_cost
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

  v_station_used := least(v_cost, greatest(v_station_grant, 0));
  v_wallet_used := greatest(v_cost - greatest(v_station_grant, 0), 0);

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
  if v_balance + greatest(v_station_grant, 0) < v_cost then
    raise exception 'insufficient_budget';
  end if;

  insert into public.tour_manager_lineups (
    user_id, season, station_key, status, lineup_cost, station_grant,
    station_grant_used, wallet_used, min_players, max_players,
    max_transfers, transfer_fee_rate, predictions,
    predicted_gross, predicted_bonus, predicted_net, lineup_style
  )
  values (
    v_user, p_season, p_station_key, 'submitted', v_cost, v_station_grant,
    v_station_used, v_wallet_used, v_min_players, v_max_players,
    1, v_transfer_fee_rate, coalesce(p_predictions, '{}'::jsonb),
    coalesce(p_predicted_gross, 0), coalesce(p_predicted_bonus, 0),
    coalesce(p_predicted_net, 0), p_lineup_style
  )
  returning id into v_lineup_id;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, metadata
  )
  select
    v_lineup_id, ep.event_key, ep.player_key, ep.tour, ep.name_zh, ep.name_en, ep.price,
    public.tour_manager_price_tier(ep.price, ep.tour, e.level),
    coalesce(p_predictions->>ep.player_key, 'OUT'),
    to_jsonb(ep) || jsonb_build_object(
      'client_prediction', coalesce(p_predictions->>ep.player_key, 'OUT'),
      'level', e.level
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
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
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
      user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup_id, 'lineup_wallet_spend',
      -v_wallet_used, v_balance - 10, '提交阵容占用经纪人钱包',
      jsonb_build_object(
        'cost', v_cost,
        'gross', coalesce(p_predicted_gross, 0),
        'bonus', coalesce(p_predicted_bonus, 0),
        'net', -v_wallet_used,
        'lineup_cost', v_cost,
        'station_grant_used', v_station_used,
        'wallet_used', v_wallet_used,
        'rules', v_rules,
        'players', v_players
      )
    );
  end if;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, p_season, p_station_key, v_lineup_id, 'submit_bonus',
    10, v_balance, '提交阵容奖励',
    jsonb_build_object(
      'cost', v_cost,
      'gross', coalesce(p_predicted_gross, 0),
      'bonus', 10,
      'net', 10,
      'lineup_cost', v_cost,
      'station_grant_used', v_station_used,
      'wallet_used', v_wallet_used,
      'rules', v_rules,
      'players', v_players
    )
  );

  return public.tour_manager_get_my_state(p_station_key, p_season);
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
  v_window_events int;
  v_open_count int;
  v_close_count int;
  v_open timestamptz;
  v_close timestamptz;
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

  select * into v_event
  from public.tour_manager_events
  where event_key = v_in.event_key;

  if v_event.station_key <> v_lineup.station_key then
    raise exception 'contract_not_in_station';
  end if;

  select count(*),
         count(coalesce(transfer_window_opens_at, round1_completed_at)),
         count(coalesce(transfer_window_closes_at, round2_first_match_at)),
         max(coalesce(transfer_window_opens_at, round1_completed_at)),
         min(coalesce(transfer_window_closes_at, round2_first_match_at))
  into v_window_events, v_open_count, v_close_count, v_open, v_close
  from public.tour_manager_events
  where station_key = v_lineup.station_key
    and season = v_lineup.season
    and market_status <> 'cancelled';

  if coalesce(v_window_events, 0) = 0 or v_open_count <> v_window_events or v_close_count <> v_window_events then
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

  v_new_price := v_in.price;
  if v_new_price <= 0 then
    raise exception 'invalid_new_contract';
  end if;

  v_refund := round(v_out.price * 0.70);
  v_fee := ceil(v_new_price * v_lineup.transfer_fee_rate);
  v_delta := v_new_price + v_fee - v_refund;

  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user and season = v_lineup.season
  for update;

  if v_delta > v_balance then
    raise exception 'insufficient_wallet_for_transfer';
  end if;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, is_transfer, metadata
  )
  values (
    p_lineup_id, v_in.event_key, v_in.player_key, v_in.tour, v_in.name_zh, v_in.name_en, v_new_price,
    public.tour_manager_price_tier(v_in.price, v_in.tour, v_event.level),
    coalesce(p_in_contract->>'predicted_round', 'OUT'),
    true,
    to_jsonb(v_in) || jsonb_build_object(
      'client_prediction', coalesce(p_in_contract->>'predicted_round', 'OUT'),
      'level', v_event.level
    )
  )
  returning id into v_in_id;

  update public.tour_manager_lineup_players
  set is_active = false, replaced_at = now(), replaced_by_contract_id = v_in_id
  where id = p_out_contract_id;

  update public.tour_manager_wallets
  set balance = balance - v_delta
  where user_id = v_user and season = v_lineup.season
  returning balance into v_balance;

  update public.tour_manager_lineups
  set transfer_count = transfer_count + 1,
      lineup_cost = lineup_cost + v_delta,
      wallet_used = wallet_used + greatest(v_delta, 0)
  where id = p_lineup_id;

  insert into public.tour_manager_transfers (
    lineup_id, user_id, season, station_key, out_contract_id, in_contract_id,
    refund_amount, sunk_loss, new_contract_price, fee_amount, wallet_delta
  )
  values (
    p_lineup_id, v_user, v_lineup.season, v_lineup.station_key,
    p_out_contract_id, v_in_id, v_refund, v_out.price - v_refund,
    v_new_price, v_fee, -v_delta
  );

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, v_lineup.season, v_lineup.station_key, p_lineup_id,
    'transfer_delta', -v_delta, v_balance,
    '换人窗口调仓',
    jsonb_build_object(
      'out_player', v_out.name_zh,
      'in_player', v_in.name_zh,
      'refund', v_refund,
      'sunk_loss', v_out.price - v_refund,
      'fee', v_fee,
      'new_price', v_new_price,
      'fee_rate', v_lineup.transfer_fee_rate,
      'window_opens_at', v_open,
      'window_closes_at', v_close
    )
  );

  return public.tour_manager_get_my_state(v_lineup.station_key, v_lineup.season);
end;
$$;

create or replace function public.tour_manager_apply_pre_r1_substitution(
  p_event_key text,
  p_out_player_key text,
  p_in_player_key text,
  p_source_url text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.tour_manager_events;
  v_in public.tour_manager_event_players;
  v_count int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select * into v_event
  from public.tour_manager_events
  where event_key = p_event_key;
  if v_event.event_key is null then
    raise exception 'event_not_found';
  end if;
  if v_event.main_draw_first_match_at is not null and now() >= v_event.main_draw_first_match_at then
    raise exception 'main_draw_already_started';
  end if;
  if exists (
    select 1
    from public.tour_manager_matches m
    where m.event_key = p_event_key
      and coalesce(m.round_order, public.tour_manager_round_order(m.round_key)) = 1
      and (m.status in ('live','completed','walkover','retired') or (m.scheduled_at is not null and m.scheduled_at <= now()))
  ) then
    raise exception 'main_draw_already_started';
  end if;

  select * into v_in
  from public.tour_manager_event_players
  where event_key = p_event_key and player_key = p_in_player_key;
  if v_in.player_key is null then
    raise exception 'replacement_player_not_found';
  end if;

  insert into public.tour_manager_player_substitutions (
    station_key, event_key, out_player_key, in_player_key, source_url
  )
  values (
    v_event.station_key, p_event_key, p_out_player_key, p_in_player_key, p_source_url
  )
  on conflict (event_key, out_player_key)
  do update set
    in_player_key = excluded.in_player_key,
    source_url = excluded.source_url,
    effective_at = now();

  update public.tour_manager_lineup_players lp
  set player_key = v_in.player_key,
      name_zh = v_in.name_zh,
      name_en = v_in.name_en,
      price = v_in.price,
      tier = public.tour_manager_price_tier(v_in.price, v_in.tour, v_event.level),
      metadata = lp.metadata || jsonb_build_object(
        'substituted_from_player_key', p_out_player_key,
        'substitution_reason', 'pre_r1_withdrawal',
        'substitution_source_url', p_source_url,
        'replacement_event_player', to_jsonb(v_in)
      )
  where lp.event_key = p_event_key
    and lp.player_key = p_out_player_key
    and lp.is_active
    and exists (
      select 1 from public.tour_manager_lineups l
      where l.id = lp.lineup_id and l.status in ('submitted','locked')
    );

  get diagnostics v_count = row_count;
  return v_count;
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
  v_contract_count int;
  v_qf_count int;
  v_finalists int;
  v_champions int;
  v_jewels int;
  v_gross int;
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

    select count(*) filter (where is_active),
           count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('QF')),
           count(*) filter (where is_active and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('F')),
           count(*) filter (where is_active and reached_round = 'W'),
           count(*) filter (where is_active and tier in ('C','D') and public.tour_manager_round_order(reached_round) >= public.tour_manager_round_order('SF')),
           coalesce(sum(earned_points), 0)
    into v_contract_count, v_qf_count, v_finalists, v_champions, v_jewels, v_gross
    from public.tour_manager_lineup_players
    where lineup_id = v_lineup.id;

    v_bonus := 0;
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
          'gross', v_gross,
          'qf_count', v_qf_count,
          'contract_count', v_contract_count,
          'finalists', v_finalists,
          'champions', v_champions,
          'jewels', v_jewels
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
    select m.*, e.level
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

      if v_player_key = v_match.winner_key then
        v_reached := public.tour_manager_next_round_key(v_match.round_key);
        v_is_final := v_reached = 'W';
      else
        v_reached := v_match.round_key;
        v_is_final := true;
      end if;

      v_target_points := public.tour_manager_round_points(v_match.tour, v_match.level, v_reached);

      for v_contract in
        select lp.*, l.user_id, l.season, l.station_key
        from public.tour_manager_lineup_players lp
        join public.tour_manager_lineups l on l.id = lp.lineup_id
        where l.station_key = p_station_key
          and l.season = p_season
          and l.status in ('submitted','locked','settling','settled')
          and lp.event_key = v_match.event_key
          and lp.player_key = v_player_key
          and (v_match.scheduled_at is null or lp.created_at <= v_match.scheduled_at)
          and (lp.replaced_at is null or v_match.scheduled_at is null or v_match.scheduled_at < lp.replaced_at)
      loop
        if public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(v_contract.reached_round) then
          update public.tour_manager_lineup_players
          set reached_round = v_reached,
              metadata = metadata || jsonb_build_object(
                'last_settled_match_key', v_match.match_key,
                'last_settled_round', v_match.round_key,
                'is_eliminated', v_is_final and v_reached <> 'W'
              )
          where id = v_contract.id;
        end if;

        v_delta := greatest(v_target_points - coalesce(v_contract.earned_points, 0), 0);
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
            'scheduled_at', v_match.scheduled_at
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
            'is_final', v_is_final
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

revoke all on function public.tour_manager_apply_pre_r1_substitution(text, text, text, text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_pre_r1_substitution(text, text, text, text) to service_role;

revoke all on function public.tour_manager_apply_station_combo(text, int) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_station_combo(text, int) to service_role;

revoke all on function public.tour_manager_settle_completed_matches(text, int, date) from public, anon, authenticated;
grant execute on function public.tour_manager_settle_completed_matches(text, int, date) to service_role;

grant execute on function public.tour_manager_submit_lineup(text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text) to authenticated;
grant execute on function public.tour_manager_transfer_player(uuid, uuid, jsonb, numeric) to authenticated;
