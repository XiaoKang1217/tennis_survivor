-- Freeze rule-specific Combo evidence into each wallet ledger row. This only
-- enriches metadata; it does not recalculate rewards or change wallet money.

create or replace function public.tour_manager_combo_ledger_details(
  p_lineup_id uuid,
  p_metadata jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_details jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_version text := coalesce(v_metadata ->> 'combo_version', '');
  v_bonus int;
  v_gross int := coalesce((v_metadata ->> 'gross')::int, 0);
  v_cost int := 0;
  v_round text;
  v_players jsonb;
  v_context jsonb;
begin
  if p_lineup_id is null then
    return coalesce(v_metadata -> 'combo_details', '[]'::jsonb);
  end if;

  if jsonb_typeof(v_metadata -> 'combo_entitled_details') = 'array'
     and jsonb_array_length(v_metadata -> 'combo_entitled_details') > 0 then
    v_details := v_metadata -> 'combo_entitled_details';
  elsif jsonb_typeof(v_metadata -> 'combo_details') = 'array' then
    v_details := v_metadata -> 'combo_details';
  end if;

  select coalesce(lineup_cost, 0)
  into v_cost
  from public.tour_manager_lineups
  where id = p_lineup_id;

  for v_item in select value from jsonb_array_elements(v_details)
  loop
    v_key := lower(coalesce(v_item ->> 'key', ''));
    if v_key = '' then
      v_key := case
        when coalesce(v_item ->> 'label', '') like '%稳健%' then 'steady'
        when coalesce(v_item ->> 'label', '') like '%双线%' then 'dual'
        when coalesce(v_item ->> 'label', '') like '%慧眼%' then 'jewel'
        when coalesce(v_item ->> 'label', '') like '%小本%' then 'small_budget'
        when coalesce(v_item ->> 'label', '') like '%多点开花%' then 'multi'
        when coalesce(v_item ->> 'label', '') like '%全员进阶%' then 'all_r16'
        when coalesce(v_item ->> 'label', '') like '%决赛团队%' then 'final_team'
        when coalesce(v_item ->> 'label', '') like '%冠军%' then 'champion'
        else ''
      end;
    end if;
    v_bonus := coalesce((v_item ->> 'bonus')::int, (v_item ->> 'amount')::int, 0);
    v_players := case when jsonb_typeof(v_item -> 'players') = 'array' then v_item -> 'players' else '[]'::jsonb end;
    v_context := case when jsonb_typeof(v_item -> 'context') = 'array' then v_item -> 'context' else '[]'::jsonb end;
    v_round := null;

    if v_key = 'steady' then
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
        into v_players
        from (
          select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('QF')
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then
        v_context := jsonb_build_array('毛收益' || v_gross);
      end if;

    elsif v_key = 'dual' then
      if v_version like 'wimbledon%' then
        v_round := case when v_bonus >= 450 then 'F' when v_bonus >= 300 then 'SF' when v_bonus >= 170 then 'QF' else 'R16' end;
      else
        v_round := case when v_bonus >= 80 then 'F' when v_bonus >= 45 then 'SF' else 'QF' end;
      end if;
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by tour, created_at), '[]'::jsonb)
        into v_players
        from (
          select tour, coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_round)
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then
        v_context := jsonb_build_array(v_round);
      end if;

    elsif v_key = 'jewel' then
      if v_version like 'wimbledon%' then
        v_round := case when v_bonus >= 680 then 'W' when v_bonus >= 530 then 'F' when v_bonus >= 380 then 'SF' when v_bonus >= 280 then 'QF' when v_bonus >= 180 then 'R16' else 'R32' end;
      else
        v_round := case when v_bonus >= 125 then 'W' when v_bonus >= 80 then 'F' when v_bonus >= 45 then 'SF' else 'QF' end;
      end if;
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by round_order desc, created_at), '[]'::jsonb)
        into v_players
        from (
          select
            coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name,
            public.tour_manager_round_order(coalesce(reached_round, 'OUT')) as round_order,
            created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and case when v_version like 'wimbledon%' then price <= 300 else tier in ('C', 'D') end
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_round)
          order by round_order desc, created_at
          limit 1
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then
        v_context := jsonb_build_array(case when v_round = 'W' then '冠军' else v_round end);
      end if;

    elsif v_key = 'small_budget' then
      if jsonb_array_length(v_context) = 0 then
        v_context := jsonb_build_array(
          '毛收益' || v_gross,
          '阵容成本' || v_cost,
          case when v_cost > 0 then trim(trailing '.' from trim(trailing '0' from to_char(v_gross::numeric / v_cost, 'FM999999990.00'))) || '倍' else '0倍' end
        );
      end if;

    elsif v_key = 'multi' then
      v_round := case when v_bonus >= 480 then 'SF' when v_bonus >= 320 then 'QF' when v_bonus >= 180 then 'R16' else 'R32' end;
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
        into v_players
        from (
          select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order(v_round)
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then v_context := jsonb_build_array(v_round); end if;

    elsif v_key = 'all_r16' then
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
        into v_players
        from (
          select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('R16')
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then v_context := jsonb_build_array('R16'); end if;

    elsif v_key = 'final_team' then
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
        into v_players
        from (
          select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id
            and is_active
            and public.tour_manager_round_order(coalesce(reached_round, 'OUT')) >= public.tour_manager_round_order('F')
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then v_context := jsonb_build_array('F'); end if;

    elsif v_key = 'champion' then
      if jsonb_array_length(v_players) = 0 then
        select coalesce(jsonb_agg(player_name order by created_at), '[]'::jsonb)
        into v_players
        from (
          select coalesce(nullif(name_zh, ''), nullif(name_en, ''), player_key) as player_name, created_at
          from public.tour_manager_lineup_players
          where lineup_id = p_lineup_id and is_active and reached_round = 'W'
        ) qualified;
      end if;
      if jsonb_array_length(v_context) = 0 then v_context := jsonb_build_array('冠军'); end if;
    end if;

    v_result := v_result || jsonb_build_array(
      v_item || jsonb_build_object('players', v_players, 'context', v_context)
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.tour_manager_enrich_combo_ledger_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_details jsonb;
begin
  if new.type <> 'station_combo_bonus' then
    return new;
  end if;

  v_details := public.tour_manager_combo_ledger_details(new.lineup_id, new.metadata);
  new.metadata := jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{combo_details}', v_details, true);
  new.metadata := jsonb_set(new.metadata, '{combo_entitled_details}', v_details, true);
  return new;
end;
$$;

drop trigger if exists tour_manager_enrich_combo_ledger_metadata_trigger
on public.tour_manager_wallet_ledger;

create trigger tour_manager_enrich_combo_ledger_metadata_trigger
before insert or update of metadata on public.tour_manager_wallet_ledger
for each row
execute function public.tour_manager_enrich_combo_ledger_metadata();

-- Re-run only the metadata trigger for historical Combo rows. No amount,
-- balance_after, wallet balance, or reward entitlement is modified here.
update public.tour_manager_wallet_ledger
set metadata = metadata
where type = 'station_combo_bonus';

revoke all on function public.tour_manager_combo_ledger_details(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tour_manager_enrich_combo_ledger_metadata() from public, anon, authenticated;
