-- 巡回赛经纪人：大满贯本站签约金改为每条线 1250。
-- 温网 ATP + WTA 合计 2500，和前端规则、市场预算保持一致。

create or replace function public.tour_manager_level_side_grant(p_level text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_level, '500'))
    when '250' then 45
    when '500' then 65
    when '1000' then 120
    when 'GS' then 1250
    else 65
  end
$$;
