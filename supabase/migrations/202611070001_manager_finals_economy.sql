-- WTA Finals contracts settle cumulative entitlement, never single-elimination points.
begin;
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
commit;
