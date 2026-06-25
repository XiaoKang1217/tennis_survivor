-- 巡回赛经纪人：修复 BYE 球员首场实际比赛输球的重复结算。
-- 规则：R1 轮空不先发；若首场实际比赛未过关，只发到达首轮分。
-- 关键修复：BYE 首战判断必须由签表事实决定，不能依赖 earned_points = 0。

create or replace function public.tour_manager_first_round_key(p_draw_size int)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_draw_size, 32) > 64 then 'R128'
    when coalesce(p_draw_size, 32) > 32 then 'R64'
    else 'R32'
  end
$$;

create or replace function public.tour_manager_settle_completed_matches(
  p_station_key text,
  p_season int,
  p_settled_for_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_contract record;
  v_player_key text;
  v_reached text;
  v_is_final boolean;
  v_target_points int;
  v_delta int;
  v_balance int;
  v_settlement_id uuid;
  v_settlements int := 0;
  v_points int := 0;
  v_station_events int;
  v_completed_finals int;
  v_combo_count int := 0;
  v_first_round_key text;
  v_first_actual_round_key text;
  v_is_bye_first_match boolean;
  v_is_bye_first_loss boolean;
  v_baseline_round text;
  v_baseline_points int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_required';
  end if;

  update public.tour_manager_lineups l
  set status = 'locked',
      locked_at = coalesce(locked_at, now())
  where l.station_key = p_station_key
    and l.season = p_season
    and l.status = 'submitted'
    and exists (
      select 1
      from public.tour_manager_events e
      where e.station_key = p_station_key
        and e.season = p_season
        and coalesce(e.submission_cutoff_at, e.submission_closes_at) is not null
        and now() > coalesce(e.submission_cutoff_at, e.submission_closes_at)
    );

  for v_match in
    select m.*, e.level, e.draw_size
    from public.tour_manager_matches m
    join public.tour_manager_events e on e.event_key = m.event_key
    where e.station_key = p_station_key
      and e.season = p_season
      and m.status in ('completed','walkover','retired')
      and m.winner_key is not null
      and m.round_key in ('R128','R64','R32','R16','QF','SF','F')
  loop
    for v_player_key in
      select v_match.player1_key
      union all
      select v_match.player2_key
    loop
      if v_player_key is null then
        continue;
      end if;

      for v_contract in
        select lp.*, l.user_id, l.season, l.station_key, ep.first_round
        from public.tour_manager_lineup_players lp
        join public.tour_manager_lineups l on l.id = lp.lineup_id
        left join public.tour_manager_event_players ep
          on ep.event_key = lp.event_key
         and ep.player_key = lp.player_key
        where l.station_key = p_station_key
          and l.season = p_season
          and l.status in ('submitted','locked','settling','settled')
          and lp.event_key = v_match.event_key
          and lp.player_key = v_player_key
          and (v_match.scheduled_at is null or lp.created_at <= v_match.scheduled_at)
          and (lp.replaced_at is null or v_match.scheduled_at is null or v_match.scheduled_at < lp.replaced_at)
      loop
        v_baseline_round := coalesce(v_contract.metadata->>'transfer_baseline_round', 'OUT');
        v_baseline_points := case
          when coalesce(v_contract.metadata->>'transfer_baseline_points', '') ~ '^-?[0-9]+$'
            then greatest((v_contract.metadata->>'transfer_baseline_points')::int, 0)
          else 0
        end;

        v_first_round_key := public.tour_manager_first_round_key(v_match.draw_size);
        v_first_actual_round_key := public.tour_manager_next_round_key(v_first_round_key);
        v_is_bye_first_match :=
          upper(coalesce(v_contract.first_round, '')) = 'BYE'
          and v_baseline_points = 0
          and v_match.round_key = v_first_actual_round_key;
        v_is_bye_first_loss := v_is_bye_first_match and v_player_key <> v_match.winner_key;

        if v_player_key = v_match.winner_key then
          v_reached := public.tour_manager_next_round_key(v_match.round_key);
          v_is_final := v_reached = 'W';
        else
          v_reached := case
            when v_is_bye_first_loss then v_first_round_key
            else v_match.round_key
          end;
          v_is_final := true;
        end if;

        v_target_points := public.tour_manager_round_points(v_match.tour, v_match.level, v_reached);

        if public.tour_manager_round_order(v_reached) > public.tour_manager_round_order(v_contract.reached_round) then
          update public.tour_manager_lineup_players
          set reached_round = v_reached,
              metadata = metadata || jsonb_build_object(
                'last_settled_match_key', v_match.match_key,
                'last_settled_round', v_match.round_key,
                'is_eliminated', v_is_final and v_reached <> 'W',
                'first_round_key', v_first_round_key,
                'bye_first_match_adjusted', v_is_bye_first_loss
              )
          where id = v_contract.id;
        end if;

        v_delta := greatest(v_target_points - v_baseline_points - coalesce(v_contract.earned_points, 0), 0);
        if v_delta <= 0 then
          continue;
        end if;

        v_settlement_id := null;
        insert into public.tour_manager_settlements (
          lineup_id, contract_id, user_id, event_key, player_key, round_key,
          points_delta, is_final, source, settled_for_date
        )
        values (
          v_contract.lineup_id, v_contract.id, v_contract.user_id,
          v_match.event_key, v_player_key, v_reached,
          v_delta, v_is_final,
          jsonb_build_object(
            'match_key', v_match.match_key,
            'source_url', v_match.source_url,
            'winner_key', v_match.winner_key,
            'scheduled_at', v_match.scheduled_at,
            'target_points', v_target_points,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          ),
          p_settled_for_date
        )
        on conflict (contract_id, round_key) do nothing
        returning id into v_settlement_id;

        if v_settlement_id is null then
          continue;
        end if;

        update public.tour_manager_lineup_players
        set earned_points = earned_points + v_delta
        where id = v_contract.id;

        update public.tour_manager_wallets
        set balance = balance + v_delta
        where user_id = v_contract.user_id and season = v_contract.season
        returning balance into v_balance;

        insert into public.tour_manager_wallet_ledger (
          user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
        )
        values (
          v_contract.user_id, v_contract.season, v_contract.station_key, v_contract.lineup_id,
          'player_points_delta', v_delta, v_balance,
          '球员收益结算',
          jsonb_build_object(
            'event_key', v_match.event_key,
            'player_key', v_player_key,
            'round_key', v_reached,
            'match_key', v_match.match_key,
            'is_final', v_is_final,
            'target_points', v_target_points,
            'transfer_baseline_round', v_baseline_round,
            'transfer_baseline_points', v_baseline_points,
            'already_earned_points', coalesce(v_contract.earned_points, 0),
            'first_round', v_contract.first_round,
            'first_round_key', v_first_round_key,
            'first_actual_round_key', v_first_actual_round_key,
            'bye_first_match_adjusted', v_is_bye_first_loss
          )
        );

        v_settlements := v_settlements + 1;
        v_points := v_points + v_delta;
        v_settlement_id := null;
      end loop;
    end loop;
  end loop;

  update public.tour_manager_lineups
  set status = 'settling'
  where station_key = p_station_key
    and season = p_season
    and status = 'locked'
    and exists (
      select 1
      from public.tour_manager_lineup_players lp
      where lp.lineup_id = tour_manager_lineups.id
        and lp.earned_points > 0
    );

  select count(*) into v_station_events
  from public.tour_manager_events
  where station_key = p_station_key
    and season = p_season
    and market_status <> 'cancelled';

  select count(distinct e.event_key) into v_completed_finals
  from public.tour_manager_events e
  join public.tour_manager_matches m
    on m.event_key = e.event_key
   and m.round_key = 'F'
   and m.status in ('completed','walkover','retired')
   and m.winner_key is not null
  where e.station_key = p_station_key
    and e.season = p_season
    and e.market_status <> 'cancelled';

  if v_station_events > 0 and v_completed_finals = v_station_events then
    v_combo_count := public.tour_manager_apply_station_combo(p_station_key, p_season);
    update public.tour_manager_events
    set market_status = 'settled'
    where station_key = p_station_key
      and season = p_season
      and market_status in ('open','locked');
  end if;

  return jsonb_build_object(
    'station_key', p_station_key,
    'season', p_season,
    'settlements', v_settlements,
    'points_delta', v_points,
    'combo_lineups', v_combo_count,
    'finals_completed', v_completed_finals,
    'event_count', v_station_events
  );
end;
$$;

revoke all on function public.tour_manager_settle_completed_matches(text, int, date) from public, anon, authenticated;
grant execute on function public.tour_manager_settle_completed_matches(text, int, date) to service_role;

-- 历史冲正：把已经按 R16 补发的 BYE 首战输球收益冲回到首轮分。
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
    and wl.metadata->>'first_round' = 'BYE'
    and wl.metadata->>'bye_first_match_adjusted' = 'false'
    and not exists (
      select 1
      from public.tour_manager_wallet_ledger c
      where c.type = 'player_points_delta'
        and c.amount = -wl.amount
        and c.metadata->>'correction_for_ledger_id' = wl.id::text
    )
),
validated_wrong as (
  select
    wl.*,
    lp.id as contract_id,
    public.tour_manager_first_round_key(e.draw_size) as correct_round_key,
    public.tour_manager_round_points(m.tour, e.level, public.tour_manager_first_round_key(e.draw_size)) as correct_points
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
wallet_totals as (
  select user_id, season, sum(wrong_amount)::int as total_wrong
  from validated_wrong
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
        'bye_duplicate_repaired_at', now(),
        'bye_duplicate_repaired_amount', ct.total_wrong,
        'bye_duplicate_repaired_match_key', ct.match_key,
        'bye_duplicate_repaired_wrong_round', ct.wrong_round_key
      )
  from contract_totals ct
  where lp.id = ct.contract_id
  returning lp.id
),
settlement_fix as (
  update public.tour_manager_settlements s
  set points_delta = 0,
      source = s.source || jsonb_build_object(
        'voided_by', '202606250001_manager_bye_first_match_idempotent_repair',
        'voided_reason', 'bye_first_match_loss_duplicate_award',
        'voided_at', now()
      )
  from validated_wrong vw
  where s.contract_id = vw.contract_id
    and s.round_key = vw.wrong_round_key
    and s.source->>'match_key' = vw.match_key
    and s.points_delta > 0
  returning s.id
)
insert into public.tour_manager_wallet_ledger (
  user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata
)
select
  vw.user_id,
  vw.season,
  vw.station_key,
  vw.lineup_id,
  'player_points_delta',
  -vw.wrong_amount,
  wf.balance,
  '轮空首战重复结算冲正',
  jsonb_build_object(
    'event_key', vw.event_key,
    'player_key', vw.player_key,
    'match_key', vw.match_key,
    'round_key', vw.wrong_round_key,
    'correct_round_key', vw.correct_round_key,
    'correct_points', vw.correct_points,
    'correction_for_ledger_id', vw.ledger_id::text,
    'correction_reason', 'bye_first_match_loss_duplicate_award',
    'original_amount', vw.wrong_amount,
    'migration', '202606250001_manager_bye_first_match_idempotent_repair'
  )
from validated_wrong vw
left join wallet_fix wf
  on wf.user_id = vw.user_id
 and wf.season = vw.season;
