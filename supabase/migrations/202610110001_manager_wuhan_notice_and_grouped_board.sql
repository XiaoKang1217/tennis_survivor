begin;

create or replace function public.tour_manager_take_wuhan_opening_notice()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inserted uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if now() >= timestamptz '2026-10-12 11:00:00+08'
    or not exists(select 1 from public.tour_manager_station_configs
      where station_key='2026-w42-wuhan' and season=2026) then return null; end if;
  insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
    values(v_user,'wuhan_2026_opening') on conflict do nothing
    returning user_id into v_inserted;
  if v_inserted is null then return null; end if;
  return jsonb_build_object('message','经纪人新站WTA 武汉1000赛开售！快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_wuhan_opening_notice() from public, anon;
grant execute on function public.tour_manager_take_wuhan_opening_notice() to authenticated;

-- Aggregate complete station boards before ranking; never merge truncated top-N lists.
create or replace function public.tour_manager_grouped_station_net_leaderboard(p_station_keys text[], p_season int)
returns table(rank_no bigint, display_name text, badge_key text, badge_title text,
  badge_thumb_url text, station_net_income bigint, player_settlement_income bigint, combo_bonus bigint)
language sql stable security definer set search_path=public
as $$
  with eligible as (
    select l.id, l.user_id, l.submitted_at from public.tour_manager_lineups l
    where l.station_key=any(p_station_keys) and l.season=p_season
      and l.status in ('submitted','locked','settling','settled')
      and cardinality(p_station_keys) between 1 and 3
  ), per_lineup as (
    select e.id,e.user_id,e.submitted_at,
      coalesce(sum(w.amount) filter(where w.type='player_points_delta'),0)::bigint as player,
      coalesce(sum(w.amount) filter(where w.type='station_combo_bonus'),0)::bigint as combo
    from eligible e left join public.tour_manager_wallet_ledger w
      on w.lineup_id=e.id and w.type in ('player_points_delta','station_combo_bonus')
    group by e.id,e.user_id,e.submitted_at
  ), totals as (
    select user_id,sum(player)::bigint as player,sum(combo)::bigint as combo,min(submitted_at) as submitted_at
    from per_lineup group by user_id
  )
  select row_number() over(order by t.player+t.combo desc,t.player desc,t.combo desc,t.submitted_at,t.user_id),
    coalesce(p.display_name,'炉友')::text,ab.badge_key::text,ab.title::text,ab.thumb_url::text,
    (t.player+t.combo)::bigint,t.player,t.combo
  from totals t left join public.profiles p on p.id=t.user_id
  left join public.tour_manager_active_badges ab on ab.user_id=t.user_id
  order by 1 limit 300;
$$;
revoke all on function public.tour_manager_grouped_station_net_leaderboard(text[],int) from public;
grant execute on function public.tour_manager_grouped_station_net_leaderboard(text[],int) to anon,authenticated;
commit;
