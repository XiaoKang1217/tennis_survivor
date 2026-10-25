-- No balances, contracts, or past settlements are changed by this migration.
begin;

-- Retain the existing serialized daily-delta calculation and ledger details.
-- Tour grouping allows either ATP event to qualify; old event grouping is unchanged.
do $migration$
declare
  definition text;
  side text;
  side_tour text;
begin
  definition := pg_get_functiondef('public.tour_manager_apply_seoul_singapore_combo_v1(text,integer)'::regprocedure);
  if position('v_dual_grouping' in definition) = 0 then
    if position('v_left_event text;' in definition) = 0
      or position('and event_key in (v_left_event, v_right_event)' in definition) = 0 then
      raise exception 'unexpected_combo_function_definition';
    end if;
    definition := replace(definition, 'v_left_event text;', 'v_dual_grouping text; v_left_event text;');
    definition := replace(definition,
      'select metadata #>> ''{combo,dual_tour,event_keys,0}'', metadata #>> ''{combo,dual_tour,event_keys,1}''',
      'select coalesce(metadata #>> ''{combo,dual_tour,grouping}'', ''event''), metadata #>> ''{combo,dual_tour,event_keys,0}'', metadata #>> ''{combo,dual_tour,event_keys,1}''');
    definition := replace(definition, 'into v_left_event, v_right_event', 'into v_dual_grouping, v_left_event, v_right_event');
    definition := replace(definition,
      'if v_left_event is null or v_right_event is null or v_left_event = v_right_event then',
      'if v_dual_grouping <> ''tour'' and (v_left_event is null or v_right_event is null or v_left_event = v_right_event) then');
    foreach side in array array['left','right'] loop
      side_tour := case when side = 'left' then 'ATP' else 'WTA' end;
      definition := replace(definition, 'event_key = v_' || side || '_event',
        format('((v_dual_grouping = ''tour'' and tour = %L) or (v_dual_grouping <> ''tour'' and event_key = v_%s_event))', side_tour, side));
    end loop;
    definition := replace(definition, 'and event_key in (v_left_event, v_right_event)',
      'and ((v_dual_grouping = ''tour'' and tour in (''ATP'', ''WTA'')) or (v_dual_grouping <> ''tour'' and event_key in (v_left_event, v_right_event)))');
    execute definition;
  end if;
end;
$migration$;

-- Read small-business rewards from station metadata; old stations retain defaults.
do $migration$
declare definition text; old_reward int; reward_index int;
begin
  definition := pg_get_functiondef('public.tour_manager_apply_seoul_singapore_combo_v1(text,integer)'::regprocedure);
  if position('v_small_rewards' in definition) = 0 then
    if position('v_small_max_cost int;' in definition) = 0 then
      raise exception 'unexpected_small_budget_function_definition';
    end if;
    definition := replace(definition,'v_small_max_cost int;','v_small_max_cost int; v_small_rewards jsonb;');
    definition := replace(definition,'for v_lineup in',
      'select metadata #> ''{combo,small_budget,bonuses}'' into v_small_rewards from public.tour_manager_station_configs where station_key=p_station_key and season=p_season; for v_lineup in');
    for reward_index in 0..3 loop
      old_reward := (reward_index + 1) * 50;
      if position(format('v_small_bonus := %s;',old_reward) in definition) = 0 then
        raise exception 'unexpected_small_budget_reward:%',old_reward;
      end if;
      definition := replace(definition,format('v_small_bonus := %s;',old_reward),
        format('v_small_bonus := coalesce((v_small_rewards ->> %s)::int, %s);',reward_index,old_reward));
    end loop;
    execute definition;
  end if;
end;
$migration$;

create or replace function public.tour_manager_take_basel_vienna_tokyo_opening_notice()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inserted uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if now() >= timestamptz '2026-10-26 11:00:00+08'
    or not exists(select 1 from public.tour_manager_station_configs
      where station_key='2026-w44-basel-vienna-tokyo' and season=2026) then return null; end if;
  insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
    values(v_user,'basel_vienna_tokyo_2026_opening') on conflict do nothing
    returning user_id into v_inserted;
  if v_inserted is null then return null; end if;
  return jsonb_build_object('message','经纪人新站ATP巴塞尔+ATP维也纳+WTA东京开售！快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_basel_vienna_tokyo_opening_notice() from public, anon;
grant execute on function public.tour_manager_take_basel_vienna_tokyo_opening_notice() to authenticated;
commit;
