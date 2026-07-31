-- Compact personal prediction summary for the daily-prediction page.
-- "Yesterday" belongs to the previous contest_date, never to the reward
-- ledger creation date, so cross-midnight matches stay with their question day.

create index if not exists tour_manager_daily_prediction_games_contest_date_idx
  on public.tour_manager_daily_prediction_games (contest_date, id);

create index if not exists tour_manager_wallet_ledger_prediction_income_idx
  on public.tour_manager_wallet_ledger (user_id, created_at desc)
  where type = 'daily_prediction_reward' and amount > 0;

create or replace function public.tour_manager_get_my_prediction_summary(
  p_reference_date date default (timezone('Asia/Shanghai', now()))::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_previous_contest_date date := p_reference_date - 1;
begin
  if v_user is null then
    raise exception 'auth_required';
  end if;

  return jsonb_build_object(
    'reference_date', p_reference_date,
    'previous_contest_date', v_previous_contest_date,
    'previous_picks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'pick_id', p.id,
          'game_id', g.id,
          'tour', g.tour,
          'picked_player_key', p.picked_player_key,
          'picked_player_name', p.picked_player_name,
          'is_correct', p.is_correct,
          'reward_amount', p.reward_amount,
          'status', case
            when g.status = 'cancelled' then 'cancelled'
            when p.settled_at is null then 'pending'
            else 'settled'
          end,
          'settled_at', p.settled_at
        )
        order by case g.tour when 'ATP' then 1 when 'WTA' then 2 else 3 end, p.submitted_at, p.id
      )
      from public.tour_manager_daily_prediction_picks p
      join public.tour_manager_daily_prediction_games g on g.id = p.game_id
      where p.user_id = v_user
        and g.contest_date = v_previous_contest_date
    ), '[]'::jsonb),
    'previous_income', coalesce((
      select sum(wl.amount)
      from public.tour_manager_wallet_ledger wl
      where wl.user_id = v_user
        and wl.type = 'daily_prediction_reward'
        and wl.amount > 0
        and exists (
          select 1
          from public.tour_manager_daily_prediction_picks p
          join public.tour_manager_daily_prediction_games g on g.id = p.game_id
          where p.user_id = v_user
            and g.contest_date = v_previous_contest_date
            and wl.metadata ->> 'prediction_pick_id' = p.id::text
        )
    ), 0)::int,
    'previous_pending_count', (
      select count(*)::int
      from public.tour_manager_daily_prediction_picks p
      join public.tour_manager_daily_prediction_games g on g.id = p.game_id
      where p.user_id = v_user
        and g.contest_date = v_previous_contest_date
        and p.settled_at is null
        and g.status <> 'cancelled'
    ),
    'career_income', coalesce((
      select sum(wl.amount)
      from public.tour_manager_wallet_ledger wl
      where wl.user_id = v_user
        and wl.type = 'daily_prediction_reward'
        and wl.amount > 0
    ), 0)::int
  );
end;
$$;

revoke all on function public.tour_manager_get_my_prediction_summary(date)
  from public, anon;
grant execute on function public.tour_manager_get_my_prediction_summary(date)
  to authenticated;
