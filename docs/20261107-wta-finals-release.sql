-- WTA Finals 2026: execute the whole document once in Supabase SQL Editor.
-- Idempotent; existing wallets and historical results are not rewritten.
begin;
-- WTA Finals contracts settle cumulative entitlement, never single-elimination points.

create table if not exists public.tour_manager_finals_eligibility (
  season integer not null,
  station_key text not null,
  user_id uuid not null references auth.users(id),
  primary key(season,station_key,user_id)
);
alter table public.tour_manager_finals_eligibility enable row level security;
revoke all on public.tour_manager_finals_eligibility from anon,authenticated;
insert into public.tour_manager_finals_eligibility
select 2026,'2026-w46-wta-finals',id::uuid from unnest(array[
 'bad496ad-cc92-4b37-9551-9b0e46ae9d6a','57722850-cc58-4170-a35f-cf49b06973f0',
 '779ad00f-bf61-428f-8432-9ec77eac5e32','ac710eeb-7d3c-49db-a812-f335b2961748',
 'fb7a0362-a328-4608-8ed8-c3b08d280ebf','64a68075-a621-493f-a20e-753dfbb2f6f1',
 '14c1f112-365e-4b35-b1ac-a510b08fb006','c7900a26-4501-43b4-98d8-b63e5ec43076']) id
on conflict do nothing;

create or replace function public.tour_manager_finals_entitlement(p_wins integer,p_stage text,p_elite boolean)
returns integer language plpgsql immutable set search_path=public as $$
begin
  if p_wins is null or p_wins not between 0 and 3 or p_stage is null or p_stage not in ('RR','SF','F','W') or p_elite is null then
    raise exception 'invalid_finals_result';
  end if;
  return p_wins*(case when p_elite then 250 else 200 end)
    +case when p_stage in ('SF','F','W') then case when p_elite then 1500 else 1000 end else 0 end
    +case when p_stage in ('F','W') then case when p_elite then 3000 else 2000 end else 0 end
    +case when p_stage='W' then case when p_elite then 6000 else 4000 end else 0 end;
end;
$$;

create table if not exists public.tour_manager_finals_progress (
  season integer not null,
  station_key text not null,
  event_key text not null,
  player_key text not null,
  rr_wins integer not null check(rr_wins between 0 and 3),
  stage text not null check(stage in ('RR','SF','F','W')),
  eliminated boolean not null default false,
  source jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(season,station_key,event_key,player_key)
);
alter table public.tour_manager_finals_progress enable row level security;
revoke all on public.tour_manager_finals_progress from anon,authenticated;
grant all on public.tour_manager_finals_progress to service_role;

