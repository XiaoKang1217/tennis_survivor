-- 巡回赛经纪人：执行已知赛前退赛同签位替换的数据修复。
-- 202606230004 部署了修复函数和展示 view；本迁移直接修复线上已提交的旧合同数据。

do $$
declare
  r record;
  v_event public.tour_manager_events;
  v_in public.tour_manager_event_players;
  v_out public.tour_manager_event_players;
begin
  for r in
    select *
    from (
      values
        (
          'atp-2026-w25-eastbourne-lexus-eastbourne-open',
          'ATP|francisco-cerundolo',
          'ATP|toby-samuel',
          'https://www.live-tennis.cn/zh/draw/ajax/20741/2026/device/0/horizontal/true'
        ),
        (
          'atp-2026-w25-eastbourne-lexus-eastbourne-open',
          'ATP|brandon-nakashima',
          'ATP|marcos-giron',
          'https://www.live-tennis.cn/zh/draw/ajax/20741/2026/device/0/horizontal/true'
        ),
        (
          'atp-2026-w25-eastbourne-lexus-eastbourne-open',
          'ATP|camilo-ugo-carabelli',
          'ATP|marco-trungelliti',
          'https://www.live-tennis.cn/zh/draw/ajax/20741/2026/device/0/horizontal/true'
        )
    ) as t(event_key, out_player_key, in_player_key, source_url)
  loop
    select * into v_event
    from public.tour_manager_events
    where event_key = r.event_key;

    select * into v_in
    from public.tour_manager_event_players
    where event_key = r.event_key
      and player_key = r.in_player_key;

    select * into v_out
    from public.tour_manager_event_players
    where event_key = r.event_key
      and player_key = r.out_player_key;

    if v_event.event_key is null or v_in.player_key is null then
      continue;
    end if;

    if v_out.player_key is not null then
      update public.tour_manager_event_players ep
      set price = v_out.price,
          base_score = v_out.base_score,
          surface_score = v_out.surface_score,
          draw_score = v_out.draw_score,
          form_score = v_out.form_score,
          manual_score = v_out.manual_score,
          source = coalesce(ep.source, '{}'::jsonb) || jsonb_build_object(
            'pre_r1_substitution', jsonb_build_object(
              'out_player_key', r.out_player_key,
              'out_name_zh', v_out.name_zh,
              'out_name_en', v_out.name_en,
              'replacement_player_key', r.in_player_key,
              'replacement_name_zh', v_in.name_zh,
              'replacement_name_en', v_in.name_en,
              'replacement_profile_id', v_in.profile_id,
              'draw_position', v_in.draw_position,
              'reason', 'pre_r1_withdrawal',
              'source_url', r.source_url,
              'contract_price_policy', 'keep_original_contract_price',
              'original_contract_price', v_out.price
            ),
            'contract_price_policy', 'keep_original_contract_price',
            'original_contract_price', v_out.price
          )
      where ep.event_key = r.event_key
        and ep.player_key = r.in_player_key;

      update public.tour_manager_price_version_players pvp
      set price = v_out.price,
          tier = public.tour_manager_price_tier(v_out.price, v_in.tour, v_event.level),
          base_score = v_out.base_score,
          surface_score = v_out.surface_score,
          draw_score = v_out.draw_score,
          form_score = v_out.form_score,
          manual_score = v_out.manual_score,
          total_score = (
            v_out.base_score * 0.35
            + v_out.surface_score * 0.25
            + v_out.draw_score * 0.20
            + v_out.form_score * 0.15
            + v_out.manual_score * 0.05
          ),
          source_facts = coalesce(pvp.source_facts, '{}'::jsonb) || jsonb_build_object(
            'pre_r1_substitution', jsonb_build_object(
              'out_player_key', r.out_player_key,
              'out_name_zh', v_out.name_zh,
              'out_name_en', v_out.name_en,
              'replacement_player_key', r.in_player_key,
              'replacement_name_zh', v_in.name_zh,
              'replacement_name_en', v_in.name_en,
              'replacement_profile_id', v_in.profile_id,
              'draw_position', v_in.draw_position,
              'reason', 'pre_r1_withdrawal',
              'source_url', r.source_url,
              'contract_price_policy', 'keep_original_contract_price',
              'original_contract_price', v_out.price
            ),
            'contract_price_policy', 'keep_original_contract_price',
            'original_contract_price', v_out.price
          )
      where pvp.event_key = r.event_key
        and pvp.player_key = r.in_player_key;

      select * into v_in
      from public.tour_manager_event_players
      where event_key = r.event_key
        and player_key = r.in_player_key;
    end if;

    insert into public.tour_manager_player_substitutions (
      station_key, event_key, out_player_key, in_player_key, reason, source_url, metadata
    )
    values (
      v_event.station_key,
      r.event_key,
      r.out_player_key,
      r.in_player_key,
      'pre_r1_withdrawal',
      r.source_url,
      jsonb_build_object(
        'draw_position', v_in.draw_position,
        'out_name_zh', coalesce(v_out.name_zh, r.out_player_key),
        'out_name_en', v_out.name_en,
        'in_name_zh', v_in.name_zh,
        'in_name_en', v_in.name_en,
        'in_profile_id', v_in.profile_id,
        'in_photo_url', v_in.photo_url,
        'contract_price_policy', 'keep_original_contract_price',
        'original_contract_price', coalesce(v_out.price, v_in.price)
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
        tier = public.tour_manager_price_tier(lp.price, v_in.tour, v_event.level),
        metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
          'substituted_from_player_key', r.out_player_key,
          'substituted_from_name_zh', coalesce(lp.metadata->>'substituted_from_name_zh', lp.name_zh, v_out.name_zh, r.out_player_key),
          'substituted_from_name_en', coalesce(lp.metadata->>'substituted_from_name_en', lp.name_en, v_out.name_en),
          'substitution_reason', 'pre_r1_withdrawal',
          'substitution_source_url', r.source_url,
          'substitution_applied_at', now(),
          'replacement_player_key', v_in.player_key,
          'replacement_name_zh', v_in.name_zh,
          'replacement_name_en', v_in.name_en,
          'replacement_profile_id', v_in.profile_id,
          'replacement_draw_position', v_in.draw_position,
          'replacement_photo_url', v_in.photo_url,
          'replacement_event_player', to_jsonb(v_in),
          'contract_price_policy', 'keep_original_contract_price',
          'original_contract_price', lp.price
        )
    where lp.event_key = r.event_key
      and lp.player_key = r.out_player_key
      and exists (
        select 1 from public.tour_manager_lineups l
        where l.id = lp.lineup_id
          and l.status in ('submitted','locked','settling','settled')
      );

    update public.tour_manager_settlements s
    set player_key = v_in.player_key,
        source = coalesce(s.source, '{}'::jsonb) || jsonb_build_object(
          'substituted_from_player_key', r.out_player_key,
          'substituted_from_name_zh', coalesce(v_out.name_zh, r.out_player_key),
          'replacement_player_key', v_in.player_key,
          'replacement_name_zh', v_in.name_zh,
          'pre_r1_substitution_applied_at', now()
        )
    where s.event_key = r.event_key
      and s.player_key = r.out_player_key;

    update public.tour_manager_wallet_ledger wl
    set metadata = coalesce(wl.metadata, '{}'::jsonb) || jsonb_build_object(
          'player_key', v_in.player_key,
          'substituted_from_player_key', r.out_player_key,
          'substituted_from_name_zh', coalesce(v_out.name_zh, r.out_player_key),
          'replacement_player_key', v_in.player_key,
          'replacement_name_zh', v_in.name_zh,
          'pre_r1_substitution_applied_at', now()
        )
    where wl.station_key = v_event.station_key
      and wl.type = 'player_points_delta'
      and wl.metadata->>'event_key' = r.event_key
      and wl.metadata->>'player_key' = r.out_player_key;
  end loop;
end;
$$;

create or replace view public.tour_manager_public_configurations
as
select
  l.station_key,
  l.id as lineup_id,
  coalesce(p.display_name, '炉友') as display_name,
  l.lineup_style,
  l.lineup_cost,
  l.predicted_net,
  l.submitted_at,
  l.status,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_key', lp.player_key,
        'name',
          case
            when coalesce(lp.metadata->>'substituted_from_name_zh', '') <> ''
              then lp.name_zh || '（原' || (lp.metadata->>'substituted_from_name_zh') || '）'
            else lp.name_zh
          end,
        'name_zh', lp.name_zh,
        'name_en', lp.name_en,
        'original_name_zh', nullif(lp.metadata->>'substituted_from_name_zh', ''),
        'original_name_en', nullif(lp.metadata->>'substituted_from_name_en', ''),
        'tour', lp.tour,
        'price', lp.price,
        'predicted_round', lp.predicted_round,
        'active', lp.is_active
      )
      order by lp.created_at
    ) filter (where lp.id is not null),
    '[]'::jsonb
  ) as players
from public.tour_manager_lineups l
left join public.profiles p on p.id = l.user_id
left join public.tour_manager_lineup_players lp on lp.lineup_id = l.id and lp.is_active
where l.status in ('submitted','locked','settling','settled')
group by l.station_key, l.id, p.display_name, l.lineup_style, l.lineup_cost, l.predicted_net, l.submitted_at, l.status;

grant select on public.tour_manager_public_configurations to anon, authenticated;
