-- Keep the existing full-season three-use enforcement (including cancelled
-- discounted submissions), but define the calendar year in the site's timezone.
-- No wallets or historical ledgers are changed by this migration.
begin;
do $migration$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_updated text;
begin
  foreach v_name in array array['tour_manager_submit_lineup', 'tour_manager_get_my_state'] loop
    select p.oid into strict v_oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name;
    v_definition := pg_get_functiondef(v_oid);
    if position('welfare_discount > 0' in v_definition)=0 then
      raise exception 'Missing full-season welfare accounting: %', v_name;
    end if;
    if v_name='tour_manager_submit_lineup' and
       (position('v_welfare_uses < v_welfare_max_uses' in v_definition)=0 or
        position('for update' in lower(v_definition))=0) then
      raise exception 'Missing serialized welfare enforcement';
    end if;
    v_updated := replace(v_definition,
      'make_timestamptz(p_season, 1, 1, 0, 0, 0, ''UTC'')',
      'make_timestamptz(p_season, 1, 1, 0, 0, 0, ''Asia/Shanghai'')');
    v_updated := replace(v_updated,
      'make_timestamptz(p_season + 1, 1, 1, 0, 0, 0, ''UTC'')',
      'make_timestamptz(p_season + 1, 1, 1, 0, 0, 0, ''Asia/Shanghai'')');
    if position('make_timestamptz(p_season, 1, 1, 0, 0, 0, ''Asia/Shanghai'')' in v_updated)=0 or
       position('make_timestamptz(p_season + 1, 1, 1, 0, 0, 0, ''Asia/Shanghai'')' in v_updated)=0 then
      raise exception 'Unexpected welfare date definition: %', v_name;
    end if;
    if v_updated<>v_definition then execute v_updated; end if;
  end loop;
end $migration$;
commit;
