-- 巡回赛经纪人：清理 BYE 首场实际比赛输球的可见错账流水。
--
-- 202606250001 已经把钱包和合同修回正确口径，但会在“我的收益”里显示
-- “错误正收益 + 冲正负收益”。这里把这两条 ledger 都删掉，让用户视角等同于
-- 多发从未发生。
--
-- 若某个环境尚未跑过 202606250001 的历史冲正，本脚本会先扣回未冲正金额，
-- 再删除错误正收益流水。

with wrong_ledger as (
  select
    wl.id as ledger_id,
    wl.user_id,
    wl.season,
    wl.station_key,
    wl.lineup_id,
    wl.amount as wrong_amount,
    wl.metadata,
    wl.metadata->>'event_key' as event_key,
    wl.metadata->>'player_key' as player_key,
    wl.metadata->>'match_key' as match_key,
    wl.metadata->>'round_key' as wrong_round_key
  from public.tour_manager_wallet_ledger wl
  where wl.type = 'player_points_delta'
    and wl.amount > 0
    and upper(coalesce(wl.metadata->>'first_round', '')) = 'BYE'
    and coalesce(wl.metadata->>'bye_first_match_adjusted', 'false') = 'false'
),
validated_wrong as (
  select
    wl.*,
    lp.id as contract_id,
    public.tour_manager_first_round_key(e.draw_size) as correct_round_key,
    public.tour_manager_round_points(
      m.tour,
      e.level,
      public.tour_manager_first_round_key(e.draw_size)
    ) as correct_points
  from wrong_ledger wl
  join public.tour_manager_matches m
    on m.match_key = wl.match_key
   and wl.player_key in (m.player1_key, m.player2_key)
   and m.winner_key is not null
   and m.winner_key <> wl.player_key
  join public.tour_manager_events e
    on e.event_key = m.event_key
  join public.tour_manager_event_players ep
    on ep.event_key = m.event_key
   and ep.player_key = wl.player_key
   and upper(coalesce(ep.first_round, '')) = 'BYE'
  join public.tour_manager_lineup_players lp
    on lp.lineup_id = wl.lineup_id
   and lp.event_key = wl.event_key
   and lp.player_key = wl.player_key
  where m.round_key = public.tour_manager_next_round_key(public.tour_manager_first_round_key(e.draw_size))
),
correction_ledger as (
  select c.id, c.user_id, c.season, c.amount, c.metadata
  from public.tour_manager_wallet_ledger c
  join validated_wrong vw
    on c.metadata->>'correction_for_ledger_id' = vw.ledger_id::text
  where c.type = 'player_points_delta'
    and coalesce(c.metadata->>'correction_reason', '') = 'bye_first_match_loss_duplicate_award'
),
uncorrected_wrong as (
  select vw.*
  from validated_wrong vw
  where not exists (
    select 1
    from correction_ledger c
    where c.metadata->>'correction_for_ledger_id' = vw.ledger_id::text
  )
),
wallet_totals as (
  select user_id, season, sum(wrong_amount)::int as total_wrong
  from uncorrected_wrong
  group by user_id, season
),
wallet_fix as (
  update public.tour_manager_wallets w
  set balance = greatest(0, w.balance - wt.total_wrong)
  from wallet_totals wt
  where w.user_id = wt.user_id
    and w.season = wt.season
  returning w.user_id, w.season, w.balance
),
contract_totals as (
  select
    contract_id,
    max(correct_round_key) as correct_round_key,
    max(correct_points)::int as correct_points,
    sum(wrong_amount)::int as total_wrong,
    max(match_key) as match_key,
    max(wrong_round_key) as wrong_round_key
  from validated_wrong
  group by contract_id
),
contract_fix as (
  update public.tour_manager_lineup_players lp
  set earned_points = ct.correct_points,
      reached_round = ct.correct_round_key,
      metadata = lp.metadata || jsonb_build_object(
        'is_eliminated', true,
        'first_round_key', ct.correct_round_key,
        'bye_first_match_adjusted', true,
        'bye_duplicate_ledgers_removed_at', now(),
        'bye_duplicate_removed_amount', ct.total_wrong,
        'bye_duplicate_removed_match_key', ct.match_key,
        'bye_duplicate_removed_wrong_round', ct.wrong_round_key
      )
  from contract_totals ct
  where lp.id = ct.contract_id
  returning lp.id
),
settlement_fix as (
  update public.tour_manager_settlements s
  set points_delta = 0,
      source = s.source || jsonb_build_object(
        'voided_by', '202606250003_manager_remove_bye_duplicate_ledgers',
        'voided_reason', 'bye_first_match_loss_duplicate_award',
        'voided_at', now()
      )
  from validated_wrong vw
  where s.contract_id = vw.contract_id
    and s.round_key = vw.wrong_round_key
    and s.source->>'match_key' = vw.match_key
    and s.points_delta > 0
  returning s.id
),
delete_corrections as (
  delete from public.tour_manager_wallet_ledger wl
  using correction_ledger c
  where wl.id = c.id
  returning wl.id
),
delete_originals as (
  delete from public.tour_manager_wallet_ledger wl
  using validated_wrong vw
  where wl.id = vw.ledger_id
  returning wl.id
)
select jsonb_build_object(
  'wrong_ledgers_found', (select count(*) from validated_wrong),
  'uncorrected_ledgers_wallet_fixed', (select count(*) from uncorrected_wrong),
  'correction_ledgers_deleted', (select count(*) from delete_corrections),
  'original_ledgers_deleted', (select count(*) from delete_originals),
  'contracts_fixed', (select count(*) from contract_fix),
  'settlements_voided', (select count(*) from settlement_fix),
  'wallets_fixed', (select count(*) from wallet_fix)
) as manager_bye_duplicate_ledger_cleanup;
