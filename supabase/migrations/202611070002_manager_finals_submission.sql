begin;
create or replace function public.tour_manager_submit_finals_lineup(
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
  v_finals_elite boolean;
  v_count int;
  v_found int;
  v_original_cost int;
  v_payable_cost int;
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
  v_combo_version text;
  v_combo jsonb := '{}'::jsonb;
  v_welfare jsonb := '{}'::jsonb;
  v_welfare_principal_max int := 500;
  v_welfare_min_players int := 3;
  v_welfare_rate numeric := 0.20;
  v_welfare_cap int := 300;
  v_welfare_max_uses int := 3;
  v_welfare_uses int := 0;
  v_welfare_use_number int;
  v_welfare_discount int := 0;
  v_village_selection text;
  v_village_hope_player_key text;
  v_village_hope_player_name text;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if p_contracts is null or jsonb_typeof(p_contracts) <> 'array' then
    raise exception 'contracts_must_be_array';
  end if;

  if p_station_key <> '2026-w46-wta-finals' or p_season <> 2026 then raise exception 'invalid_finals_station'; end if;
  select exists(select 1 from public.tour_manager_finals_eligibility where user_id=v_user and season=p_season and station_key=p_station_key) into v_finals_elite;
  v_rules := jsonb_build_object('station_grant',0,'min_players',1,'max_players',2,'transfer_fee_rate',0);
  v_station_grant := (v_rules->>'station_grant')::int;
  v_min_players := (v_rules->>'min_players')::int;
  v_max_players := (v_rules->>'max_players')::int;
  v_transfer_fee_rate := (v_rules->>'transfer_fee_rate')::numeric;

  select combo_version, coalesce(metadata->'combo', '{}'::jsonb)
  into v_combo_version, v_combo
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;

  -- Finals never inherit welfare or Combo from a stale station configuration.
  v_combo := '{}'::jsonb;

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
  select count(*), coalesce(sum((case when v_finals_elite then 0 else 1000 end)), 0)::int
  into v_found, v_original_cost
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

  -- Opening this station must never mint principal, even for a first-time account.
  insert into public.tour_manager_wallets(user_id,season,balance)
  values(v_user,p_season,0) on conflict(user_id,season) do nothing;
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

  if jsonb_typeof(v_combo->'welfare') = 'object' then
    v_welfare := coalesce(v_combo->'welfare', '{}'::jsonb);
    v_welfare_principal_max := coalesce((v_welfare->>'principal_max')::int, 500);
    v_welfare_min_players := coalesce((v_welfare->>'min_players')::int, 3);
    v_welfare_rate := coalesce((v_welfare->>'discount_rate')::numeric, 0.20);
    v_welfare_cap := coalesce((v_welfare->>'cap')::int, 300);
    v_welfare_max_uses := coalesce((v_welfare->>'max_uses_per_season')::int, 3);

    select count(*)::int
    into v_welfare_uses
    from public.tour_manager_lineups
    where user_id = v_user
      and season = p_season
      and submitted_at >= make_timestamptz(p_season, 1, 1, 0, 0, 0, 'UTC')
      and submitted_at < make_timestamptz(p_season + 1, 1, 1, 0, 0, 0, 'UTC')
      and welfare_discount > 0;

    if v_balance <= v_welfare_principal_max
       and v_count >= v_welfare_min_players
       and v_welfare_uses < v_welfare_max_uses then
      v_welfare_discount := least(
        greatest(v_welfare_cap, 0),
        round(v_original_cost * greatest(v_welfare_rate, 0))::int
      );
      v_welfare_use_number := v_welfare_uses + 1;
    end if;
  end if;

  v_payable_cost := greatest(v_original_cost - v_welfare_discount, 0);
  v_station_used := least(v_payable_cost, greatest(v_station_grant, 0));
  v_wallet_used := greatest(v_payable_cost - greatest(v_station_grant, 0), 0);

  if v_balance + greatest(v_station_grant, 0) < v_payable_cost then
    raise exception 'insufficient_budget';
  end if;

  v_village_selection := coalesce(v_combo #>> '{village_hope,selection}', '');
  if v_village_selection = 'highest_original_price_at_submission' then
    with req as (
      select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
      from jsonb_array_elements(p_contracts) x
    )
    select ep.player_key, coalesce(nullif(ep.name_zh, ''), nullif(ep.name_en, ''), ep.player_key)
    into v_village_hope_player_key, v_village_hope_player_name
    from req
    join public.tour_manager_event_players ep
      on ep.event_key = req.event_key and ep.player_key = req.player_key
    order by (case when v_finals_elite then 0 else 1000 end) desc, ep.player_key
    limit 1;
  end if;

  insert into public.tour_manager_lineups (
    user_id, season, station_key, status, lineup_cost, original_lineup_cost,
    welfare_discount, welfare_principal_at_submit, welfare_discount_rate,
    welfare_use_number, village_hope_player_key, village_hope_player_name,
    station_grant, station_grant_used, wallet_used, min_players, max_players,
    max_transfers, transfer_fee_rate, predictions, submission_bonus,
    predicted_gross, predicted_bonus, predicted_net, lineup_style
  )
  values (
    v_user, p_season, p_station_key, 'submitted', v_payable_cost, v_original_cost,
    v_welfare_discount, case when v_welfare_discount > 0 then v_balance else null end,
    case when v_welfare_discount > 0 then v_welfare_rate else null end,
    v_welfare_use_number, v_village_hope_player_key, v_village_hope_player_name,
    v_station_grant, v_station_used, v_wallet_used, v_min_players, v_max_players,
    0, v_transfer_fee_rate, coalesce(p_predictions, '{}'::jsonb), 0,
    coalesce(p_predicted_gross, 0), coalesce(p_predicted_bonus, 0),
    coalesce(p_predicted_net, 0), p_lineup_style
  )
  returning id into v_lineup_id;

  insert into public.tour_manager_lineup_players (
    lineup_id, event_key, player_key, tour, name_zh, name_en, price, tier,
    predicted_round, metadata
  )
  select
    v_lineup_id, ep.event_key, ep.player_key, ep.tour, ep.name_zh, ep.name_en, (case when v_finals_elite then 0 else 1000 end),
    public.tour_manager_price_tier((case when v_finals_elite then 0 else 1000 end), ep.tour, e.level),
    coalesce(p_predictions->>ep.player_key, 'OUT'),
    to_jsonb(ep) || jsonb_build_object(
      'client_prediction', coalesce(p_predictions->>ep.player_key, 'OUT'),
      'level', e.level,
      'finals_elite',v_finals_elite,
      'finals_rules_version','2026-v1',
      'original_price', (case when v_finals_elite then 0 else 1000 end),
      'is_village_hope', ep.player_key = v_village_hope_player_key
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

  update public.tour_manager_wallets
  set balance = balance - v_wallet_used
  where user_id = v_user and season = p_season
  returning balance into v_balance;

  if v_wallet_used > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after,
      description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup_id, 'lineup_wallet_spend',
      -v_wallet_used, v_balance, '提交阵容占用经纪人钱包',
      jsonb_build_object(
        'cost', v_payable_cost,
        'gross', coalesce(p_predicted_gross, 0),
        'bonus', coalesce(p_predicted_bonus, 0),
        'net', -v_wallet_used,
        'original_lineup_cost', v_original_cost,
        'lineup_cost', v_payable_cost,
        'welfare_discount', v_welfare_discount,
        'welfare_principal_at_submit', null,
        'welfare_use_number', v_welfare_use_number,
        'village_hope_player_key', v_village_hope_player_key,
        'village_hope_player_name', v_village_hope_player_name,
        'station_grant_used', v_station_used,
        'wallet_used', v_wallet_used,
        'rules', v_rules,
        'players', v_players
      )
    );
  end if;

  return public.tour_manager_get_my_state(p_station_key, p_season);

end;
$$;

revoke all on function public.tour_manager_submit_finals_lineup(text,int,int,int,int,numeric,jsonb,jsonb,int,int,int,text) from public,anon;
grant execute on function public.tour_manager_submit_finals_lineup(text,int,int,int,int,numeric,jsonb,jsonb,int,int,int,text) to authenticated;
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.tour_manager_submit_lineup(text,integer,integer,integer,integer,numeric,jsonb,jsonb,integer,integer,integer,text)'::regprocedure);
 if position('return public.tour_manager_submit_finals_lineup' in d)=0 then
  if position(E'begin\n' in d)=0 then raise exception 'unexpected_submit_function';end if;
  d:=regexp_replace(d,E'begin\n',E'begin\n  if p_station_key = ''2026-w46-wta-finals'' then\n    return public.tour_manager_submit_finals_lineup(p_station_key,p_season,p_station_grant,p_min_players,p_max_players,p_transfer_fee_rate,p_contracts,p_predictions,p_predicted_gross,p_predicted_bonus,p_predicted_net,p_lineup_style);\n  end if;\n');
  execute d;
 end if;
 d:=pg_get_functiondef('public.tour_manager_settle_completed_matches(text,integer,date)'::regprocedure);
 if position('return public.tour_manager_settle_finals' in d)=0 then
  if position(E'begin\n' in d)=0 then raise exception 'unexpected_settlement_function';end if;
  d:=regexp_replace(d,E'begin\n',E'begin\n  if p_station_key = ''2026-w46-wta-finals'' then\n    return public.tour_manager_settle_finals(p_station_key,p_season,p_settled_for_date);\n  end if;\n');
  execute d;
 end if;
end;
$patch$;

commit;

