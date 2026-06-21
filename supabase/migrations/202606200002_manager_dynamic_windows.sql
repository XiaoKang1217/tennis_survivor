-- 巡回赛经纪人：动态提交截止、动态换人窗口、R1 前退赛替补。

alter table public.tour_manager_events
  add column if not exists schedule_status text not null default 'pending'
    check (schedule_status in ('pending','partial','confirmed','final')),
  add column if not exists main_draw_first_match_at timestamptz,
  add column if not exists submission_cutoff_at timestamptz,
  add column if not exists round1_completed_at timestamptz,
  add column if not exists round2_first_match_at timestamptz,
  add column if not exists transfer_window_opens_at timestamptz,
  add column if not exists transfer_window_closes_at timestamptz,
  add column if not exists transfer_window_note text;

create table if not exists public.tour_manager_player_substitutions (
  id uuid primary key default gen_random_uuid(),
  station_key text not null,
  event_key text not null references public.tour_manager_events(event_key) on delete cascade,
  out_player_key text not null,
  in_player_key text not null,
  reason text not null default 'pre_r1_withdrawal'
    check (reason in ('pre_r1_withdrawal','lucky_loser','alternate','manual_correction')),
  effective_at timestamptz not null default now(),
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_key, out_player_key)
);

alter table public.tour_manager_player_substitutions enable row level security;

drop policy if exists "tour_manager_player_substitutions_read" on public.tour_manager_player_substitutions;
create policy "tour_manager_player_substitutions_read"
on public.tour_manager_player_substitutions
for select
using (true);

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
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if p_contracts is null or jsonb_typeof(p_contracts) <> 'array' then
    raise exception 'contracts_must_be_array';
  end if;

  select count(*) into v_count
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req;

  if v_count <> jsonb_array_length(p_contracts) then
    raise exception 'duplicate_contract_player';
  end if;
  if v_count < p_min_players or v_count > p_max_players then
    raise exception 'invalid_lineup_size';
  end if;

  with req as (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  )
  select count(*), coalesce(sum(ep.price), 0)
  into v_found, v_cost
  from req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key
  join public.tour_manager_events e
    on e.event_key = ep.event_key
  where e.market_status = 'open'
    and e.station_key = p_station_key
    and (e.submission_opens_at is null or now() >= e.submission_opens_at)
    and (coalesce(e.submission_cutoff_at, e.submission_closes_at) is null
      or now() <= coalesce(e.submission_cutoff_at, e.submission_closes_at));

  if v_found <> v_count then
    raise exception 'invalid_or_closed_contract_player';
  end if;

  v_station_used := least(v_cost, greatest(p_station_grant, 0));
  v_wallet_used := greatest(v_cost - greatest(p_station_grant, 0), 0);

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
  if v_balance + greatest(p_station_grant, 0) < v_cost then
    raise exception 'insufficient_budget';
  end if;

  insert into public.tour_manager_lineups (
    user_id, season, station_key, status, lineup_cost, station_grant,
    station_grant_used, wallet_used, min_players, max_players,
    max_transfers, transfer_fee_rate, predictions,
    predicted_gross, predicted_bonus, predicted_net, lineup_style
  )
  values (
    v_user, p_season, p_station_key, 'submitted', v_cost, p_station_grant,
    v_station_used, v_wallet_used, p_min_players, p_max_players,
    1, coalesce(p_transfer_fee_rate, 0.10), coalesce(p_predictions, '{}'::jsonb),
    coalesce(p_predicted_gross, 0), coalesce(p_predicted_bonus, 0),
    coalesce(p_predicted_net, 0), p_lineup_style
  )
  returning id into v_lineup_id;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier, predicted_round, metadata
  )
  select
    v_lineup_id, ep.event_key, ep.player_key, ep.tour, ep.name_zh, ep.name_en, ep.price,
    case when ep.price >= 300 then 'S' when ep.price >= 195 then 'B' when ep.price >= 90 then 'C' else 'D' end,
    coalesce(p_predictions->>ep.player_key, 'OUT'),
    to_jsonb(ep) || jsonb_build_object('client_prediction', coalesce(p_predictions->>ep.player_key, 'OUT'))
  from (
    select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
    from jsonb_array_elements(p_contracts) x
  ) req
  join public.tour_manager_event_players ep
    on ep.event_key = req.event_key and ep.player_key = req.player_key;

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
      jsonb_build_object('lineup_cost', v_cost, 'station_grant_used', v_station_used)
    );
  end if;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  values (
    v_user, p_season, p_station_key, v_lineup_id, 'submit_bonus',
    10, v_balance, '提交阵容奖励', jsonb_build_object('lineup_cost', v_cost)
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
  v_fee := ceil(v_new_price * coalesce(p_fee_rate, v_lineup.transfer_fee_rate));
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
    case when v_in.price >= 300 then 'S' when v_in.price >= 195 then 'B' when v_in.price >= 90 then 'C' else 'D' end,
    coalesce(p_in_contract->>'predicted_round', 'OUT'),
    true,
    to_jsonb(v_in) || jsonb_build_object('client_prediction', coalesce(p_in_contract->>'predicted_round', 'OUT'))
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
  select * into v_event
  from public.tour_manager_events
  where event_key = p_event_key;
  if v_event.event_key is null then
    raise exception 'event_not_found';
  end if;
  if v_event.main_draw_first_match_at is not null and now() >= v_event.main_draw_first_match_at then
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
