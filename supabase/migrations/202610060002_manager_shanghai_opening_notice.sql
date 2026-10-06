begin;
create table if not exists public.tour_manager_opening_notice_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_key text not null,
  shown_at timestamptz not null default now(),
  primary key (user_id, notice_key)
);
alter table public.tour_manager_opening_notice_receipts enable row level security;
revoke all on public.tour_manager_opening_notice_receipts from anon, authenticated;

create or replace function public.tour_manager_take_shanghai_opening_notice()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inserted uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if now() >= timestamptz '2026-10-07 11:45:00+08'
    or not exists(select 1 from public.tour_manager_station_configs
      where station_key='2026-w41-shanghai' and season=2026) then
    return null;
  end if;
  insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
    values(v_user,'shanghai_2026_opening') on conflict do nothing
    returning user_id into v_inserted;
  if v_inserted is null then return null; end if;
  return jsonb_build_object('message','经纪人新站ATP 上海1000赛开售！快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_shanghai_opening_notice() from public, anon;
grant execute on function public.tour_manager_take_shanghai_opening_notice() to authenticated;
commit;
