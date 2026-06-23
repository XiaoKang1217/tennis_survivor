-- 巡回赛经纪人：换人退费按换下球员是否已出局判断。
-- 未出局退回 70% 原成本；已出局不退。

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

  v_new_price := v_in.price;
  if v_new_price <= 0 then
    raise exception 'invalid_new_contract';
  end if;

  v_refund := case when v_out_eliminated then 0 else round(v_out.price * 0.70) end;
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
      'refund_policy', case when v_out_eliminated then 'eliminated_no_refund' else 'active_70_percent' end,
      'out_player_eliminated', v_out_eliminated,
      'sunk_loss', v_out.price - v_refund,
      'fee', v_fee,
      'new_price', v_new_price,
      'fee_rate', v_lineup.transfer_fee_rate,
      'event_key', v_event.event_key,
      'tour', v_event.tour,
      'window_opens_at', v_open,
      'window_closes_at', v_close
    )
  );

  return public.tour_manager_get_my_state(v_lineup.station_key, v_lineup.season);
end;
$$;

revoke all on function public.tour_manager_transfer_player(uuid, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.tour_manager_transfer_player(uuid, uuid, jsonb, numeric) to authenticated;
