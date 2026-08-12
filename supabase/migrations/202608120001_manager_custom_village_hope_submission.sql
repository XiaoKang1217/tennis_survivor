-- Cincinnati 2026: allow stations to freeze a user-selected village hope
-- while reusing the Canada Combo / welfare settlement engine.

create or replace function public.tour_manager_submit_lineup_v2(
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
  p_lineup_style text default null,
  p_village_hope_player_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_selection text;
  v_requested_key text := nullif(trim(coalesce(p_village_hope_player_key, '')), '');
  v_selected_key text;
  v_selected_name text;
  v_lineup_id uuid;
  v_data jsonb;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if p_contracts is null or jsonb_typeof(p_contracts) <> 'array' then
    raise exception 'contracts_must_be_array';
  end if;

  select coalesce(metadata #>> '{combo,village_hope,selection}', 'highest_original_price_at_submission')
  into v_selection
  from public.tour_manager_station_configs
  where station_key = p_station_key
    and season = p_season;
  v_selection := coalesce(v_selection, 'highest_original_price_at_submission');

  if v_selection = 'user_selected_at_submission' then
    if v_requested_key is null then
      raise exception 'village_hope_required';
    end if;

    with req as (
      select distinct x->>'event_key' as event_key, x->>'player_key' as player_key
      from jsonb_array_elements(p_contracts) x
    )
    select ep.player_key, coalesce(nullif(ep.name_zh, ''), nullif(ep.name_en, ''), ep.player_key)
    into v_selected_key, v_selected_name
    from req
    join public.tour_manager_event_players ep
      on ep.event_key = req.event_key
     and ep.player_key = req.player_key
    join public.tour_manager_events e
      on e.event_key = ep.event_key
    where e.station_key = p_station_key
      and e.season = p_season
      and ep.player_key = v_requested_key
    limit 1;

    if v_selected_key is null then
      raise exception 'invalid_village_hope_player';
    end if;
  end if;

  v_data := public.tour_manager_submit_lineup(
    p_station_key,
    p_season,
    p_station_grant,
    p_min_players,
    p_max_players,
    p_transfer_fee_rate,
    p_contracts,
    coalesce(p_predictions, '{}'::jsonb),
    p_predicted_gross,
    p_predicted_bonus,
    p_predicted_net,
    p_lineup_style
  );

  if v_selection = 'user_selected_at_submission' then
    select id
    into v_lineup_id
    from public.tour_manager_lineups
    where user_id = v_user
      and station_key = p_station_key
      and season = p_season
      and status <> 'cancelled'
    order by submitted_at desc, created_at desc, id desc
    limit 1;

    if v_lineup_id is null then
      raise exception 'lineup_not_found_after_submit';
    end if;

    update public.tour_manager_lineups
    set village_hope_player_key = v_selected_key,
        village_hope_player_name = v_selected_name
    where id = v_lineup_id;

    update public.tour_manager_lineup_players
    set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{is_village_hope}',
      to_jsonb(player_key = v_selected_key),
      true
    )
    where lineup_id = v_lineup_id;

    update public.tour_manager_wallet_ledger
    set metadata = jsonb_set(
      jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{village_hope_player_key}',
        to_jsonb(v_selected_key),
        true
      ),
      '{village_hope_player_name}',
      to_jsonb(v_selected_name),
      true
    )
    where lineup_id = v_lineup_id
      and type in ('station_grant_issued', 'lineup_wallet_spend', 'submit_bonus');

    v_data := public.tour_manager_get_my_state(p_station_key, p_season);
  end if;

  return v_data;
end;
$$;

revoke all on function public.tour_manager_submit_lineup_v2(
  text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text, text
) from public, anon;
grant execute on function public.tour_manager_submit_lineup_v2(
  text, int, int, int, int, numeric, jsonb, jsonb, int, int, int, text, text
) to authenticated;
