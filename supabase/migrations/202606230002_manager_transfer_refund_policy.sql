-- 巡回赛经纪人：换人退费与换入球员基准分。
-- 未出局退回 70% 原成本；已出局不退。
-- 换入前已取得的轮次只作为结算基准，不追发此前收益。

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
         public.tour_manager_round_points(v_in.tour, v_event.level, s.reached_round)
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
           public.tour_manager_round_points(v_in.tour, v_event.level, s.reached_round) desc,
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
      'level', v_event.level,
      'transfer_baseline_round', v_baseline_round,
      'transfer_baseline_points', v_baseline_points
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
  v_is_bye_first_match boolean;
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
        v_is_bye_first_match :=
          upper(coalesce(v_contract.first_round, '')) = 'BYE'
          and coalesce(v_contract.earned_points, 0) = 0
          and v_baseline_points = 0
          and public.tour_manager_round_order(v_match.round_key) > public.tour_manager_round_order(v_first_round_key);

        if v_player_key = v_match.winner_key then
          v_reached := public.tour_manager_next_round_key(v_match.round_key);
          v_is_final := v_reached = 'W';
        else
          v_reached := case
            when v_is_bye_first_match then v_first_round_key
            else v_match.round_key
          end;
          v_is_final := true;
        end if;

        v_target_points := public.tour_manager_round_points(v_match.tour, v_match.level, v_reached);

        if public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(v_contract.reached_round) then
          update public.tour_manager_lineup_players
          set reached_round = v_reached,
              metadata = metadata || jsonb_build_object(
                'last_settled_match_key', v_match.match_key,
                'last_settled_round', v_match.round_key,
                'is_eliminated', v_is_final and v_reached <> 'W',
                'first_round_key', v_first_round_key,
                'bye_first_match_adjusted', v_is_bye_first_match and v_player_key <> v_match.winner_key
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
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'bye_first_match_adjusted', v_is_bye_first_match and v_player_key <> v_match.winner_key
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
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'bye_first_match_adjusted', v_is_bye_first_match and v_player_key <> v_match.winner_key
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
