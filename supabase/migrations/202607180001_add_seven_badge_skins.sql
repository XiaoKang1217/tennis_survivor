-- 徽章商城：新增七款正式皮肤。沿用既有购买、扣款、佩戴和流水 RPC。

insert into public.tour_manager_badges (
  badge_key,
  title,
  formal_name,
  subtitle,
  description,
  story,
  serial_number,
  category,
  motifs,
  price,
  image_url,
  thumb_url,
  rarity,
  is_active,
  sort_order,
  available_from,
  available_until,
  metadata
)
values
  (
    'gauff-energy', '高芙果切能量', '高芙·果切能量', '球员纪念',
    '一篮鲜果把笑意染得明亮，飞奔与挥拍则让这份快乐拥有了真正的力量。',
    '草莓、蓝莓、菠萝和网球围成一圈明亮的能量轨道，她抱着果篮笑得毫无保留。她的力量从来不只有速度和爆发，也来自年轻人愿意享受比赛、重新出发的生命力。徽章把她的快乐画成可以分享的果切：鲜活、丰盛，带着一眼就能被感染的温度。',
    'LW-2026-07', 'player', array['果切能量','灿烂笑意','年轻生命力'], 2599,
    'assets/manager/badges/ui-v18/optimized/gauff-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/gauff-badge-640.webp',
    'limited', true, 90, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','gauff_energy','category_label','球员纪念')
  ),
  (
    'swiatek-whirlwind', '斯瓦泰克旋风少女', '斯瓦泰克·旋风少女', '球员纪念',
    '风线刚刚卷起，比赛已进入她熟悉的高速秩序；冷静，是旋风最锋利的中心。',
    '冰蓝风线绕着她的球拍旋转，红土从脚下扬起，网球像被卷入一条只属于她的高速轨道。她看起来安静，出手却从不迟疑；她用阅读比赛的速度抢走时间，再用持续施压把优势变成秩序。徽章最动人的地方，是那股冷静外表下始终向前的风。',
    'LW-2026-08', 'player', array['冰蓝旋风','红土脚步','冷静压迫'], 2599,
    'assets/manager/badges/ui-v18/optimized/swiatek-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/swiatek-badge-640.webp',
    'limited', true, 100, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','swiatek_whirlwind','category_label','球员纪念')
  ),
  (
    'alcaraz-bee-duck', '阿卡蜜蜂鸭', '阿卡·蜜蜂鸭', '球员纪念',
    '蜂巢里藏着怎样的少年感？是全力追球的认真，也是蜜蜂、小鸭和绒毛共同托住的可爱。',
    '毛茸茸的少年伏在蜂巢球场上，蜜蜂守着他的冲劲，小鸭替他保留顽皮，网球则停在下一次爆发之前。画面没有削弱他的竞争心，反而把那份全力以赴衬得更真：他可以为每一分飞奔，也会在胜负之外留下明亮笑意。锋芒与柔软同时存在，正是这枚徽章最珍贵的反差。',
    'LW-2026-09', 'player', array['萌系','蜜蜂与小鸭','少年冲劲'], 2999,
    'assets/manager/badges/ui-v18/optimized/bee-duck-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/bee-duck-badge-640.webp',
    'limited', true, 110, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','alcaraz_bee_duck','category_label','球员纪念')
  ),
  (
    'who-is-leather', '谁是皮革', '谁是皮革', '炉友纪念',
    '一只简单的皮革，简单往往代表着快乐。',
    '真的只是一只简单的皮革，没有复杂的文案。',
    'LW-PIG-01', 'community', array['粉色小猪','卷尾暗号','极简幽默'], 599,
    'assets/manager/badges/ui-v18/optimized/who-leather-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/who-leather-badge-640.webp',
    'limited', true, 120, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','who_is_leather','category_label','炉友纪念')
  ),
  (
    'rotten-cabbage', '烂白菜烂之泪伤', '烂白菜·烂之泪伤', '球员纪念',
    '很烂，很白，很菜。',
    '只有烂，纯粹的烂。',
    'LW-2026-10', 'player', array['躺平菜帮','一滴眼泪','温柔自嘲'], 199,
    'assets/manager/badges/ui-v18/optimized/rotten-cabbage-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/rotten-cabbage-badge-640.webp',
    'limited', true, 130, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','rotten_cabbage','category_label','球员纪念')
  ),
  (
    'federer-eternal', '费德勒优雅永恒', '费德勒·优雅永恒', '球员纪念',
    '一道珍珠金的回环掠过球拍；胜利之外，那个让网球显得如此优雅的时代也随之回来。',
    '珍珠白、雾银蓝与香槟金在他身后汇成无限回环，他的手臂舒展，球拍穿过光带，动作仍像记忆里那样轻盈。王冠和 RF 纹章记录荣誉，画面中央更重要的却是那份从容：他把最复杂的技术打成自然，把漫长时代留成一种审美。徽章纪念的，是胜负之外依然不会褪色的优雅。',
    'LW-2026-11', 'player', array['无限光带','RF王冠','从容挥拍'], 2999,
    'assets/manager/badges/ui-v18/optimized/federer-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/federer-badge-640.webp',
    'limited', true, 140, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','federer_eternal','category_label','球员纪念')
  ),
  (
    'nadal-clay-soul', '纳达尔赤土之魂', '纳达尔·赤土之魂', '球员纪念',
    '裂开的红土与新生的嫩芽同框：真正深刻的从来不只是冠军数字，而是每一次再起身。',
    '赤土在他脚下炸开，铜金纹章锁住力量，裂缝里却长出一株很小的新芽。他的正拍像把整片球场卷向前方，汗水、伤痛与漫长拉锯都没有让动作退缩。徽章最打动人的不是无坚不摧，而是他明明经历过消耗，仍一次次选择再追一球。那就是赤土之魂真正的重量。',
    'LW-2026-12', 'player', array['赤土裂纹','铜金战意','新芽韧性'], 2999,
    'assets/manager/badges/ui-v18/optimized/nadal-badge-640.webp',
    'assets/manager/badges/ui-v18/optimized/nadal-badge-640.webp',
    'limited', true, 150, timestamptz '2026-07-18 00:00:00+08', null,
    jsonb_build_object('theme','nadal_clay_soul','category_label','球员纪念')
  )
on conflict (badge_key) do update
set title = excluded.title,
    formal_name = excluded.formal_name,
    subtitle = excluded.subtitle,
    description = excluded.description,
    story = excluded.story,
    serial_number = excluded.serial_number,
    category = excluded.category,
    motifs = excluded.motifs,
    price = excluded.price,
    image_url = excluded.image_url,
    thumb_url = excluded.thumb_url,
    rarity = excluded.rarity,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    available_from = excluded.available_from,
    available_until = excluded.available_until,
    metadata = coalesce(public.tour_manager_badges.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
