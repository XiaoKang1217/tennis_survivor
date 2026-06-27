-- 巡回赛经纪人：撤回阵容时，本站签约金花费也要写入可见返还流水。
-- 注意：本站签约金不是经纪人本金，撤回时只恢复本站可用额度，不进入本金钱包。
-- 因此 ledger.amount 记录用户可见的总返还，metadata.wallet_refund 才是真实本金钱包变动。

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
  v_lineup_cost int := 0;
  v_station_used int := 0;
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
    coalesce(bool_or(coalesce(e.submission_cutoff_at, e.submission_closes_at) is null), false),
    coalesce(bool_or(coalesce(e.submission_cutoff_at, e.submission_closes_at) is not null and now() > coalesce(e.submission_cutoff_at, e.submission_closes_at)), false)
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

  v_lineup_cost := greatest(coalesce(v_lineup.lineup_cost, 0), 0);
  v_station_used := greatest(coalesce(v_lineup.station_grant_used, 0), 0);
  v_wallet_used := greatest(coalesce(v_lineup.wallet_used, 0), 0);
  v_submission_bonus := greatest(coalesce(v_lineup.submission_bonus, 0), 0);

  if v_balance + v_wallet_used < v_submission_bonus then
    raise exception 'insufficient_wallet_for_withdraw';
  end if;

  update public.tour_manager_wallet_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('players', v_players)
  where lineup_id = v_lineup.id
    and type in ('lineup_wallet_spend', 'submit_bonus', 'station_grant_issued');

  v_after_refund := v_balance + v_wallet_used;
  v_after_final := v_after_refund - v_submission_bonus;

  if v_lineup_cost > 0 then
    insert into public.tour_manager_wallet_ledger (
      user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
    )
    values (
      v_user, p_season, p_station_key, v_lineup.id,
      'lineup_withdraw_refund', v_lineup_cost, v_after_refund,
      '签约球员撤回',
      jsonb_build_object(
        'cost', 0,
        'gross', v_lineup_cost,
        'bonus', 0,
        'net', v_lineup_cost,
        'lineup_cost', v_lineup_cost,
        'station_grant_refund', v_station_used,
        'station_grant_used', v_station_used,
        'wallet_refund', v_wallet_used,
        'wallet_used', v_wallet_used,
        'wallet_delta', v_wallet_used,
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
        'cost', v_submission_bonus,
        'gross', 0,
        'bonus', 0,
        'net', -v_submission_bonus,
        'lineup_cost', v_lineup_cost,
        'station_grant_used', v_station_used,
        'wallet_used', v_wallet_used,
        'wallet_delta', -v_submission_bonus,
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

-- 修复已撤回但缺少“签约球员撤回”流水的历史记录。
with missing_refunds as (
  select
    l.*,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'player_key', lp.player_key,
            'name', lp.name_zh,
            'name_zh', lp.name_zh,
            'name_en', lp.name_en,
            'price', lp.price,
            'tour', lp.tour
          )
          order by lp.created_at
        )
        from public.tour_manager_lineup_players lp
        where lp.lineup_id = l.id
      ),
      '[]'::jsonb
    ) as players,
    (
      select wl.created_at
      from public.tour_manager_wallet_ledger wl
      where wl.lineup_id = l.id
        and wl.type = 'submit_bonus_reversal'
      order by wl.created_at desc
      limit 1
    ) as reversed_at,
    (
      select wl.balance_after
      from public.tour_manager_wallet_ledger wl
      where wl.lineup_id = l.id
        and wl.type = 'submit_bonus_reversal'
      order by wl.created_at desc
      limit 1
    ) as reversed_balance_after
  from public.tour_manager_lineups l
  where l.status = 'cancelled'
    and coalesce(l.lineup_cost, 0) > 0
    and exists (
      select 1
      from public.tour_manager_wallet_ledger r
      where r.lineup_id = l.id
        and r.type = 'submit_bonus_reversal'
    )
    and not exists (
      select 1
      from public.tour_manager_wallet_ledger f
      where f.lineup_id = l.id
        and f.type = 'lineup_withdraw_refund'
    )
)
insert into public.tour_manager_wallet_ledger (
  user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata, created_at
)
select
  user_id,
  season,
  station_key,
  id,
  'lineup_withdraw_refund',
  greatest(coalesce(lineup_cost, 0), 0),
  coalesce(reversed_balance_after, 0) + greatest(coalesce(submission_bonus, 0), 0),
  '签约球员撤回',
  jsonb_build_object(
    'cost', 0,
    'gross', greatest(coalesce(lineup_cost, 0), 0),
    'bonus', 0,
    'net', greatest(coalesce(lineup_cost, 0), 0),
    'lineup_cost', greatest(coalesce(lineup_cost, 0), 0),
    'station_grant_refund', greatest(coalesce(station_grant_used, 0), 0),
    'station_grant_used', greatest(coalesce(station_grant_used, 0), 0),
    'wallet_refund', greatest(coalesce(wallet_used, 0), 0),
    'wallet_used', greatest(coalesce(wallet_used, 0), 0),
    'wallet_delta', greatest(coalesce(wallet_used, 0), 0),
    'submission_bonus', greatest(coalesce(submission_bonus, 0), 0),
    'players', players,
    'backfilled_by', '202606270006_manager_withdraw_station_grant_refund_ledger'
  ),
  coalesce(reversed_at, now()) - interval '1 millisecond'
from missing_refunds;
