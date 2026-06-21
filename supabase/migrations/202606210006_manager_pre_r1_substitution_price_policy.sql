-- 巡回赛经纪人：普通球员赛前退赛替换
-- 规则：同签位赛前替换只替换合同球员，不改原合同价格，不补差价，不退款。

create or replace function public.tour_manager_apply_pre_r1_substitution_v2(
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
  v_pending_contracts int := 0;
  v_count int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  select * into v_event
  from public.tour_manager_events
  where event_key = p_event_key;
  if v_event.event_key is null then
    raise exception 'event_not_found';
  end if;

  select * into v_in
  from public.tour_manager_event_players
  where event_key = p_event_key and player_key = p_in_player_key;
  if v_in.player_key is null then
    raise exception 'replacement_player_not_found';
  end if;
  if v_in.is_qualifier_placeholder then
    raise exception 'replacement_still_placeholder';
  end if;

  select count(*) into v_pending_contracts
  from public.tour_manager_lineup_players lp
  join public.tour_manager_lineups l on l.id = lp.lineup_id
  where lp.event_key = p_event_key
    and lp.player_key = p_out_player_key
    and lp.is_active
    and l.status in ('submitted','locked');

  if v_pending_contracts = 0 then
    return 0;
  end if;

  if v_event.main_draw_first_match_at is not null and now() >= v_event.main_draw_first_match_at then
    raise exception 'main_draw_already_started';
  end if;
  if exists (
    select 1
    from public.tour_manager_matches m
    where m.event_key = p_event_key
      and coalesce(m.round_order, public.tour_manager_round_order(m.round_key)) = 1
      and (m.status in ('live','completed','walkover','retired') or (m.scheduled_at is not null and m.scheduled_at <= now()))
  ) then
    raise exception 'main_draw_already_started';
  end if;

  insert into public.tour_manager_player_substitutions (
    station_key, event_key, out_player_key, in_player_key, reason, source_url, metadata
  )
  values (
    v_event.station_key,
    p_event_key,
    p_out_player_key,
    p_in_player_key,
    'pre_r1_withdrawal',
    p_source_url,
    jsonb_build_object(
      'replacement_name_zh', v_in.name_zh,
      'replacement_name_en', v_in.name_en,
      'replacement_profile_id', v_in.profile_id,
      'replacement_draw_position', v_in.draw_position,
      'contract_price_policy', 'keep_original_contract_price'
    )
  )
  on conflict (event_key, out_player_key)
  do update set
    in_player_key = excluded.in_player_key,
    reason = excluded.reason,
    source_url = excluded.source_url,
    metadata = excluded.metadata,
    effective_at = now();

  update public.tour_manager_lineup_players lp
  set player_key = v_in.player_key,
      tour = v_in.tour,
      name_zh = v_in.name_zh,
      name_en = v_in.name_en,
      tier = coalesce(lp.tier, public.tour_manager_price_tier(lp.price, v_in.tour, v_event.level)),
      metadata = lp.metadata || jsonb_build_object(
        'substituted_from_player_key', p_out_player_key,
        'substituted_from_name_zh', lp.name_zh,
        'substituted_from_name_en', lp.name_en,
        'substitution_reason', 'pre_r1_withdrawal',
        'substitution_source_url', p_source_url,
        'substitution_applied_at', now(),
        'replacement_player_key', v_in.player_key,
        'replacement_name_zh', v_in.name_zh,
        'replacement_name_en', v_in.name_en,
        'replacement_profile_id', v_in.profile_id,
        'replacement_draw_position', v_in.draw_position,
        'replacement_event_player', to_jsonb(v_in),
        'contract_price_policy', 'keep_original_contract_price',
        'original_contract_price', lp.price
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

create or replace function public.tour_manager_apply_pre_r1_substitution(
  p_event_key text,
  p_out_player_key text,
  p_in_player_key text,
  p_source_url text default null
)
returns int
language sql
security definer
set search_path = public
as $$
  select public.tour_manager_apply_pre_r1_substitution_v2(
    p_event_key,
    p_out_player_key,
    p_in_player_key,
    p_source_url
  );
$$;

revoke all on function public.tour_manager_apply_pre_r1_substitution_v2(text, text, text, text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_pre_r1_substitution_v2(text, text, text, text) to service_role;

revoke all on function public.tour_manager_apply_pre_r1_substitution(text, text, text, text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_pre_r1_substitution(text, text, text, text) to service_role;
