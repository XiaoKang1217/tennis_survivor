begin;

update public.tour_manager_events
set submission_cutoff_at = timestamptz '2026-10-19 11:00:00+08',
    submission_closes_at = timestamptz '2026-10-19 11:00:00+08'
where station_key = '2026-w43-almaty-ningbo' and season = 2026
  and event_key in ('atp-2026-w43-almaty', 'wta-2026-w43-ningbo');

create or replace function public.tour_manager_take_almaty_ningbo_opening_notice()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inserted uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if now() >= timestamptz '2026-10-19 11:00:00+08'
    or not exists(select 1 from public.tour_manager_station_configs
      where station_key='2026-w43-almaty-ningbo' and season=2026) then return null; end if;
  insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
    values(v_user,'almaty_ningbo_2026_opening') on conflict do nothing
    returning user_id into v_inserted;
  if v_inserted is null then return null; end if;
  return jsonb_build_object('message','经纪人新站ATP阿拉木图+WTA宁波开售！快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_almaty_ningbo_opening_notice() from public, anon;
grant execute on function public.tour_manager_take_almaty_ningbo_opening_notice() to authenticated;

commit;

select event_key, submission_cutoff_at, submission_closes_at
from public.tour_manager_events
where station_key = '2026-w43-almaty-ningbo' and season = 2026
order by event_key;
