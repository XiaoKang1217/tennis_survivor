-- Atomic, repeat-safe correction. Prices and cancelled lineups are never changed.
begin;
select pg_advisory_xact_lock(hashtext('manager-wuhan-slot-repair-20261014'));

create table if not exists public.tour_manager_slot_repair_backups (
  repair_key text not null,
  contract_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (repair_key, contract_id)
);
alter table public.tour_manager_slot_repair_backups enable row level security;
revoke all on public.tour_manager_slot_repair_backups from anon, authenticated;

create or replace function public.tour_manager_apply_pre_r1_substitution_v3(
  p_event_key text, p_out_player_key text, p_in_player_key text, p_source_url text default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_in public.tour_manager_event_players;
  v_event public.tour_manager_events;
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'admin_required'; end if;
  select * into strict v_event from public.tour_manager_events where event_key = p_event_key;
  select * into strict v_in from public.tour_manager_event_players
    where event_key = p_event_key and player_key = p_in_player_key;
  if v_in.is_qualifier_placeholder then raise exception 'replacement_still_placeholder'; end if;

  -- Use the immutable purchase identity AND draw slot, never the last substituted name.
  update public.tour_manager_lineup_players lp
  set player_key = v_in.player_key, name_zh = v_in.name_zh, name_en = v_in.name_en,
    metadata = lp.metadata || jsonb_build_object(
      'original_purchase_player_key', coalesce(lp.metadata->>'original_purchase_player_key', lp.metadata->>'player_key', p_out_player_key),
      'substituted_from_player_key', p_out_player_key,
      'substituted_from_name_zh', coalesce(lp.metadata->>'substituted_from_name_zh', lp.metadata->>'name_zh', lp.name_zh),
      'substituted_from_name_en', coalesce(lp.metadata->>'substituted_from_name_en', lp.metadata->>'name_en', lp.name_en),
      'replacement_player_key', v_in.player_key, 'replacement_name_zh', v_in.name_zh,
      'replacement_name_en', v_in.name_en, 'replacement_profile_id', v_in.profile_id,
      'replacement_draw_position', v_in.draw_position, 'replacement_photo_url', v_in.photo_url,
      'replacement_event_player', to_jsonb(v_in), 'contract_price_policy', 'keep_original_contract_price',
      'original_contract_price', lp.price, 'substitution_reason', 'pre_r1_withdrawal',
      'substitution_source_url', p_source_url, 'substitution_applied_at', now())
  where lp.event_key = p_event_key
    and coalesce(lp.metadata->>'original_purchase_player_key', lp.metadata->>'player_key',
      lp.metadata->'source'->>'source_file_player_key', lp.metadata->>'substituted_from_player_key', lp.player_key) = p_out_player_key
    and (nullif(lp.metadata->>'draw_position', '') is null or (lp.metadata->>'draw_position')::int = v_in.draw_position)
    and (lp.player_key <> v_in.player_key or lp.metadata->>'replacement_draw_position' is distinct from v_in.draw_position::text)
    and exists (select 1 from public.tour_manager_lineups l where l.id = lp.lineup_id and l.status in ('submitted','locked','settling','settled'));
  get diagnostics v_count = row_count;
  update public.tour_manager_lineups l
  set village_hope_player_key = v_in.player_key, village_hope_player_name = v_in.name_zh
  where l.status in ('submitted','locked','settling','settled') and exists (
    select 1 from public.tour_manager_lineup_players lp where lp.lineup_id = l.id
      and lp.event_key = p_event_key and lp.player_key = v_in.player_key
      and lp.metadata->>'is_village_hope' = 'true'
      and coalesce(lp.metadata->>'original_purchase_player_key', lp.metadata->>'player_key', lp.player_key) = p_out_player_key
      and (nullif(lp.metadata->>'draw_position','') is null or (lp.metadata->>'draw_position')::int = v_in.draw_position));
  -- Event/market prices already come from the locked publication in sync-station.
  -- Do not copy the mutable outgoing player's price or relabel historical settlements.
  return v_count;
end $$;
revoke all on function public.tour_manager_apply_pre_r1_substitution_v3(text,text,text,text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_pre_r1_substitution_v3(text,text,text,text) to service_role;

-- Keep existing workflow callers safe immediately, without a deployment timing gap.
create or replace function public.tour_manager_apply_pre_r1_substitution_v2(
  p_event_key text, p_out_player_key text, p_in_player_key text, p_source_url text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_origin text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'admin_required'; end if;
  select coalesce(source->'pre_r1_substitution'->>'locked_publication_player_key', p_out_player_key)
    into v_origin from public.tour_manager_event_players
    where event_key = p_event_key and player_key = p_in_player_key;
  return public.tour_manager_apply_pre_r1_substitution_v3(p_event_key, coalesce(v_origin,p_out_player_key),p_in_player_key,p_source_url);
end $$;
revoke all on function public.tour_manager_apply_pre_r1_substitution_v2(text,text,text,text) from public, anon, authenticated;
grant execute on function public.tour_manager_apply_pre_r1_substitution_v2(text,text,text,text) to service_role;

do $$
declare
  c record;
  v_in public.tour_manager_event_players;
  v_balance int;
  v_n int := 0;
  v_wrong int;
begin
  select * into strict v_in from public.tour_manager_event_players
    where event_key = 'wta-2026-w42-wuhan' and player_key = 'WTA|iva-jovic';
  if v_in.draw_position <> 17 then raise exception 'Unexpected Jovic draw position'; end if;
  for c in
    select lp.*, l.user_id, l.season, l.station_key
    from public.tour_manager_lineup_players lp join public.tour_manager_lineups l on l.id = lp.lineup_id
    where lp.event_key = 'wta-2026-w42-wuhan'
      and lp.metadata->>'player_key' = 'WTA|mirra-andreeva'
      and lp.player_key = 'WTA|anna-bondar'
      and l.status in ('submitted','locked','settling','settled')
    for update of lp, l
  loop
    if c.price <> 345 or c.earned_points <> 10 or c.metadata->>'draw_position' <> '17' then
      raise exception 'Contract changed since audit: %; abort without partial changes', c.id;
    end if;
    select coalesce(sum(points_delta),0) into v_wrong from public.tour_manager_settlements
      where contract_id = c.id and player_key = 'WTA|anna-bondar'
        and source->>'match_key' = 'wta-2026-w42-wuhan:LS044';
    if v_wrong <> 10 then raise exception 'Unexpected settlement for %', c.id; end if;
    if not exists (select 1 from public.tour_manager_wallet_ledger wl,
      lateral jsonb_array_elements(coalesce(wl.metadata->'players','[]'::jsonb)) p
      where wl.lineup_id = c.lineup_id and wl.type in ('lineup_wallet_spend','submit_bonus')
        and p->>'player_key' = 'WTA|mirra-andreeva' and (p->>'price')::int = c.price) then
      raise exception 'Original purchase ledger mismatch: %', c.id;
    end if;
    if exists (select 1 from public.tour_manager_wallet_ledger where lineup_id = c.lineup_id
      and type like '%combo%' and amount <> 0) then raise exception 'Combo needs separate audit: %', c.id; end if;
    insert into public.tour_manager_slot_repair_backups values (
      'wuhan-slot-20261014', c.id,
      jsonb_build_object('contract', to_jsonb(c),
        'settlements', (select jsonb_agg(to_jsonb(s)) from public.tour_manager_settlements s where s.contract_id = c.id),
        'wallet', (select to_jsonb(w) from public.tour_manager_wallets w where w.user_id = c.user_id and w.season = c.season)), now());

    update public.tour_manager_wallets set balance = balance - v_wrong, updated_at = now()
      where user_id = c.user_id and season = c.season returning balance into strict v_balance;
    insert into public.tour_manager_wallet_ledger(user_id,season,station_key,lineup_id,type,amount,balance_after,description,metadata)
    values(c.user_id,c.season,c.station_key,c.lineup_id,'player_points_delta',-v_wrong,v_balance,
      '武汉替补签位纠正：冲回误计的邦达尔收益，原米拉合同恢复为约维奇',
      jsonb_build_object('repair_key','wuhan-slot-20261014','contract_id',c.id,'event_key',c.event_key,
        'player_key','WTA|iva-jovic','original_player_key','WTA|mirra-andreeva','points_delta',-v_wrong));
    update public.tour_manager_settlements set points_delta = 0, is_final = false,
      player_key = 'WTA|iva-jovic', source = source || jsonb_build_object(
        'repair_key','wuhan-slot-20261014','voided_wrong_points',points_delta,'voided_wrong_player','WTA|anna-bondar')
      where contract_id = c.id and player_key = 'WTA|anna-bondar'
        and source->>'match_key' = 'wta-2026-w42-wuhan:LS044';
    update public.tour_manager_lineup_players set
      player_key = v_in.player_key, name_zh = v_in.name_zh, name_en = v_in.name_en,
      earned_points = 0, reached_round = 'OUT',
      metadata = (metadata - 'last_settled_match_key' - 'last_settled_round' - 'bye_first_match_adjusted') || jsonb_build_object(
        'original_purchase_player_key','WTA|mirra-andreeva','substituted_from_player_key','WTA|mirra-andreeva',
        'substituted_from_name_zh','米-安德烈耶娃','substituted_from_name_en','Mirra ANDREEVA',
        'replacement_player_key',v_in.player_key,'replacement_name_zh',v_in.name_zh,'replacement_name_en',v_in.name_en,
        'replacement_profile_id',v_in.profile_id,'replacement_draw_position',17,'replacement_photo_url',v_in.photo_url,
        'replacement_event_player',to_jsonb(v_in),'is_eliminated',false,'status_zh','存活',
        'repair_key','wuhan-slot-20261014')
      where id = c.id;
    v_n := v_n + 1;
  end loop;
  raise notice 'Corrected % Mirra contracts; locked purchase prices unchanged', v_n;
end $$;
-- Preserve the user's original hope selection through the slot replacement.
update public.tour_manager_lineups l
set village_hope_player_key = lp.player_key, village_hope_player_name = lp.name_zh
from public.tour_manager_lineup_players lp
where lp.lineup_id = l.id and lp.event_key = 'wta-2026-w42-wuhan'
  and l.status in ('submitted','locked','settling','settled')
  and lp.metadata->>'player_key' in ('WTA|mirra-andreeva','WTA|iva-jovic')
  and lp.metadata->>'is_village_hope' = 'true';
commit;

select metadata->>'player_key' as original_purchase, player_key, price, count(*) as contracts
from public.tour_manager_lineup_players lp
where event_key = 'wta-2026-w42-wuhan' and metadata->>'player_key' in ('WTA|mirra-andreeva','WTA|iva-jovic')
  and exists (select 1 from public.tour_manager_lineups l where l.id = lp.lineup_id and l.status in ('submitted','locked','settling','settled'))
group by 1,2,3;