create or replace function public.tour_manager_settle_finals(p_station_key text,p_season integer,p_settled_for_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; target integer; delta integer; balance_now integer; total integer:=0; count_paid integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'admin_required';end if;
  if p_station_key<>'2026-w46-wta-finals' or p_season<>2026 then raise exception 'invalid_finals_station';end if;
  perform pg_advisory_xact_lock(hashtext(p_station_key),p_season);
  for c in
    select lp.id,lp.lineup_id,lp.event_key,lp.player_key,lp.name_zh,lp.price,lp.earned_points,lp.metadata,
      l.user_id,r.rr_wins,r.stage,r.eliminated,r.source
    from public.tour_manager_lineup_players lp
    join public.tour_manager_lineups l on l.id=lp.lineup_id
    join public.tour_manager_finals_progress r on r.event_key=lp.event_key and r.player_key=lp.player_key
      and r.station_key=l.station_key and r.season=l.season
    where l.station_key=p_station_key and l.season=p_season and l.status<>'cancelled' and lp.is_active
    order by l.user_id,lp.id for update of lp,l
  loop
    if not(c.metadata ? 'finals_elite') then raise exception 'missing_frozen_finals_eligibility';end if;
    target:=public.tour_manager_finals_entitlement(c.rr_wins,c.stage,(c.metadata->>'finals_elite')::boolean);
    delta:=target-coalesce(c.earned_points,0);
    if delta<0 then raise exception 'finals_result_correction_requires_review';end if;
    update public.tour_manager_lineup_players set reached_round=c.stage,
      metadata=metadata||jsonb_build_object('finals_eliminated',c.eliminated,'rr_wins',c.rr_wins) where id=c.id;
    if delta=0 then continue;end if;
    insert into public.tour_manager_settlements(lineup_id,contract_id,user_id,event_key,player_key,round_key,points_delta,is_final,source,settled_for_date)
    values(c.lineup_id,c.id,c.user_id,c.event_key,c.player_key,'FINALS:RR'||c.rr_wins||':'||c.stage,delta,c.stage='W',
      c.source||jsonb_build_object('rr_wins',c.rr_wins,'stage',c.stage,'target_points',target),p_settled_for_date);
    update public.tour_manager_wallets set balance=balance+delta,updated_at=now()
      where user_id=c.user_id and season=p_season returning balance into balance_now;
    if not found then raise exception 'missing_wallet';end if;
    update public.tour_manager_lineup_players set earned_points=target where id=c.id;
    insert into public.tour_manager_wallet_ledger(user_id,season,station_key,lineup_id,type,amount,balance_after,description,metadata)
    values(c.user_id,p_season,p_station_key,c.lineup_id,'player_points_delta',delta,balance_now,'年终每日收益结算',
      jsonb_build_object('settled_for_date',p_settled_for_date,'event_key',c.event_key,'contract_id',c.id,'player_key',c.player_key,'name',c.name_zh,
       'rr_wins',c.rr_wins,'reached_round',c.stage,'target_points',target,'already_earned_points',c.earned_points,
       'gross',delta,'cost',0,'bonus',0,'net',delta,'source',c.source,
       'players',jsonb_build_array(jsonb_build_object('player_key',c.player_key,'name',c.name_zh,'price',c.price))));
    total:=total+delta;count_paid:=count_paid+1;
  end loop;
  if exists(select 1 from public.tour_manager_finals_progress where station_key=p_station_key and season=p_season and stage='W') then
    update public.tour_manager_events set market_status='settled' where station_key=p_station_key and season=p_season;
  end if;
  return jsonb_build_object('settlements',count_paid,'points_delta',total,'combo_lineups',0,'event_count',1,
    'finals_completed',(select count(*) from public.tour_manager_finals_progress where station_key=p_station_key and season=p_season and stage='W'));
end;
$$;
revoke all on function public.tour_manager_settle_finals(text,integer,date) from public,anon,authenticated;
grant execute on function public.tour_manager_settle_finals(text,integer,date) to service_role;


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



alter table public.tour_manager_events drop constraint if exists tour_manager_events_level_check;
alter table public.tour_manager_events add constraint tour_manager_events_level_check check(level in ('250','500','1000','GS','FINALS'));

alter table public.tour_manager_daily_prediction_games add column if not exists game_slot integer not null default 1 check(game_slot between 1 and 2);
drop index if exists public.tour_manager_prediction_group_once_idx;
alter table public.tour_manager_daily_prediction_games drop column if exists selection_group;
alter table public.tour_manager_daily_prediction_games add column selection_group text generated always as (
 case when station_key='2026-w39-seoul-singapore' then event_key
 when station_key='2026-w46-wta-finals' then tour||':'||game_slot::text else tour end
) stored;
create unique index tour_manager_prediction_group_once_idx on public.tour_manager_daily_prediction_games(station_key,contest_date,selection_group);

create or replace function public.tour_manager_take_finals_opening_notice()
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); inserted uuid;
begin
 if u is null then raise exception 'authentication_required';end if;
 if now() >= timestamptz '2026-11-09 04:00:00+08'
 or not exists(select 1 from public.tour_manager_station_configs where station_key='2026-w46-wta-finals' and season=2026) then return null;end if;
 insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
 values(u,'wta_finals_2026_opening') on conflict do nothing returning user_id into inserted;
 if inserted is null then return null;end if;
 return jsonb_build_object('message','经纪人WTA年终开售！累计收益前八免费，最高毛收益可达16500；普通用户最高毛收益可达11200，快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_finals_opening_notice() from public,anon;
grant execute on function public.tour_manager_take_finals_opening_notice() to authenticated;

do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.tour_manager_station_rules(text,integer)'::regprocedure);
 if position('finals_2026_fixed' in d)=0 then
  if position(E'begin\n' in d)=0 then raise exception 'unexpected_station_rules_function';end if;
  d:=regexp_replace(d,E'begin\n',E'begin\n if p_station_key=''2026-w46-wta-finals'' and p_season=2026 then return jsonb_build_object(''station_grant'',0,''min_players'',1,''max_players'',2,''transfer_fee_rate'',0,''max_transfers'',0,''combo_version'',''finals_2026_fixed'');end if;\n');
  execute d;
 end if;
 d:=pg_get_functiondef('public.tour_manager_get_my_state(text,integer)'::regprocedure);
 if position('finals_no_opening_grant' in d)=0 then
  if position(E'begin\n' in d)=0 then raise exception 'unexpected_get_state_function';end if;
  d:=regexp_replace(d,E'begin\n',E'begin\n -- finals_no_opening_grant: retain existing wallets, initialise missing ones without a gift.\n if p_station_key=''2026-w46-wta-finals'' and p_season=2026 and auth.uid() is not null then\n insert into public.tour_manager_wallets(user_id,season,balance) values(auth.uid(),p_season,0) on conflict(user_id,season) do nothing;\n end if;\n');
  execute d;
 end if;
 d:=pg_get_functiondef('public.tour_manager_transfer_player(uuid,uuid,jsonb,numeric)'::regprocedure);
 if position('finals_transfer_not_allowed' in d)=0 then
  if position(E'begin\n' in d)=0 then raise exception 'unexpected_transfer_function';end if;
  d:=regexp_replace(d,E'begin\n',E'begin\n if exists(select 1 from public.tour_manager_lineups l join public.tour_manager_events e on e.station_key=l.station_key and e.season=l.season where l.id=p_lineup_id and l.user_id=auth.uid() and (e.level=''FINALS'' or e.metadata->>''format''=''round_robin'')) then raise exception ''finals_transfer_not_allowed'';end if;\n');
  execute d;
 end if;
end;
$patch$;
notify pgrst, 'reload schema';

-- Generated from the reviewed Finals configuration; does not change existing contracts or balances.

insert into public.tour_manager_station_configs(station_key,season,station_grant,combo_version,metadata)
select station_key,season,station_grant,combo_version,metadata from jsonb_populate_recordset(null::public.tour_manager_station_configs,'[{"station_key":"2026-w46-wta-finals","season":2026,"station_grant":0,"combo_version":"finals_2026","metadata":{"combo":{"total_cap":0},"finals":{"top8_user_ids":["bad496ad-cc92-4b37-9551-9b0e46ae9d6a","57722850-cc58-4170-a35f-cf49b06973f0","779ad00f-bf61-428f-8432-9ec77eac5e32","ac710eeb-7d3c-49db-a812-f335b2961748","fb7a0362-a328-4608-8ed8-c3b08d280ebf","64a68075-a621-493f-a20e-753dfbb2f6f1","14c1f112-365e-4b35-b1ac-a510b08fb006","c7900a26-4501-43b4-98d8-b63e5ec43076"],"ordinary":{"price":1000,"RR":200,"SF":1000,"F":2000,"W":4000},"top8":{"price":0,"RR":250,"SF":1500,"F":3000,"W":6000}},"roster":{"min_players":1,"max_players":2},"source":"data/manager/active_events.json"}}]'::jsonb)
on conflict(station_key,season) do update set station_grant=excluded.station_grant,combo_version=excluded.combo_version,metadata=excluded.metadata;
insert into public.tour_manager_events(event_key,season,station_key,tour,event_id,name,name_zh,level,surface,draw_size,start_date,end_date,draw_status,market_status,submission_opens_at,schedule_status,main_draw_first_match_at,submission_cutoff_at,submission_closes_at,round1_completed_at,round2_first_match_at,transfer_window_opens_at,transfer_window_closes_at,transfer_window_note,transfer_window_days,transfer_fee_rate,source_urls,metadata)
select event_key,season,station_key,tour,event_id,name,name_zh,level,surface,draw_size,start_date,end_date,draw_status,market_status,submission_opens_at,schedule_status,main_draw_first_match_at,submission_cutoff_at,submission_closes_at,round1_completed_at,round2_first_match_at,transfer_window_opens_at,transfer_window_closes_at,transfer_window_note,transfer_window_days,transfer_fee_rate,source_urls,metadata from jsonb_populate_recordset(null::public.tour_manager_events,'[{"event_key":"wta-2026-w46-finals","season":2026,"station_key":"2026-w46-wta-finals","tour":"WTA","event_id":"30808","name":"WTA Finals","name_zh":"印第安维尔斯","level":"FINALS","surface":"hard_in","draw_size":8,"start_date":"2026-11-08","end_date":"2026-11-15","draw_status":"published","market_status":"open","submission_opens_at":"2026-11-07T06:51:52.974Z","schedule_status":"pending","main_draw_first_match_at":"2026-11-09T04:00:00+08:00","submission_cutoff_at":"2026-11-09T04:00:00+08:00","submission_closes_at":"2026-11-09T04:00:00+08:00","round1_completed_at":null,"round2_first_match_at":null,"transfer_window_opens_at":null,"transfer_window_closes_at":null,"transfer_window_note":null,"transfer_window_days":2,"transfer_fee_rate":0.1,"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"metadata":{"station_key":"2026-w46-wta-finals","station_name":"WTA 印第安维尔斯","short_name":"印第安维尔斯","display_name":"WTA 年终（印第安维尔斯）","timezone":"America/Los_Angeles","format":"round_robin","cross_tour_transfer":false,"market_message":"","source_file":"events/wta-2026-w46-finals.json"}}]'::jsonb)
on conflict(event_key) do update set season=excluded.season,station_key=excluded.station_key,tour=excluded.tour,event_id=excluded.event_id,name=excluded.name,name_zh=excluded.name_zh,level=excluded.level,surface=excluded.surface,draw_size=excluded.draw_size,start_date=excluded.start_date,end_date=excluded.end_date,draw_status=excluded.draw_status,market_status=excluded.market_status,submission_opens_at=excluded.submission_opens_at,schedule_status=excluded.schedule_status,main_draw_first_match_at=excluded.main_draw_first_match_at,submission_cutoff_at=excluded.submission_cutoff_at,submission_closes_at=excluded.submission_closes_at,round1_completed_at=excluded.round1_completed_at,round2_first_match_at=excluded.round2_first_match_at,transfer_window_opens_at=excluded.transfer_window_opens_at,transfer_window_closes_at=excluded.transfer_window_closes_at,transfer_window_note=excluded.transfer_window_note,transfer_window_days=excluded.transfer_window_days,transfer_fee_rate=excluded.transfer_fee_rate,source_urls=excluded.source_urls,metadata=excluded.metadata;
insert into public.tour_manager_players(tour,player_key,name_en,name_zh,official_profile_id,official_profile_url,tennis_abstract_slug,country_code,photo_url,photo_source,photo_status,photo_storage_path,photo_updated_at,source)
select tour,player_key,name_en,name_zh,official_profile_id,official_profile_url,tennis_abstract_slug,country_code,photo_url,photo_source,photo_status,photo_storage_path,photo_updated_at,source from jsonb_populate_recordset(null::public.tour_manager_players,'[{"tour":"WTA","player_key":"WTA|elena-rybakina","name_en":"Elena RYBAKINA","name_zh":"雷巴金娜","official_profile_id":"324166","official_profile_url":"https://www.wtatennis.com/players/324166/elena-rybakina","tennis_abstract_slug":"ElenaRYBAKINA","country_code":null,"photo_url":"https://static.live-tennis.cn/pic/ts/324166","photo_source":"Live Tennis Wimbledon draw photo","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|elena-rybakina","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|coco-gauff","name_en":"Coco GAUFF","name_zh":"高芙","official_profile_id":"328560","official_profile_url":"https://www.wtatennis.com/players/328560/coco-gauff","tennis_abstract_slug":"CocoGAUFF","country_code":null,"photo_url":"https://static.live-tennis.cn/pic/ts/328560","photo_source":"Live Tennis Wimbledon draw photo","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|coco-gauff","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|jessica-pegula","name_en":"Jessica PEGULA","name_zh":"佩古拉","official_profile_id":"316956","official_profile_url":"https://www.wtatennis.com/players/316956/jessica-pegula","tennis_abstract_slug":"JessicaPEGULA","country_code":null,"photo_url":"https://static.live-tennis.cn/pic/ts/316956","photo_source":"Live Tennis Wimbledon draw photo","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|jessica-pegula","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|linda-noskova","name_en":"Linda NOSKOVA","name_zh":"诺斯科娃","official_profile_id":"329668","official_profile_url":"https://www.wtatennis.com/players/329668/linda-noskova","tennis_abstract_slug":"LindaNOSKOVA","country_code":null,"photo_url":"assets/manager/players/wta/wta-linda-noskova.jpg","photo_source":"Live Tennis WTA ranking photo","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-linda-noskova.jpg","photo_updated_at":"2026-06-20T17:23:13.488Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|linda-noskova","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|aryna-sabalenka","name_en":"Aryna SABALENKA","name_zh":"萨巴莲卡","official_profile_id":"320760","official_profile_url":"https://www.wtatennis.com/players/320760/aryna-sabalenka","tennis_abstract_slug":"ArynaSABALENKA","country_code":null,"photo_url":"https://static.live-tennis.cn/pic/ts/320760","photo_source":"Live Tennis Wimbledon draw photo","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|aryna-sabalenka","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|mirra-andreeva","name_en":"Mirra ANDREEVA","name_zh":"米-安德烈耶娃","official_profile_id":"331809","official_profile_url":"https://www.wtatennis.com/players/331809/mirra-andreeva","tennis_abstract_slug":"MirraANDREEVA","country_code":null,"photo_url":"assets/manager/players/wta/wta-mirra-andreeva.jpg","photo_source":"Live Tennis WTA ranking photo","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-mirra-andreeva.jpg","photo_updated_at":"2026-06-20T17:24:39.227Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|mirra-andreeva","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|elina-svitolina","name_en":"Elina SVITOLINA","name_zh":"斯维托丽娜","official_profile_id":"316738","official_profile_url":"https://www.wtatennis.com/players/316738/elina-svitolina","tennis_abstract_slug":"ElinaSVITOLINA","country_code":null,"photo_url":"assets/manager/players/wta/wta-elina-svitolina.jpg","photo_source":"Live Tennis WTA ranking photo","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-elina-svitolina.jpg","photo_updated_at":"2026-06-20T17:24:12.106Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|elina-svitolina","is_qualifier_placeholder":false,"pre_r1_substitution":null}},{"tour":"WTA","player_key":"WTA|karolina-muchova","name_en":"Karolina MUCHOVA","name_zh":"穆霍娃","official_profile_id":"322191","official_profile_url":"https://www.wtatennis.com/players/322191/karolina-muchova","tennis_abstract_slug":"KarolinaMUCHOVA","country_code":null,"photo_url":"assets/manager/players/wta/wta-karolina-muchova.jpg","photo_source":"Live Tennis WTA ranking photo","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-karolina-muchova.jpg","photo_updated_at":"2026-06-20T17:23:18.338Z","source":{"source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|karolina-muchova","is_qualifier_placeholder":false,"pre_r1_substitution":null}}]'::jsonb)
on conflict(tour,player_key) do update set name_en=excluded.name_en,name_zh=excluded.name_zh,official_profile_id=excluded.official_profile_id,official_profile_url=excluded.official_profile_url,tennis_abstract_slug=excluded.tennis_abstract_slug,country_code=excluded.country_code,photo_url=excluded.photo_url,photo_source=excluded.photo_source,photo_status=excluded.photo_status,photo_storage_path=excluded.photo_storage_path,photo_updated_at=excluded.photo_updated_at,source=excluded.source;
insert into public.tour_manager_event_players(event_key,player_key,tour,name_zh,name_en,profile_id,seed,ranking,draw_position,first_round,is_qualifier_placeholder,base_score,surface_score,draw_score,form_score,manual_score,price,photo_url,photo_status,photo_storage_path,photo_updated_at,source)
select event_key,player_key,tour,name_zh,name_en,profile_id,seed,ranking,draw_position,first_round,is_qualifier_placeholder,base_score,surface_score,draw_score,form_score,manual_score,price,photo_url,photo_status,photo_storage_path,photo_updated_at,source from jsonb_populate_recordset(null::public.tour_manager_event_players,'[{"event_key":"wta-2026-w46-finals","player_key":"WTA|elena-rybakina","tour":"WTA","name_zh":"雷巴金娜","name_en":"Elena RYBAKINA","profile_id":"324166","seed":null,"ranking":1,"draw_position":1,"first_round":"RR","is_qualifier_placeholder":false,"base_score":100,"surface_score":100,"draw_score":42.86,"form_score":94.34,"manual_score":0,"price":1000,"photo_url":"https://static.live-tennis.cn/pic/ts/324166","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"profile_id":"324166","profile_url":"https://www.wtatennis.com/players/324166/elena-rybakina","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|elena-rybakina","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2040.47,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|coco-gauff","tour":"WTA","name_zh":"高芙","name_en":"Coco GAUFF","profile_id":"328560","seed":null,"ranking":4,"draw_position":2,"first_round":"RR","is_qualifier_placeholder":false,"base_score":99.53,"surface_score":99.6,"draw_score":28.57,"form_score":77.7,"manual_score":0,"price":1000,"photo_url":"https://static.live-tennis.cn/pic/ts/328560","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"profile_id":"328560","profile_url":"https://www.wtatennis.com/players/328560/coco-gauff","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|coco-gauff","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2060.9,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|jessica-pegula","tour":"WTA","name_zh":"佩古拉","name_en":"Jessica PEGULA","profile_id":"316956","seed":null,"ranking":5,"draw_position":3,"first_round":"RR","is_qualifier_placeholder":false,"base_score":99.34,"surface_score":99.4,"draw_score":14.29,"form_score":97.39,"manual_score":0,"price":1000,"photo_url":"https://static.live-tennis.cn/pic/ts/316956","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"profile_id":"316956","profile_url":"https://www.wtatennis.com/players/316956/jessica-pegula","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|jessica-pegula","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2068.97,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|linda-noskova","tour":"WTA","name_zh":"诺斯科娃","name_en":"Linda NOSKOVA","profile_id":"329668","seed":null,"ranking":8,"draw_position":4,"first_round":"RR","is_qualifier_placeholder":false,"base_score":98.87,"surface_score":98.91,"draw_score":0,"form_score":98.08,"manual_score":0,"price":1000,"photo_url":"assets/manager/players/wta/wta-linda-noskova.jpg","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-linda-noskova.jpg","photo_updated_at":"2026-06-20T17:23:13.488Z","source":{"profile_id":"329668","profile_url":"https://www.wtatennis.com/players/329668/linda-noskova","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|linda-noskova","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2094.17,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|aryna-sabalenka","tour":"WTA","name_zh":"萨巴莲卡","name_en":"Aryna SABALENKA","profile_id":"320760","seed":null,"ranking":2,"draw_position":5,"first_round":"RR","is_qualifier_placeholder":false,"base_score":99.8,"surface_score":99.8,"draw_score":100,"form_score":92.14,"manual_score":0,"price":1000,"photo_url":"https://static.live-tennis.cn/pic/ts/320760","photo_status":"ready","photo_storage_path":null,"photo_updated_at":"2026-06-26T18:45:00.000Z","source":{"profile_id":"320760","profile_url":"https://www.wtatennis.com/players/320760/aryna-sabalenka","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|aryna-sabalenka","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":1961.3,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|mirra-andreeva","tour":"WTA","name_zh":"米-安德烈耶娃","name_en":"Mirra ANDREEVA","profile_id":"331809","seed":null,"ranking":3,"draw_position":6,"first_round":"RR","is_qualifier_placeholder":false,"base_score":99.09,"surface_score":98.91,"draw_score":85.71,"form_score":83.67,"manual_score":0,"price":1000,"photo_url":"assets/manager/players/wta/wta-mirra-andreeva.jpg","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-mirra-andreeva.jpg","photo_updated_at":"2026-06-20T17:24:39.227Z","source":{"profile_id":"331809","profile_url":"https://www.wtatennis.com/players/331809/mirra-andreeva","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|mirra-andreeva","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2012.9,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|elina-svitolina","tour":"WTA","name_zh":"斯维托丽娜","name_en":"Elina SVITOLINA","profile_id":"316738","seed":null,"ranking":6,"draw_position":7,"first_round":"RR","is_qualifier_placeholder":false,"base_score":98.75,"surface_score":98.41,"draw_score":71.43,"form_score":66.91,"manual_score":0,"price":1000,"photo_url":"assets/manager/players/wta/wta-elina-svitolina.jpg","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-elina-svitolina.jpg","photo_updated_at":"2026-06-20T17:24:12.106Z","source":{"profile_id":"316738","profile_url":"https://www.wtatennis.com/players/316738/elina-svitolina","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|elina-svitolina","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2018.17,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}},{"event_key":"wta-2026-w46-finals","player_key":"WTA|karolina-muchova","tour":"WTA","name_zh":"穆霍娃","name_en":"Karolina MUCHOVA","profile_id":"322191","seed":null,"ranking":7,"draw_position":8,"first_round":"RR","is_qualifier_placeholder":false,"base_score":98.16,"surface_score":97.82,"draw_score":57.14,"form_score":92.9,"manual_score":0,"price":1000,"photo_url":"assets/manager/players/wta/wta-karolina-muchova.jpg","photo_status":"ready","photo_storage_path":"assets/manager/players/wta/wta-karolina-muchova.jpg","photo_updated_at":"2026-06-20T17:23:18.338Z","source":{"profile_id":"322191","profile_url":"https://www.wtatennis.com/players/322191/karolina-muchova","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","source_urls":["https://www.live-tennis.cn/zh/draw/30808/2026"],"source_file_player_key":"WTA|karolina-muchova","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2028.33,"price_independent_of_scores":true},"pre_r1_substitution":null,"contract_price_policy":null,"original_contract_price":null}}]'::jsonb)
on conflict(event_key,player_key) do update set tour=excluded.tour,name_zh=excluded.name_zh,name_en=excluded.name_en,profile_id=excluded.profile_id,seed=excluded.seed,ranking=excluded.ranking,draw_position=excluded.draw_position,first_round=excluded.first_round,is_qualifier_placeholder=excluded.is_qualifier_placeholder,base_score=excluded.base_score,surface_score=excluded.surface_score,draw_score=excluded.draw_score,form_score=excluded.form_score,manual_score=excluded.manual_score,price=excluded.price,photo_url=excluded.photo_url,photo_status=excluded.photo_status,photo_storage_path=excluded.photo_storage_path,photo_updated_at=excluded.photo_updated_at,source=excluded.source;
insert into public.tour_manager_draw_entries(event_key,draw_version,draw_position,tour,player_key,placeholder_key,name_en,name_zh,seed,entry_status,first_round_opponent_key,path,source_url,raw)
select event_key,draw_version,draw_position,tour,player_key,placeholder_key,name_en,name_zh,seed,entry_status,first_round_opponent_key,path,source_url,raw from jsonb_populate_recordset(null::public.tour_manager_draw_entries,'[{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":1,"tour":"WTA","player_key":"WTA|elena-rybakina","placeholder_key":null,"name_en":"Elena RYBAKINA","name_zh":"雷巴金娜","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Elena RYBAKINA","name_zh":"雷巴金娜","profile_id":"324166","player_key":"WTA|elena-rybakina","group":"第1组","draw_position":1,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/324166","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2040.47,"price_independent_of_scores":true},"overall_elo":2159.2,"surface_elo":2143.1,"peak_elo":2199.5,"peak_month":"2026-04","rank":1,"scores":{"base":100,"surface":100,"form":94.34,"draw":42.86,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":2,"tour":"WTA","player_key":"WTA|coco-gauff","placeholder_key":null,"name_en":"Coco GAUFF","name_zh":"高芙","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Coco GAUFF","name_zh":"高芙","profile_id":"328560","player_key":"WTA|coco-gauff","group":"第1组","draw_position":2,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/328560","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2060.9,"price_independent_of_scores":true},"overall_elo":2123.5,"surface_elo":2081.8,"peak_elo":2155.7,"peak_month":"2024-01","rank":4,"scores":{"base":99.53,"surface":99.6,"form":77.7,"draw":28.57,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":3,"tour":"WTA","player_key":"WTA|jessica-pegula","placeholder_key":null,"name_en":"Jessica PEGULA","name_zh":"佩古拉","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Jessica PEGULA","name_zh":"佩古拉","profile_id":"316956","player_key":"WTA|jessica-pegula","group":"第1组","draw_position":3,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/316956","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2068.97,"price_independent_of_scores":true},"overall_elo":2098.8,"surface_elo":2057.6,"peak_elo":2121.2,"peak_month":"2026-08","rank":5,"scores":{"base":99.34,"surface":99.4,"form":97.39,"draw":14.29,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":4,"tour":"WTA","player_key":"WTA|linda-noskova","placeholder_key":null,"name_en":"Linda NOSKOVA","name_zh":"诺斯科娃","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Linda NOSKOVA","name_zh":"诺斯科娃","profile_id":"329668","player_key":"WTA|linda-noskova","group":"第1组","draw_position":4,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/329668","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第1组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2094.17,"price_independent_of_scores":true},"overall_elo":2059.2,"surface_elo":1982,"peak_elo":2079.2,"peak_month":"2026-09","rank":8,"scores":{"base":98.87,"surface":98.91,"form":98.08,"draw":0,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":5,"tour":"WTA","player_key":"WTA|aryna-sabalenka","placeholder_key":null,"name_en":"Aryna SABALENKA","name_zh":"萨巴莲卡","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Aryna SABALENKA","name_zh":"萨巴莲卡","profile_id":"320760","player_key":"WTA|aryna-sabalenka","group":"第2组","draw_position":5,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/320760","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":1961.3,"price_independent_of_scores":true},"overall_elo":2158.5,"surface_elo":2136.8,"peak_elo":2271.7,"peak_month":"2026-04","rank":2,"scores":{"base":99.8,"surface":99.8,"form":92.14,"draw":100,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":6,"tour":"WTA","player_key":"WTA|mirra-andreeva","placeholder_key":null,"name_en":"Mirra ANDREEVA","name_zh":"米-安德烈耶娃","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Mirra ANDREEVA","name_zh":"米-安德烈耶娃","profile_id":"331809","player_key":"WTA|mirra-andreeva","group":"第2组","draw_position":6,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/331809","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2012.9,"price_independent_of_scores":true},"overall_elo":2041,"surface_elo":1982,"peak_elo":2159.2,"peak_month":"2025-03","rank":3,"scores":{"base":99.09,"surface":98.91,"form":83.67,"draw":85.71,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":7,"tour":"WTA","player_key":"WTA|elina-svitolina","placeholder_key":null,"name_en":"Elina SVITOLINA","name_zh":"斯维托丽娜","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Elina SVITOLINA","name_zh":"斯维托丽娜","profile_id":"316738","player_key":"WTA|elina-svitolina","group":"第2组","draw_position":7,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/316738","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2018.17,"price_independent_of_scores":true},"overall_elo":2026.9,"surface_elo":1966.2,"peak_elo":2120.6,"peak_month":"2018-05","rank":6,"scores":{"base":98.75,"surface":98.41,"form":66.91,"draw":71.43,"manual":0}}},{"event_key":"wta-2026-w46-finals","draw_version":1,"draw_position":8,"tour":"WTA","player_key":"WTA|karolina-muchova","placeholder_key":null,"name_en":"Karolina MUCHOVA","name_zh":"穆霍娃","seed":null,"entry_status":"direct","first_round_opponent_key":null,"path":{"first_round":"RR","path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰"},"source_url":"https://www.live-tennis.cn/zh/draw/30808/2026","raw":{"name_en":"Karolina MUCHOVA","name_zh":"穆霍娃","profile_id":"322191","player_key":"WTA|karolina-muchova","group":"第2组","draw_position":8,"price":1000,"first_round":"RR","photo_url":"https://static.live-tennis.cn/pic/ts/322191","round_robin_wins":0,"reached_round":"RR","is_eliminated":false,"path_note":"第2组 · 小组赛胜负不直接判定晋级/淘汰","pricing_detail":{"formula_version":"finals_fixed_2026","price_locked":true,"source":"https://tennisabstract.com/reports/wta_elo_ratings.html","source_date":"2026-11-07","score_explanation":{"base":"65%总体Elo百分位+35%排名反向百分位（TA覆盖球员）","surface":"硬地Elo百分位（TA覆盖球员）","form":"70%当前Elo/巅峰Elo+30%巅峰月份新近度，48个月衰减","draw":"组内其他三人平均硬地Elo的反向百分位，越高表示组内对手较弱"},"group_opponent_average_elo":2028.33,"price_independent_of_scores":true},"overall_elo":1984.2,"surface_elo":1935.7,"peak_elo":2103.5,"peak_month":"2026-06","rank":7,"scores":{"base":98.16,"surface":97.82,"form":92.9,"draw":57.14,"manual":0}}}]'::jsonb)
on conflict(event_key,draw_version,draw_position) do update set tour=excluded.tour,player_key=excluded.player_key,placeholder_key=excluded.placeholder_key,name_en=excluded.name_en,name_zh=excluded.name_zh,seed=excluded.seed,entry_status=excluded.entry_status,first_round_opponent_key=excluded.first_round_opponent_key,path=excluded.path,source_url=excluded.source_url,raw=excluded.raw;

commit;
