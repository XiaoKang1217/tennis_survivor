-- 巡回赛经纪人：本站签约金是赛站额度，不应随“撤回后重新提交”重复发放流水。
-- 这条 migration 只处理 station_grant_issued；提交、撤回、支出、奖励等真实流水不去重。

with ranked_station_grants as (
  select
    id,
    row_number() over (
      partition by user_id, season, station_key, type
      order by created_at asc, id asc
    ) as rn
  from public.tour_manager_wallet_ledger
  where type = 'station_grant_issued'
)
delete from public.tour_manager_wallet_ledger wl
using ranked_station_grants r
where wl.id = r.id
  and r.rn > 1;

create unique index if not exists tour_manager_wallet_ledger_one_station_grant_idx
on public.tour_manager_wallet_ledger (user_id, season, station_key)
where type = 'station_grant_issued';

create or replace function public.tour_manager_skip_duplicate_station_grant_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'station_grant_issued'
     and exists (
       select 1
       from public.tour_manager_wallet_ledger wl
       where wl.user_id = new.user_id
         and wl.season = new.season
         and wl.station_key = new.station_key
         and wl.type = 'station_grant_issued'
     ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists tour_manager_skip_duplicate_station_grant_ledger
on public.tour_manager_wallet_ledger;

create trigger tour_manager_skip_duplicate_station_grant_ledger
before insert on public.tour_manager_wallet_ledger
for each row
execute function public.tour_manager_skip_duplicate_station_grant_ledger();
