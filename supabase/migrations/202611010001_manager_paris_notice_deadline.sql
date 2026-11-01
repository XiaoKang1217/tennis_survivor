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
