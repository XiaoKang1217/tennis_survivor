begin;

create unique index if not exists manager_beijing_rublev_reward_once
  on public.tour_manager_wallet_ledger(user_id, season)
  where type = 'beijing_rublev_r1_reward_2026';

do $$
declare
  r record;
  v_before int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('beijing_rublev_r1_reward_2026', 0));
  for r in
    select id, user_id from public.tour_manager_lineups
    where season = 2026 and station_key = '2026-w40-beijing'
      and status in ('submitted', 'locked', 'settling', 'settled')
    order by user_id
  loop
    select balance into strict v_before from public.tour_manager_wallets
      where user_id = r.user_id and season = 2026 for update;
    v_id := null;
    insert into public.tour_manager_wallet_ledger
      (user_id, season, station_key, lineup_id, type, amount, balance_after, description, metadata)
    values (r.user_id, 2026, '2026-w40-beijing', r.id,
      'beijing_rublev_r1_reward_2026', 300, v_before + 300,
      '庆祝卢布列夫北京第一轮赢球',
      jsonb_build_object('campaign_key', 'beijing_rublev_r1_reward_2026',
        'balance_before', v_before, 'cost', 0, 'gross', 0, 'bonus', 300, 'net', 300,
        'notice_message', '庆祝卢布列夫北京第一轮成功通关，故发放300本金作为还愿本金。祝大家玩的愉快！也祝炉子取得好成绩'))
    on conflict (user_id, season) where type = 'beijing_rublev_r1_reward_2026'
    do nothing returning id into v_id;
    if v_id is not null then
      update public.tour_manager_wallets set balance = balance + 300, updated_at = now()
        where user_id = r.user_id and season = 2026;
    end if;
  end loop;
end;
$$;

create or replace function public.tour_manager_get_beijing_reward_notice()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('message', metadata->>'notice_message', 'amount', amount)
  from public.tour_manager_wallet_ledger
  where user_id = auth.uid() and season = 2026
    and type = 'beijing_rublev_r1_reward_2026'
    and metadata->>'notice_acknowledged_at' is null;
$$;

create or replace function public.tour_manager_ack_beijing_reward_notice()
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.tour_manager_wallet_ledger
    set metadata = metadata || jsonb_build_object('notice_acknowledged_at', now())
    where user_id = auth.uid() and season = 2026
      and type = 'beijing_rublev_r1_reward_2026'
      and metadata->>'notice_acknowledged_at' is null;
  return exists(select 1 from public.tour_manager_wallet_ledger
    where user_id = auth.uid() and season = 2026
      and type = 'beijing_rublev_r1_reward_2026'
      and metadata->>'notice_acknowledged_at' is not null);
end;
$$;

revoke all on function public.tour_manager_get_beijing_reward_notice() from public, anon;
revoke all on function public.tour_manager_ack_beijing_reward_notice() from public, anon;
grant execute on function public.tour_manager_get_beijing_reward_notice() to authenticated;
grant execute on function public.tour_manager_ack_beijing_reward_notice() to authenticated;

commit;
