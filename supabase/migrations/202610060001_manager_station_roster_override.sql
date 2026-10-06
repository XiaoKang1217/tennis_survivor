-- Station-specific exceptions; the shared Masters 1000 rules remain 2-3.
begin;
create or replace function public.tour_manager_station_rules(p_station_key text, p_season int)
returns jsonb language plpgsql stable as $$
declare
  v_event_count int;
  v_min_players int;
  v_max_players int;
  v_station_grant int;
  v_station_grant_override int;
  v_transfer_fee numeric;
  v_top_level text;
  v_roster jsonb;
begin
  select count(*), min(public.tour_manager_level_min_players(level)),
    sum(public.tour_manager_level_max_players(level)),
    sum(public.tour_manager_level_side_grant(level)),
    max(public.tour_manager_level_transfer_fee(level)),
    (array_agg(level order by public.tour_manager_level_rank(level) desc))[1]
  into v_event_count, v_min_players, v_max_players, v_station_grant, v_transfer_fee, v_top_level
  from public.tour_manager_events
  where station_key=p_station_key and season=p_season and market_status<>'cancelled';
  if coalesce(v_event_count,0)=0 then raise exception 'station_not_found'; end if;
  select station_grant, metadata->'roster' into v_station_grant_override, v_roster
  from public.tour_manager_station_configs where station_key=p_station_key and season=p_season;
  v_station_grant := coalesce(v_station_grant_override,v_station_grant);
  if v_roster is not null then
    if coalesce((v_roster->>'min_players')::int,0)<1
      or coalesce((v_roster->>'max_players')::int,0)<(v_roster->>'min_players')::int then
      raise exception 'invalid_station_roster_override';
    end if;
    v_min_players := (v_roster->>'min_players')::int;
    v_max_players := (v_roster->>'max_players')::int;
  end if;
  return jsonb_build_object('event_count',v_event_count,'min_players',v_min_players,
    'max_players',v_max_players,'station_grant',v_station_grant,
    'transfer_fee_rate',v_transfer_fee,'top_level',v_top_level);
end;
$$;
commit;
