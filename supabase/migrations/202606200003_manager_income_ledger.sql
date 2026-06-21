-- Make manager income records production-readable:
-- every wallet/bootstrap and lineup submit action writes a Chinese ledger row
-- with enough metadata for the "我的收益" table.

create or replace function public.tour_manager_bootstrap_wallet(p_season int default 2026)
returns public.tour_manager_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  insert into public.tour_manager_wallets (user_id, season, balance)
  values (v_user, p_season, 300)
  on conflict (user_id, season) do nothing;

  select * into v_wallet
  from public.tour_manager_wallets
  where user_id = v_user and season = p_season;

  insert into public.tour_manager_wallet_ledger (
    user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
  )
  select
    v_user,
    p_season,
    null,
    null,
    'season_opening',
    300,
    300,
    '新赛季开户',
    jsonb_build_object('bonus', 300, 'net', 300, 'season', p_season)
  where not exists (
    select 1
    from public.tour_manager_wallet_ledger
    where user_id = v_user
      and season = p_season
      and type = 'season_opening'
  );

  return v_wallet;
end;
$$;

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
    greatest(p_station_grant, 0), v_balance, '本站签约金发放',
    jsonb_build_object(
      'cost', 0,
      'gross', 0,
      'bonus', greatest(p_station_grant, 0),
      'net', greatest(p_station_grant, 0),
      'station_grant', greatest(p_station_grant, 0),
      'station_grant_used', v_station_used,
      'wallet_used', v_wallet_used,
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
      'players', v_players
    )
  );

  return public.tour_manager_get_my_state(p_station_key, p_season);
end;
$$;

grant execute on function public.tour_manager_bootstrap_wallet(int) to authenticated;
grant execute on function public.tour_manager_submit_lineup(text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text) to authenticated;
