begin;

create unique index if not exists manager_beijing_window_compensation_once
  on public.tour_manager_wallet_ledger(user_id, season)
  where type = 'beijing_window_compensation_2026';

do $$
declare
  r record;
  v_before int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('beijing_window_compensation_2026', 0));
  for r in
    select distinct on (user_id) id, user_id from public.tour_manager_lineups
    where season = 2026 and station_key = '2026-w40-beijing'
      and status in ('submitted', 'locked', 'settling', 'settled')
    order by user_id, submitted_at desc nulls last, id
  loop
    select balance into strict v_before from public.tour_manager_wallets
      where user_id = r.user_id and season = 2026 for update;
    v_id := null;
    insert into public.tour_manager_wallet_ledger
      (user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata)
    values (r.user_id, 2026, '2026-w40-beijing', r.id,
      'beijing_window_compensation_2026', 500, v_before + 500,
      '忘记开启北京换人窗口补偿',
      jsonb_build_object('campaign_key', 'beijing_window_compensation_2026',
        'balance_before', v_before, 'cost', 0, 'gross', 0, 'bonus', 500, 'net', 500,
        'notice_title', '补偿本金已到账',
        'notice_message', '不好意思，因为有无良用户把站长气着了，这一站忘开换人窗口了。故发放500本金作为补偿。祝大家玩的愉快！'))
    on conflict (user_id, season) where type = 'beijing_window_compensation_2026'
    do nothing returning id into v_id;
    if v_id is not null then
      update public.tour_manager_wallets set balance = balance + 500, updated_at = now()
        where user_id = r.user_id and season = 2026;
    end if;
  end loop;
end;
$$;

-- Keep the previous campaign RPCs unchanged for cached clients.
create or replace function public.tour_manager_get_principal_reward_notice()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id', id, 'message', metadata->>'notice_message',
    'amount', amount, 'title', coalesce(metadata->>'notice_title', '还愿本金已到账'))
  from public.tour_manager_wallet_ledger
  where user_id = auth.uid() and season = 2026
    and type in ('beijing_rublev_r1_reward_2026', 'beijing_window_compensation_2026')
    and metadata->>'notice_acknowledged_at' is null
  order by created_at desc, id desc limit 1;
$$;

create or replace function public.tour_manager_ack_principal_reward_notice(p_notice_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.tour_manager_wallet_ledger
    set metadata = metadata || jsonb_build_object('notice_acknowledged_at', now())
    where id = p_notice_id and user_id = auth.uid() and season = 2026
      and type in ('beijing_rublev_r1_reward_2026', 'beijing_window_compensation_2026')
      and metadata->>'notice_acknowledged_at' is null;
  return exists(select 1 from public.tour_manager_wallet_ledger
    where id = p_notice_id and user_id = auth.uid() and season = 2026
      and type in ('beijing_rublev_r1_reward_2026', 'beijing_window_compensation_2026')
      and metadata->>'notice_acknowledged_at' is not null);
end;
$$;

revoke all on function public.tour_manager_get_principal_reward_notice() from public, anon;
revoke all on function public.tour_manager_ack_principal_reward_notice(uuid) from public, anon;
grant execute on function public.tour_manager_get_principal_reward_notice() to authenticated;
grant execute on function public.tour_manager_ack_principal_reward_notice(uuid) to authenticated;

commit;
