-- 巡回赛经纪人：资格赛占位落位后，自动把已购买 Q 位合同替换成真实球员。

alter table if exists public.tour_manager_player_substitutions
  drop constraint if exists tour_manager_player_substitutions_reason_check;

alter table if exists public.tour_manager_player_substitutions
  add constraint tour_manager_player_substitutions_reason_check
  check (reason in ('pre_r1_withdrawal','qualifier_placement','lucky_loser','alternate','manual_correction'));

create or replace function public.tour_manager_apply_qualifier_placement(
  p_event_key text,
  p_placeholder_player_key text,
  p_replacement_player_key text,
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
  v_out public.tour_manager_event_players;
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
  where event_key = p_event_key
    and player_key = p_replacement_player_key;
  if v_in.player_key is null then
    raise exception 'replacement_player_not_found';
  end if;
  if v_in.is_qualifier_placeholder then
    raise exception 'replacement_still_placeholder';
  end if;

  select * into v_out
  from public.tour_manager_event_players
  where event_key = p_event_key
    and player_key = p_placeholder_player_key;

  update public.tour_manager_lineup_players lp
  set player_key = v_in.player_key,
      tour = v_in.tour,
      name_zh = v_in.name_zh,
      name_en = v_in.name_en,
      tier = public.tour_manager_price_tier(lp.price, v_in.tour, v_event.level),
      metadata = lp.metadata || jsonb_build_object(
        'qualifier_replacement_from_player_key', p_placeholder_player_key,
        'qualifier_replacement_from_name_zh', coalesce(v_out.name_zh, p_placeholder_player_key),
        'qualifier_replacement_from_name_en', v_out.name_en,
        'qualifier_replacement_to_player_key', v_in.player_key,
        'qualifier_replacement_to_name_zh', v_in.name_zh,
        'qualifier_replacement_to_name_en', v_in.name_en,
        'qualifier_replacement_profile_id', v_in.profile_id,
        'qualifier_replacement_draw_position', v_in.draw_position,
        'qualifier_replacement_source_url', p_source_url,
        'qualifier_replacement_applied_at', now(),
        'contract_price_policy', 'keep_original_q_slot_price'
      )
  where lp.event_key = p_event_key
    and lp.player_key = p_placeholder_player_key
    and exists (
      select 1
      from public.tour_manager_lineups l
      where l.id = lp.lineup_id
        and l.status in ('submitted','locked','settling','settled')
    );

  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.tour_manager_player_substitutions (
      station_key, event_key, out_player_key, in_player_key, reason, source_url, metadata
    )
    values (
      v_event.station_key,
      p_event_key,
      p_placeholder_player_key,
      p_replacement_player_key,
      'qualifier_placement',
      p_source_url,
      jsonb_build_object(
        'draw_position', v_in.draw_position,
        'out_name_zh', coalesce(v_out.name_zh, p_placeholder_player_key),
        'out_name_en', v_out.name_en,
        'in_name_zh', v_in.name_zh,
        'in_name_en', v_in.name_en,
        'in_profile_id', v_in.profile_id,
        'updated_contracts', v_count,
        'contract_price_policy', 'keep_original_q_slot_price'
      )
    )
    on conflict (event_key, out_player_key)
    do update set
      in_player_key = excluded.in_player_key,
      reason = excluded.reason,
      source_url = excluded.source_url,
      metadata = excluded.metadata,
      effective_at = now();
  end if;

  update public.tour_manager_settlements s
  set player_key = v_in.player_key,
      source = s.source || jsonb_build_object(
        'qualifier_replacement_from_player_key', p_placeholder_player_key,
        'qualifier_replacement_to_player_key', v_in.player_key
      )
  where s.event_key = p_event_key
    and s.player_key = p_placeholder_player_key;

  update public.tour_manager_wallet_ledger wl
  set metadata = wl.metadata || jsonb_build_object(
        'player_key', v_in.player_key,
        'qualifier_replacement_from_player_key', p_placeholder_player_key,
        'qualifier_replacement_to_player_key', v_in.player_key
      )
  where wl.station_key = v_event.station_key
    and wl.type = 'player_points_delta'
    and wl.metadata->>'event_key' = p_event_key
    and wl.metadata->>'player_key' = p_placeholder_player_key;

  return v_count;
end;
$$;

revoke all on function public.tour_manager_apply_qualifier_placement(text, text, text, text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_qualifier_placement(text, text, text, text) to service_role;
