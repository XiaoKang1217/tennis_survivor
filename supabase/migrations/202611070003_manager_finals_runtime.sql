begin;
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
commit;
