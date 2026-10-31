# 巴黎 + 香港上线后执行 SQL

在 Supabase SQL Editor 中执行下方完整 SQL。可重复执行，不修改用户余额、阵容或既有收益。

作用：稳健经营支持本站16强门槛，旧站仍默认8强；新增账号级一次性开售弹窗，2026-11-02 11:00北京时间自动停止。

请在本站首次 Combo 结算前执行。Git 发布和市场同步不等待此 SQL；未执行时弹窗接口及后台16强门槛尚未就绪。

```sql
-- Preserve existing settlement locking, daily deltas and ledger detail structure.
-- This migration does not settle games or modify balances/contracts.
begin;
do $migration$
declare definition text; old_count text; old_detail text;
begin
  definition := pg_get_functiondef('public.tour_manager_apply_canada_combo_v1(text,integer)'::regprocedure);
  if position('v_steady_round text' in definition) = 0 then
    old_count := 'count(*) filter (where is_active and public.tour_manager_round_order(coalesce(reached_round, ''OUT'')) >= public.tour_manager_round_order(''QF''))';
    old_detail := 'and is_active
          and public.tour_manager_round_order(coalesce(reached_round, ''OUT'')) >= public.tour_manager_round_order(''QF'')';
    if position(old_count in definition) = 0 or position(old_detail in definition) = 0
       or position('v_steady_cap int;' in definition) = 0 then
      raise exception 'unexpected_canada_combo_definition';
    end if;
    definition := replace(definition,'v_steady_cap int;', 'v_steady_cap int; v_steady_round text;');
    definition := replace(definition,'v_combo_cap :=',
      'v_steady_round := case when v_combo #>> ''{steady,qualifying_round}'' = ''R16'' then ''R16'' else ''QF'' end; v_combo_cap :=');
    definition := replace(definition,old_count,replace(old_count,'''QF''','v_steady_round'));
    definition := replace(definition,old_detail,replace(old_detail,'''QF''','v_steady_round'));
    execute definition;
  end if;
end;
$migration$;

create or replace function public.tour_manager_take_paris_hongkong_opening_notice()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inserted uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if now() >= timestamptz '2026-11-02 11:00:00+08'
    or not exists(select 1 from public.tour_manager_station_configs
      where station_key='2026-w45-paris-hongkong' and season=2026) then return null; end if;
  insert into public.tour_manager_opening_notice_receipts(user_id,notice_key)
    values(v_user,'paris_hongkong_2026_opening') on conflict do nothing
    returning user_id into v_inserted;
  if v_inserted is null then return null; end if;
  return jsonb_build_object('message','经纪人新站ATP巴黎+WTA香港开售！快来选购吧。');
end;
$$;
revoke all on function public.tour_manager_take_paris_hongkong_opening_notice() from public, anon;
grant execute on function public.tour_manager_take_paris_hongkong_opening_notice() to authenticated;
commit;

```

