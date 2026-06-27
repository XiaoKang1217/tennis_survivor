-- 巡回赛经纪人：提交截止前允许撤回阵容并重新提交。
-- 撤回不删除原始提交流水，而是新增反向钱包流水，保证账本可审计。

alter table public.tour_manager_lineups
  drop constraint if exists tour_manager_lineups_user_id_station_key_key;

create unique index if not exists tour_manager_lineups_user_station_active_uniq
on public.tour_manager_lineups(user_id, station_key)
where status <> 'cancelled';

create or replace function public.tour_manager_get_my_state(
  p_station_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_lineup public.tour_manager_lineups;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select * into v_lineup
  from public.tour_manager_lineups
  where user_id = v_user
    and station_key = p_station_key
    and status <> 'cancelled'
  order by submitted_at desc
  limit 1;

  return jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'lineup', case when v_lineup.id is null then null else to_jsonb(v_lineup) end,
    'contracts', coalesce((
      select jsonb_agg(to_jsonb(lp) order by lp.created_at)
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = v_lineup.id
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(wl) order by wl.created_at desc)
      from public.tour_manager_wallet_ledger wl
      where wl.user_id = v_user
        and wl.season = p_season
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.tour_manager_withdraw_lineup(
  p_station_key text,
  p_season int default 2026
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.tour_manager_wallets;
  v_lineup public.tour_manager_lineups;
  v_event_count int := 0;
  v_has_pending_cutoff boolean := false;
  v_has_closed_cutoff boolean := false;
  v_wallet_used int := 0;
  v_submission_bonus int := 0;
  v_balance int := 0;
  v_after_refund int := 0;
  v_after_final int := 0;
  v_players jsonb := '[]'::jsonb;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  select
    count(*),
    coalesce(bool_or(e.submission_closes_at is null), false),
    coalesce(bool_or(e.submission_closes_at is not null and now() > e.submission_closes_at), false)
  into v_event_count, v_has_pending_cutoff, v_has_closed_cutoff
  from public.tour_manager_events e
  where e.station_key = p_station_key
    and e.season = p_season
    and e.market_status <> 'cancelled';

  if v_event_count = 0 then
    raise exception 'station_not_found';
  end if;
  if v_has_pending_cutoff then
    raise exception 'submission_window_pending';
  end if;
  if v_has_closed_cutoff then
    raise exception 'submission_window_closed';
  end if;

  select * into v_lineup
  from public.tour_manager_lineups
  where user_id = v_user
    and station_key = p_station_key
    and season = p_season
    and status = 'submitted'
  order by submitted_at desc
  limit 1
  for update;

  if v_lineup.id is null then
    raise exception 'lineup_not_submitted';
  end if;

  if exists (select 1 from public.tour_manager_transfers where lineup_id = v_lineup.id)
     or exists (select 1 from public.tour_manager_settlements where lineup_id = v_lineup.id) then
    raise exception 'lineup_with_activity';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_key', lp.player_key,
        'name', lp.name_zh,
        'name_zh', lp.name_zh,
        'name_en', lp.name_en,
        'price', lp.price,
        'tour', lp.tour
      )
      order by lp.created_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.tour_manager_lineup_players lp
  where lp.lineup_id = v_lineup.id;

  v_wallet := public.tour_manager_bootstrap_wallet(p_season);

  select balance into v_balance
  from public.tour_manager_wallets
  where user_id = v_user and season = p_season
  for update;

  v_wallet_used := greatest(coalesce(v_lineup.wallet_used, 0), 0);
  v_submission_bonus := greatest(coalesce(v_lineup.submission_bonus, 0), 0);

  if v_balance + v_wallet_used < v_submission_bonus then
    raise exception 'insufficient_wallet_for_withdraw';
  end if;

  update public.tour_manager_wallet_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('players', v_players)
  where lineup_id = v_lineup.id
    and type in ('lineup_wallet_spend', 'submit_bonus');

  v_after_refund := v_balance + v_wallet_used;
  v_after_final := v_after_refund - v_submission_bonus;

  if v_wallet_used > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup.id,
      'lineup_withdraw_refund', v_wallet_used, v_after_refund,
      '签约球员撤回',
      jsonb_build_object(
        'lineup_cost', v_lineup.lineup_cost,
        'station_grant_used', v_lineup.station_grant_used,
        'wallet_used', v_wallet_used,
        'submission_bonus', v_submission_bonus,
        'players', v_players,
        'withdrawn_at', now()
      )
    );
  end if;

  if v_submission_bonus > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup.id,
      'submit_bonus_reversal', -v_submission_bonus, v_after_final,
      '撤回提交奖励',
      jsonb_build_object(
        'lineup_cost', v_lineup.lineup_cost,
        'station_grant_used', v_lineup.station_grant_used,
        'wallet_used', v_wallet_used,
        'submission_bonus', v_submission_bonus,
        'players', v_players,
        'withdrawn_at', now()
      )
    );
  end if;

  update public.tour_manager_wallets
  set balance = v_after_final,
      updated_at = now()
  where user_id = v_user and season = p_season;

  update public.tour_manager_lineups
  set status = 'cancelled',
      updated_at = now()
  where id = v_lineup.id;

  return public.tour_manager_get_my_state(p_station_key, p_season);
end;
$$;

revoke all on function public.tour_manager_withdraw_lineup(text, int) from public, anon;
grant execute on function public.tour_manager_withdraw_lineup(text, int) to authenticated;
grant execute on function public.tour_manager_get_my_state(text, int) to authenticated;
