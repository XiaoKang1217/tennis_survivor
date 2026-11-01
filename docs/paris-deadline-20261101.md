# 巴黎香港截止时间调整

提交、撤回及重新提交截止：北京时间2026-11-02 14:00。后台提交期限通过发布工作流同步，不修改价格、合同、余额或收益。

之前的开售 SQL 已执行，不必重复执行。以下增量 SQL 仅把弹窗后台停止时间由11:00延长到14:00，保留所有账号的已读记录，可重复执行。

```sql
-- Only extend the notice deadline. Existing account receipts remain unchanged.
begin;
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.tour_manager_take_paris_hongkong_opening_notice()'::regprocedure);
  if position('2026-11-02 14:00:00+08' in definition) > 0 then return; end if;
  if position('2026-11-02 11:00:00+08' in definition) = 0 then
    raise exception 'unexpected_paris_notice_definition';
  end if;
  execute replace(definition,'2026-11-02 11:00:00+08','2026-11-02 14:00:00+08');
end;
$$;
commit;

```

