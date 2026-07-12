-- 徽章商城陈列信息：不改变购买、扣款和佩戴逻辑，只补齐可展示的商品字段。

alter table public.tour_manager_badges
  add column if not exists formal_name text,
  add column if not exists story text,
  add column if not exists serial_number text,
  add column if not exists category text,
  add column if not exists motifs text[] not null default '{}'::text[],
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz;

create unique index if not exists tour_manager_badges_serial_number_idx
on public.tour_manager_badges(serial_number)
where serial_number is not null;

update public.tour_manager_badges
set
  image_url = case badge_key
    when 'sinner-fox' then 'assets/manager/badges/ui-v5/sinner-badge.png'
    when 'alcaraz-duck' then 'assets/manager/badges/ui-v5/alcaraz-badge-final-hq.png'
    when 'djoko-goat' then 'assets/manager/badges/ui-v5/djokovic-badge.png'
    when 'rublev-cat' then 'assets/manager/badges/ui-v5/lubu-badge.png'
    when 'zheng-queen' then 'assets/manager/badges/ui-v5/zheng-badge.png'
    when 'wang-xinyu-mermaid' then 'assets/manager/badges/ui-v5/mermaid-badge.png'
    when 'luwang-friend' then 'assets/manager/badges/ui-v5/luwang-badge.png'
    when 'wimbledon-2026' then 'assets/manager/badges/ui-v5/wimbledon-badge.png'
    else image_url
  end,
  thumb_url = case badge_key
    when 'sinner-fox' then 'assets/manager/badges/ui-v5/sinner-badge.png'
    when 'alcaraz-duck' then 'assets/manager/badges/ui-v5/alcaraz-badge-final-hq.png'
    when 'djoko-goat' then 'assets/manager/badges/ui-v5/djokovic-badge.png'
    when 'rublev-cat' then 'assets/manager/badges/ui-v5/lubu-badge.png'
    when 'zheng-queen' then 'assets/manager/badges/ui-v5/zheng-badge.png'
    when 'wang-xinyu-mermaid' then 'assets/manager/badges/ui-v5/mermaid-badge.png'
    when 'luwang-friend' then 'assets/manager/badges/ui-v5/luwang-badge.png'
    when 'wimbledon-2026' then 'assets/manager/badges/ui-v5/wimbledon-badge.png'
    else thumb_url
  end,
  metadata = (coalesce(metadata, '{}'::jsonb) - 'test_badge') || jsonb_build_object(
    'theme', case badge_key
      when 'sinner-fox' then 'sinner_fox'
      when 'alcaraz-duck' then 'alcaraz_duck'
      when 'djoko-goat' then 'djoko_goat'
      when 'rublev-cat' then 'rublev_cat'
      when 'zheng-queen' then 'zheng_queen'
      when 'wang-xinyu-mermaid' then 'wang_mermaid'
      when 'luwang-friend' then 'luwang_friend'
      when 'wimbledon-2026' then 'wimbledon_2026'
      else metadata->>'theme'
    end
  ),
  formal_name = case badge_key
    when 'sinner-fox' then '辛纳·赤焰狐心'
    when 'alcaraz-duck' then '阿卡·星辉少年冠'
    when 'djoko-goat' then '德约·24冠回环'
    when 'rublev-cat' then '卢布·喵喵王子'
    when 'zheng-queen' then '郑钦文·女王风范'
    when 'wang-xinyu-mermaid' then '王欣瑜·美人鱼'
    when 'luwang-friend' then '炉网挚友·时间共振章'
    when 'wimbledon-2026' then '2026温网限定·仲夏草地书'
    else coalesce(formal_name, title)
  end,
  serial_number = case badge_key
    when 'sinner-fox' then 'LW-2026-01'
    when 'alcaraz-duck' then 'LW-2026-02'
    when 'djoko-goat' then 'LW-2026-03'
    when 'rublev-cat' then 'LW-2026-04'
    when 'zheng-queen' then 'LW-2026-05'
    when 'wang-xinyu-mermaid' then 'LW-2026-06'
    when 'luwang-friend' then 'LW-FOREVER-01'
    when 'wimbledon-2026' then 'W26-LIMITED'
    else serial_number
  end,
  category = case
    when badge_key = 'wimbledon-2026' then 'event'
    when badge_key = 'luwang-friend' then 'community'
    else 'player'
  end,
  motifs = case badge_key
    when 'sinner-fox' then array['赤狐','冰蓝浪涌','冷静炽热']
    when 'alcaraz-duck' then array['星辉','少年锋芒','小黄鸭']
    when 'djoko-goat' then array['24冠','四大满贯','时间回环']
    when 'rublev-cat' then array['蓝金宫廷','猫爪','率真']
    when 'zheng-queen' then array['紫金','王冠','中国力量']
    when 'wang-xinyu-mermaid' then array['珍珠','海浪','流动锋芒']
    when 'luwang-friend' then array['四季','炉火网球','长久陪伴']
    when 'wimbledon-2026' then array['草地','草莓','仲夏典藏']
    else motifs
  end,
  available_from = case
    when badge_key = 'wimbledon-2026' then timestamptz '2026-06-29 00:00:00+08'
    else coalesce(available_from, timestamptz '2026-07-12 00:00:00+08')
  end,
  available_until = case
    when badge_key = 'wimbledon-2026' then timestamptz '2026-07-12 23:59:59+08'
    else available_until
  end,
  description = case badge_key
    when 'sinner-fox' then '他以赤狐般的敏锐穿过冰蓝浪涌，把炽热天赋藏进近乎冷静的每一次击球。'
    when 'alcaraz-duck' then '他把晚霞般的热烈带进每一次奔跑，连身旁的小黄鸭也像在替少年喝彩。'
    when 'djoko-goat' then '二十四座大满贯沿时间成环，他站在四种场地中央，把漫长岁月变成秩序。'
    when 'rublev-cat' then '他把赛场上的锋利留给每一拍，把不设防的温柔留给猫与真心。'
    when 'zheng-queen' then '她在紫金光芒中举起拳头，王冠不是装饰，而是一步步赢来的自我确信。'
    when 'wang-xinyu-mermaid' then '她从珍珠与海浪间回望，柔美不是退让，而是另一种流动的力量。'
    when 'luwang-friend' then '四季围绕同一团炉火流转，陪伴让每一站比赛都在时间里留下回声。'
    when 'wimbledon-2026' then '草地、白衣、草莓与伦敦天际被写进一册仲夏限定，只在这一年的夏天翻开。'
    else description
  end,
  story = case badge_key
    when 'sinner-fox' then '赤狐站在冰蓝浪涌与金色枝叶之间，火焰般的毛色映着沉静的目光。他很少用喧哗证明自己，只让速度、精准与稳定替他发声。最打动人的，是炽热与克制同时存在：天赋在燃烧，心却始终安静地指向下一分。'
    when 'alcaraz-duck' then '星辉落在粉紫色的球场上，他挥拍时仍带着少年最明亮的笑意。小黄鸭守在身旁，像把天真、勇气与旺盛生命力一同留进徽章里。他并不掩饰对胜利的渴望，也从不丢掉享受网球的本能；正是这种毫无保留的热烈，让他的冠军之路始终像破晓一样新鲜。'
    when 'djoko-goat' then '四种场地在徽章中彼此相连，二十四枚冠军刻度沿金色轨道循环不息。他站在回环中央，像站在自己跨越时代的全部答案之中。那些数字并不只代表胜利，也代表一次次重返、修正与坚持；真正令它动人的，是他把漫长职业生涯活成了近乎精密的意志。'
    when 'rublev-cat' then '蓝金宫廷环抱着他，猫耳、猫爪与小小的守护者藏在华丽纹章之间。赛场上的他用重击表达决心，场外的他却保留着近乎笨拙的真诚。这枚徽章最动人的地方，不是王子的冠冕，而是锋芒之下那颗从未学会伪装的柔软之心。'
    when 'zheng-queen' then '紫金冠冕、城市天际与向外绽放的光芒把她推向画面中央。她握拍而立、拳头收紧，目光里没有等待加冕的犹疑。女王风范并非高高在上，而是她一次次在压力中选择进攻、选择相信自己；这枚徽章所纪念的，正是力量被她握在手中的瞬间。'
    when 'wang-xinyu-mermaid' then '珍珠、贝壳与海水青包围着她，鱼尾在浪纹中舒展，球拍则把童话重新牵回赛场。她的美从不依赖静止：长线条、轻盈步伐与突然加速，让温柔拥有了锋面。这枚徽章记录的，是她在浪潮里保持优雅，也保持向前的力量。'
    when 'luwang-friend' then '春花、盛夏、秋叶与冬雪环绕同一枚燃烧的网球，四季在这里不是背景，而是一同走过的时间。它不属于某一场胜利，而属于每一次守候、讨论与共同心跳。真正让人珍惜的，是多年以后再看见它，仍能想起那些与炉友一起等待比赛开始的夜晚。'
    when 'wimbledon-2026' then '象牙色书页上铺开温布尔登的草地，白衣球员跃起击球，草莓、花叶与伦敦轮廓沿金边生长。它像一本只在仲夏开放的收藏册，把礼仪、传统与短暂盛夏同时封存。最动人的不是“限定”，而是人们明知夏天会结束，仍愿意认真记住这一年的每一片草。'
    else story
  end,
  subtitle = case
    when badge_key = 'wimbledon-2026' then '赛事限定'
    when badge_key = 'luwang-friend' then '炉友纪念'
    else '球员纪念'
  end,
  updated_at = now()
where badge_key in (
  'sinner-fox','alcaraz-duck','djoko-goat','rublev-cat',
  'zheng-queen','wang-xinyu-mermaid','luwang-friend','wimbledon-2026'
);
