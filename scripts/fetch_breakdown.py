#!/usr/bin/env python3
"""
签表幸存者之炉网 - 积分构成数据生成脚本（官方赛历版）
改进：
1. ATP 从官方 PDF 赛历、WTA 从官方 API 缓存读取每个赛事实际月份和场地
2. 赛事级别从官方赛历读取（处理升降级）
3. 使用即时积分（instant_score），加入本站当前得分
"""
import re, json, time, os, unicodedata, requests
from datetime import datetime, timezone, timedelta, date

BASE_URL = "https://www.live-tennis.cn"
OFFICIAL_CALENDAR_PATH = os.path.join('data', 'official_calendar.json')
CURRENT_EVENT_OVERLAYS_PATH = os.path.join('data', 'current_event_overlays.json')
SURVIVOR_EVENTS_PATH = os.path.join('data', 'survivor_events_2026.json')

ATP_GS = {'澳网','法网','温网','美网'}
ATP_YE = {'都灵'}
ATP_MANDATORY_1000 = {'印第安维尔斯','迈阿密','马德里','罗马','多伦多','蒙特利尔','辛辛那提','上海','巴黎'}
ATP_OPTIONAL_1000 = {'蒙特卡洛'}
ATP_M1000 = ATP_MANDATORY_1000 | ATP_OPTIONAL_1000
WTA_GS = {'澳网','法网','温网','美网'}
WTA_YE = {'利雅得'}
WTA_M1000_NC = {'多哈','迪拜','武汉'}
WTA_M1000_C = {'印第安维尔斯','迈阿密','马德里','罗马','蒙特利尔','多伦多','辛辛那提','北京'}

GS_ATTRS = {'澳网': 'hard_out', '法网': 'clay', '温网': 'grass', '美网': 'hard_out'}
GS_MONTHS = {'澳网': 1, '法网': 6, '温网': 7, '美网': 9}
YE_EVENTS = {
    'ATP': {'都灵': 11},
    'WTA': {'利雅得': 11},
}

OFFICIAL_EVENT_ALIAS_OVERRIDES = {
    ('WTA', 'merida'): {'梅里达'},
    ('WTA', 'Washington Dc'): {'华盛顿'},
}

# data/official_calendar.json 目前缺少的已核验官方赛历项。
# 补充项只在同 tour/year/event_key 不存在时注入，日后官方
# 赛历文件补齐后会自动让位，不会生成重复记录。
OFFICIAL_CALENDAR_SUPPLEMENTS = [
    {
        'tour': 'ATP',
        'year': 2025,
        'source': 'ATP official calendar supplement',
        'event_key': '多伦多',
        'city': 'TORONTO',
        'name': 'NATIONAL BANK OPEN PRESENTED BY ROGERS',
        'level': 'ATP MASTERS 1000',
        'type': 'M1000',
        'surface': 'hard_out',
        'surface_code': 'H',
        'in_outdoor': 'O',
        'start_date': '2025-07-27',
        'end_date': '2025-08-07',
        'month': 7,
        'draw_size': 96,
        'aliases': [
            'ATP MASTERS 1000',
            'TORONTO',
            'NATIONAL BANK OPEN PRESENTED BY ROGERS',
            '多伦多',
        ],
    },
]

# 赛事轮换造成的单站失效日补丁。
# 2025 加拿大站 ATP 在多伦多、WTA 在蒙特利尔；2026 两者轮换城市
# 并于 8 月 2 日开赛。华盛顿站期间仍应保留 2025 加拿大站积分，
# 等 2026 加拿大站真正开始后再按原有 18 站规则重选。
EVENT_EXPIRY_DEFERRALS = {
    ('ATP', 2025, '多伦多'): date(2026, 8, 2),
    ('WTA', 2025, '蒙特利尔'): date(2026, 8, 2),
}

# 仅用作 scrape_calendar 里颜色无法判断时的兜底，后续会被动态场地覆盖
INDOOR_FALLBACK = {
    '鹿特丹','巴黎','都灵','霍巴特','林茨','武汉','多哈','达拉斯',
    '维也纳','巴塞尔','斯德哥尔摩','奥斯汀','孟菲斯','首尔',
    '蒙彼利埃','德拉海滩','布鲁塞尔','利雅得','新加坡','深圳','吉达',
}


def make_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': BASE_URL
    })
    return s


# ── 赛历读取（级别+颜色场地）──────────────────────────────
def scrape_calendar(year, session):
    try:
        r = session.get(f'{BASE_URL}/zh/calendar/{year}', timeout=20)
        html = r.text
    except Exception as e:
        print(f"  ⚠️ 赛历{year}获取失败: {e}")
        return {}

    def logo_to_type(logo):
        l = logo.lower()
        if 'gs-' in l or '-gs' in l: return 'BOTH', 'GS'
        if 'wta-final' in l or 'wta-lvr' in l: return 'WTA', 'YE'
        if 'atp-final' in l or 'atp-lvr' in l: return 'ATP', 'YE'
        if 'wta-1000' in l: return 'WTA', 'M1000'
        if 'wta-500' in l: return 'WTA', 'A500'
        if 'wta-250' in l: return 'WTA', 'A250'
        if 'atp-1000' in l: return 'ATP', 'M1000'
        if 'atp-500' in l: return 'ATP', 'A500'
        if 'atp-250' in l: return 'ATP', 'A250'
        return None, 'OTH'

    def color_to_surf(color, name):
        c = color.lower()
        if c in ('#f85a40','#c84b34','#a0522d','#cc4400'): return 'clay'
        if c in ('#a4c639','#336b2a','#4cbc4c','#5a8a3c','#8fbc8f'): return 'grass'
        return 'hard_in' if name in INDOOR_FALLBACK else 'hard_out'

    pattern = re.compile(
        r'href="https://www\.live-tennis\.cn/zh/draw/(\d+)/' + str(year) + r'"\s+'
        r'style="background-color:\s*(#[0-9a-fA-F]+)"\s*>\s*'
        r'<img[^>]*level_logo/([^"]+)"[^>]*/>\s*(?:<img[^>]*/>\s*)?'
        r'([^\n<]{2,25})\s*</div>', re.DOTALL)
    events = {}
    for m in pattern.finditer(html):
        eid, color, logo, name = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        g, t = logo_to_type(logo)
        if not g or t == 'OTH': continue
        surf = color_to_surf(color, name)
        if g == 'BOTH':
            for gx in ('ATP', 'WTA'):
                events[(gx, name)] = {'type': t, 'surface': surf, 'eid': eid}
        else:
            events[(g, name)] = {'type': t, 'surface': surf, 'eid': eid}
    return events


# ── 从赛历详情页动态获取月份和场地 ────────────────────────
# ── 从 calendar_list 页面动态获取赛事月份（场地继续用赛历颜色）─
# ── 2026赛季 ATP/WTA赛事 → 月份 对照表 ─────────────────────
# 数据来源：https://www.live-tennis.cn/zh/calendar_list/2026
# 每年1月手动更新一次即可
CALENDAR_MONTHS_2026 = {
    # === ATP ===
    ('ATP','联合杯'):1, ('ATP','布里斯班'):1, ('ATP','香港'):1, ('ATP','奥克兰'):1,
    ('ATP','阿德莱德'):1, ('ATP','澳网'):1,
    ('ATP','蒙彼利埃'):2, ('ATP','鹿特丹'):2, ('ATP','达拉斯'):2, ('ATP','布宜诺斯艾利斯'):2,
    ('ATP','多哈'):2, ('ATP','迪拜'):2, ('ATP','里约热内卢'):2, ('ATP','德拉海滩'):2,
    ('ATP','阿卡普尔科'):2,
    ('ATP','印第安维尔斯'):3,
    ('ATP','迈阿密'):3,
    ('ATP','休斯顿'):3, ('ATP','马拉喀什'):3, ('ATP','布加勒斯特'):3,
    ('ATP','蒙特卡洛'):4,
    ('ATP','慕尼黑'):4, ('ATP','巴塞罗那'):4,
    ('ATP','马德里'):4,
    ('ATP','罗马'):5,
    ('ATP','汉堡'):5, ('ATP','日内瓦'):5,
    ('ATP','法网'):5,
    ('ATP','斯图加特'):6, ('ATP','斯海尔托亨博斯'):6,
    ('ATP','哈雷'):6, ('ATP','伦敦'):6,
    ('ATP','马洛卡'):6, ('ATP','伊斯特本'):6,
    ('ATP','温网'):6,
    ('ATP','巴斯塔德'):7, ('ATP','格施塔德'):7, ('ATP','乌马格'):7, ('ATP','雅西'):7, ('ATP','雅典'):7,
    ('ATP','基茨比厄尔'):7, ('ATP','埃斯托利尔'):7,
    ('ATP','华盛顿'):7, ('ATP','洛斯卡沃斯'):7, ('ATP','孟菲斯'):7,
    ('ATP','蒙特利尔'):8, ('ATP','多伦多'):8,
    ('ATP','辛辛那提'):8,
    ('ATP','温斯顿塞勒姆'):8,
    ('ATP','美网'):8,
    ('ATP','成都'):9, ('ATP','杭州'):9,
    ('ATP','北京'):9, ('ATP','东京'):9,
    ('ATP','上海'):10,
    ('ATP','阿拉木图'):10, ('ATP','布鲁塞尔'):10,
    ('ATP','维也纳'):10, ('ATP','巴塞尔'):10,
    ('ATP','巴黎'):11,
    ('ATP','都灵'):11, ('ATP','斯德哥尔摩'):11,
    ('ATP','吉达'):12,

    # === WTA ===
    ('WTA','联合杯'):1, ('WTA','布里斯班'):1, ('WTA','奥克兰'):1,
    ('WTA','阿德莱德'):1, ('WTA','霍巴特'):1,
    ('WTA','澳网'):1,
    ('WTA','阿布扎比'):2, ('WTA','克卢日-纳波卡'):2, ('WTA','俄斯特拉发'):2,
    ('WTA','多哈'):2, ('WTA','迪拜'):2,
    ('WTA','梅里达'):2, ('WTA','奥斯汀'):2, ('WTA','圣地亚哥'):2,
    ('WTA','印第安维尔斯'):3,
    ('WTA','迈阿密'):3,
    ('WTA','查尔斯顿'):3, ('WTA','波哥大'):3,
    ('WTA','蒙特卡洛'):4,
    ('WTA','林茨'):4,
    ('WTA','斯图加特'):4, ('WTA','鲁昂'):4,
    ('WTA','马德里'):4,
    ('WTA','罗马'):5,
    ('WTA','斯特拉斯堡'):5, ('WTA','拉巴特'):5,
    ('WTA','法网'):5,
    ('WTA','斯海尔托亨博斯'):6,
    ('WTA','柏林'):6, ('WTA','诺丁汉'):6,
    ('WTA','巴特洪堡'):6, ('WTA','伊斯特本'):6,
    ('WTA','温网'):6,
    ('WTA','汉堡'):7, ('WTA','布拉格'):7,
    ('WTA','华盛顿'):7,
    ('WTA','蒙特利尔'):8, ('WTA','多伦多'):8,
    ('WTA','辛辛那提'):8,
    ('WTA','蒙特雷'):8,
    ('WTA','美网'):8,
    ('WTA','瓜达拉哈拉'):9,
    ('WTA','首尔'):9, ('WTA','新加坡'):9,
    ('WTA','北京'):9, ('WTA','武汉'):10,
    ('WTA','宁波'):10, ('WTA','大阪'):10, ('WTA','里昂'):10,
    ('WTA','东京'):10, ('WTA','广州'):10,
    ('WTA','香港'):11, ('WTA','清奈'):11, ('WTA','九江'):11,
    ('WTA','利雅得'):11,
    ('WTA','深圳'):11, ('WTA','珠海'):11,
}


def build_dynamic_info_map_from_calendar_list(cal_cache, cur_year, session):
    """直接从硬编码的 CALENDAR_MONTHS_2026 对照表读取月份。
    场地信息从 scrape_calendar 获取。
    """
    info_map = {}

    for (g, name), month in CALENDAR_MONTHS_2026.items():
        cal_info = cal_cache.get(cur_year, {}).get((g, name))
        if cal_info:
            surface = cal_info.get('surface', 'hard_out')
        else:
            surface = 'hard_out'
        info_map[(g, name)] = {'month': month, 'surface': surface}

    print(f"  动态信息映射: {len(info_map)} 个赛事")
    # 打印同地不同月
    name_info = {}
    for (g, name), info in info_map.items():
        if name not in name_info:
            name_info[name] = {}
        name_info[name][g] = info
    for name, gi in name_info.items():
        if len(gi) > 1:
            parts = ", ".join(f"{g}={v['month']}月/{v['surface']}" for g, v in gi.items())
            print(f"  📅 {name}: {parts}")

    return info_map

# ── 官方赛历索引 ──────────────────────────────────────────
def norm_event_key(s):
    s = unicodedata.normalize('NFKD', str(s or '').strip().lower())
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r'[^0-9a-z\u4e00-\u9fff]+', '', s)


def parse_ymd(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def load_official_calendar():
    try:
        with open(OFFICIAL_CALENDAR_PATH, encoding='utf-8') as f:
            payload = json.load(f)
    except FileNotFoundError:
        print(f"  ⚠️ 官方赛历不存在: {OFFICIAL_CALENDAR_PATH}")
        return {'events': [], 'by_alias': {}}

    events = list(payload.get('events') or [])
    existing_event_keys = {
        (
            rec.get('tour'),
            int(rec.get('year') or 0),
            norm_event_key(rec.get('event_key')),
        )
        for rec in events
    }
    for supplement in OFFICIAL_CALENDAR_SUPPLEMENTS:
        supplement_key = (
            supplement.get('tour'),
            int(supplement.get('year') or 0),
            norm_event_key(supplement.get('event_key')),
        )
        if supplement_key not in existing_event_keys:
            events.append(dict(supplement))
            existing_event_keys.add(supplement_key)

    by_alias = {}
    for rec in events:
        tour = rec.get('tour')
        aliases = set(rec.get('aliases') or [])
        for k in ('event_key', 'city', 'name', 'level'):
            if rec.get(k):
                aliases.add(rec[k])
        norm_aliases = {norm_event_key(alias) for alias in aliases}
        for (alias_tour, canonical), extras in OFFICIAL_EVENT_ALIAS_OVERRIDES.items():
            if tour == alias_tour and norm_event_key(canonical) in norm_aliases:
                aliases.update(extras)
        for alias in aliases:
            key = norm_event_key(alias)
            if key:
                by_alias.setdefault((tour, key), []).append(rec)

    def rec_key(rec):
        return parse_ymd(rec.get('start_date')) or date.min

    for rows in by_alias.values():
        rows.sort(key=rec_key)

    return {'events': events, 'by_alias': by_alias}


def has_official_calendar(cal_cache):
    return bool(cal_cache and cal_cache.get('events') and cal_cache.get('by_alias'))


def load_current_event_overlays():
    try:
        with open(CURRENT_EVENT_OVERLAYS_PATH, encoding='utf-8') as f:
            payload = json.load(f)
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"  ⚠️ 当前站缓存读取失败: {e}")
        return []
    rows = payload.get('events') if isinstance(payload, dict) else payload
    return rows if isinstance(rows, list) else []


def _survivor_tour_from_gender(gender):
    return 'ATP' if gender in ('MS', 'ATP') else 'WTA'


def _survivor_gender_from_tour(tour):
    return 'MS' if tour == 'ATP' else 'WS'


def _survivor_event_rows_from_history():
    rows = []
    try:
        with open(os.path.join('data', 'history.json'), encoding='utf-8') as f:
            payload = json.load(f)
    except Exception:
        return rows
    flights = payload.get('flights') or {}
    for year_key, items in flights.items():
        if not isinstance(items, dict):
            continue
        for label in items.keys():
            m = re.match(r'(\d{4})\s+(.+?)\s+(ATP|WTA)$', str(label))
            if not m:
                continue
            rows.append({
                'year': int(m.group(1)),
                'event_name': m.group(2).strip(),
                'tour': m.group(3),
                'source': 'history',
                'status': 'seen',
            })
    return rows


def fetch_survivor_calendar(year, session):
    try:
        html = session.get(f'{BASE_URL}/zh/survivor/calendar/{year}', timeout=20).text
    except Exception as e:
        print(f"  ⚠️ 幸存者{year}赛历获取失败: {e}")
        return []
    rows, seen = [], set()
    pattern = re.compile(
        r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/'
        + str(year) + r'/(MS|WS)/(score|my)"[^>]*>(.*?)</a>', re.S)
    for eid, gender, mode, txt in pattern.findall(html):
        name = re.sub(r'<[^>]+>', '', txt)
        name = name.replace('ATP', '').replace('WTA', '').strip()
        if not name:
            continue
        tour = _survivor_tour_from_gender(gender)
        key = (year, eid, tour, name)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            'year': year,
            'event_id': eid,
            'gender': gender,
            'tour': tour,
            'event_name': name,
            'status': 'finished' if mode == 'score' else 'current',
            'source': 'survivor_calendar',
        })
    return rows


def _build_survivor_events_index(rows):
    by_alias = {}
    clean_rows = []
    for row in rows or []:
        tour = row.get('tour') or _survivor_tour_from_gender(row.get('gender'))
        try:
            year = int(row.get('year') or 0)
        except Exception:
            year = 0
        name = row.get('event_name') or row.get('name') or ''
        if not tour or not year or not name:
            continue
        item = dict(row)
        item.update({'tour': tour, 'year': year, 'event_name': name})
        clean_rows.append(item)
        aliases = {name}
        for alias in row.get('aliases') or []:
            aliases.add(alias)
        for alias in aliases:
            key = norm_event_key(alias)
            if key:
                by_alias.setdefault((tour, year, key), []).append(item)
    return {'events': clean_rows, 'by_alias': by_alias}


def load_survivor_events(session=None, year=None):
    rows = []
    try:
        with open(SURVIVOR_EVENTS_PATH, encoding='utf-8') as f:
            payload = json.load(f)
        rows.extend(payload.get('events') if isinstance(payload, dict) else payload)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"  ⚠️ 幸存者赛事缓存读取失败: {e}")

    rows.extend(_survivor_event_rows_from_history())
    if session and year:
        fetched = fetch_survivor_calendar(year, session)
        rows.extend(fetched)
        if fetched:
            merged = {}
            for row in rows:
                tour = row.get('tour') or _survivor_tour_from_gender(row.get('gender'))
                name = row.get('event_name') or row.get('name') or ''
                try:
                    y = int(row.get('year') or 0)
                except Exception:
                    y = 0
                if tour and y and name:
                    merged[(tour, y, norm_event_key(name), row.get('event_id') or '')] = {
                        **row, 'tour': tour, 'year': y, 'event_name': name
                    }
            os.makedirs(os.path.dirname(SURVIVOR_EVENTS_PATH), exist_ok=True)
            with open(SURVIVOR_EVENTS_PATH, 'w', encoding='utf-8') as f:
                json.dump({
                    'updated_at': datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S'),
                    'events': sorted(merged.values(), key=lambda x: (
                        int(x.get('year') or 0), x.get('tour') or '', x.get('event_name') or '', x.get('event_id') or ''
                    )),
                }, f, ensure_ascii=False, indent=2)
            rows = list(merged.values())
    return _build_survivor_events_index(rows)


def survivor_has_event(survivor_events, tour, year, event_name):
    if not survivor_events or not survivor_events.get('by_alias'):
        return False
    return bool(survivor_events['by_alias'].get((tour, int(year), norm_event_key(event_name))))


def fallback_type(ev, gender):
    sets = event_selection_sets(gender)
    if ev in sets['gs']:
        return 'GS'
    if ev in sets['ye']:
        return 'YE'
    if gender == 'MS':
        return 'M1000' if ev in sets['m1000'] else 'A250'
    if ev in sets['m1000_nc'] or ev in sets['m1000_c']:
        return 'M1000'
    return 'A250'


def _event_cycle_has_started(rec, today):
    start = parse_ymd(rec.get('start_date'))
    if not start:
        return False
    if int(rec.get('year') or 0) > start.year and int(rec.get('month') or 0) == 1:
        cycle_date = date(today.year, 1, 1)
    else:
        try:
            cycle_date = date(today.year, start.month, start.day)
        except ValueError:
            cycle_date = date(today.year, start.month, 28)
    return today >= cycle_date


def _event_expiry_is_deferred(tour, rec, today):
    aliases = {
        norm_event_key(rec.get('event_key')),
        *(norm_event_key(alias) for alias in (rec.get('aliases') or [])),
    }
    for (deferred_tour, deferred_year, deferred_event), expires_on in EVENT_EXPIRY_DEFERRALS.items():
        if (
            tour == deferred_tour
            and int(rec.get('year') or 0) == deferred_year
            and norm_event_key(deferred_event) in aliases
            and today < expires_on
        ):
            return True
    return False


def _copy_with_survivor_flags(rec, **flags):
    out = dict(rec)
    out.update(flags)
    return out


def choose_official_record(ev, gender, official_calendar, today, force_year=None, survivor_events=None):
    tour = 'ATP' if gender == 'MS' else 'WTA'
    rows = list((official_calendar or {}).get('by_alias', {}).get((tour, norm_event_key(ev)), []))
    if not rows:
        return None

    def end_date(rec):
        return parse_ymd(rec.get('end_date')) or parse_ymd(rec.get('start_date'))

    def started(rec):
        start = parse_ymd(rec.get('start_date'))
        return start is not None and start <= today

    def active_today(rec):
        start = parse_ymd(rec.get('start_date'))
        end = end_date(rec)
        return start is not None and end is not None and start <= today <= end

    def score(rec):
        type_weight = {'GS': 5, 'YE': 4, 'M1000': 3, 'A500': 2, 'A250': 1}.get(rec.get('type'), 0)
        start = parse_ymd(rec.get('start_date')) or date.min
        return (type_weight, start)

    if force_year:
        exact = [rec for rec in rows if int(rec.get('year') or 0) == force_year]
        if exact:
            active = [rec for rec in exact if active_today(rec)]
            if active:
                return max(active, key=score)
            started_exact = [rec for rec in exact if started(rec)]
            if started_exact:
                return max(started_exact, key=lambda rec: parse_ymd(rec.get('start_date')) or date.min)
            return min(exact, key=lambda rec: parse_ymd(rec.get('start_date')) or date.max)

    if survivor_events and survivor_events.get('by_alias'):
        current_year_has_survivor = survivor_has_event(survivor_events, tour, today.year, ev)
        this_year = [rec for rec in rows if int(rec.get('year') or 0) == today.year]
        if current_year_has_survivor and this_year:
            started_this_year = [rec for rec in this_year if started(rec)]
            if started_this_year:
                return _copy_with_survivor_flags(max(started_this_year, key=score),
                                                 survivor_year_status='current_year_opened')
            return _copy_with_survivor_flags(min(this_year, key=lambda rec: parse_ymd(rec.get('start_date')) or date.max),
                                             survivor_year_status='current_year_opened_future')

        prev_year = [rec for rec in rows if int(rec.get('year') or 0) == today.year - 1]
        if prev_year:
            rec = max(prev_year, key=score)
            expired = (
                _event_cycle_has_started(rec, today)
                and not current_year_has_survivor
                and not _event_expiry_is_deferred(tour, rec, today)
            )
            return _copy_with_survivor_flags(
                rec,
                survivor_year_status='previous_year_no_current_survivor',
                expired_by_survivor_calendar=expired,
            )

    this_year = [rec for rec in rows if int(rec.get('year') or 0) == today.year]
    started_this_year = [rec for rec in this_year if started(rec)]
    if started_this_year:
        return max(started_this_year, key=score)

    prev_year = [rec for rec in rows if int(rec.get('year') or 0) == today.year - 1]
    if prev_year:
        return max(prev_year, key=score)

    started_any = [rec for rec in rows if started(rec)]
    if started_any:
        return max(started_any, key=score)

    return min(rows, key=lambda rec: parse_ymd(rec.get('start_date')) or date.max)


# ── 元数据查找 ────────────────────────────────────────────
def get_meta(ev, gender, official_calendar, dynamic_info_map, cur_month, cur_year, force_year=None, survivor_events=None):
    today = datetime.now(timezone(timedelta(hours=8))).date()
    rec = choose_official_record(ev, gender, official_calendar, today, force_year=force_year, survivor_events=survivor_events)
    if rec:
        return {
            'event_key': rec.get('event_key') or ev,
            'type': rec.get('type') or fallback_type(ev, gender),
            'surface': rec.get('surface') or 'hard_out',
            'month': int(rec.get('month') or cur_month),
            'year': int(rec.get('year') or cur_year),
            'start_date': rec.get('start_date'),
            'end_date': rec.get('end_date'),
            'source': rec.get('source'),
            'survivor_year_status': rec.get('survivor_year_status'),
            'expired_by_survivor_calendar': bool(rec.get('expired_by_survivor_calendar')),
        }

    g_str = 'ATP' if gender == 'MS' else 'WTA'
    if ev in GS_ATTRS:
        m = GS_MONTHS[ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'event_key': ev, 'type': 'GS', 'surface': GS_ATTRS[ev], 'month': m, 'year': yr, 'source': 'fallback'}

    if ev in YE_EVENTS.get(g_str, {}):
        m = YE_EVENTS[g_str][ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'event_key': ev, 'type': 'YE', 'surface': 'hard_in', 'month': m, 'year': yr, 'source': 'fallback'}

    return {
        'type': fallback_type(ev, gender),
        'event_key': ev,
        'surface': 'hard_out',
        'month': cur_month,
        'year': cur_year,
        'source': 'fallback',
    }


def expiry_ym(meta):
    return meta['year'] + 1, meta['month']


def parse_details(det, gender, cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events=None):
    if not det: return []
    res = []
    def add(ev, sc, inc, forced):
        meta = get_meta(ev, gender, cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events=survivor_events)
        effective_inc = inc and not meta.get('expired_by_survivor_calendar')
        ey, em = expiry_ym(meta) if effective_inc else (0, 0)
        res.append({'n':ev,'s':sc,'inc':effective_inc,'forced':forced,'meta':meta,
                    'expiry':f'{ey}年{em}月' if effective_inc else None,'current':False})
    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', det):
        add(m.group(1).strip(), int(m.group(2)), True, True)
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', det):
        add(m.group(1).strip(), int(m.group(2)), False, False)
    tmp = re.sub(r'<b>【[^】]*】</b>','',det)
    tmp = re.sub(r'<del>【[^】]*】</del>','',tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】',tmp):
        add(m.group(1).strip(), int(m.group(2)), True, False)
    return res


def event_selection_sets(gender):
    if gender == 'MS':
        return {
            'gs': ATP_GS,
            'ye': ATP_YE,
            'm1000_mandatory': ATP_MANDATORY_1000,
            'm1000_optional': ATP_OPTIONAL_1000,
            'm1000': ATP_M1000,
        }
    return {
        'gs': WTA_GS,
        'ye': WTA_YE,
        'm1000_nc': WTA_M1000_NC,
        'm1000_c': WTA_M1000_C,
    }


def clone_event(e):
    return {
        'n': e['n'],
        's': int(e.get('s') or 0),
        'inc': bool(e.get('inc')),
        'lt_inc': bool(e.get('lt_inc', e.get('inc'))),
        'forced': bool(e.get('forced')),
        'meta': e.get('meta') or {},
        'expiry': e.get('expiry'),
        'current': bool(e.get('current')),
        'source': e.get('source') or 'live',
        'start_counting_score': e.get('start_counting_score'),
        'counting_started': e.get('counting_started'),
    }


def event_payload(e):
    meta = e.get('meta') or {}
    return {
        'n': e.get('n'),
        's': int(e.get('s') or 0),
        'inc': bool(e.get('inc', True)),
        'lt_inc': bool(e.get('lt_inc', e.get('inc', True))),
        'forced': bool(e.get('forced')),
        'current': bool(e.get('current')),
        'source': e.get('source') or 'live',
        'type': meta.get('type'),
        'surf': meta.get('surface'),
        'expiry': e.get('expiry'),
        'start_counting_score': e.get('start_counting_score'),
        'counting_started': e.get('counting_started'),
        'survivor_year_status': meta.get('survivor_year_status'),
        'expired_by_survivor_calendar': bool(meta.get('expired_by_survivor_calendar')),
    }


def canonical_event_name(event_name, meta=None):
    return (meta or {}).get('event_key') or event_name


def is_force_counting_event(event_name, gender, meta=None):
    if not event_name:
        return False
    name = canonical_event_name(event_name, meta)
    event_type = (meta or {}).get('type')
    sets = event_selection_sets(gender)
    if event_type == 'GS' or name in sets['gs'] or event_name in sets['gs']:
        return True
    if gender == 'MS':
        return event_type == 'M1000' and (name in sets['m1000_mandatory'] or event_name in sets['m1000_mandatory'])
    return event_type == 'M1000' and (
        name in sets['m1000_nc'] or event_name in sets['m1000_nc']
        or name in sets['m1000_c'] or event_name in sets['m1000_c']
    )


def start_counting_score_for_event(event_name, gender, meta=None, forced=None):
    if forced is None:
        forced = is_force_counting_event(event_name, gender, meta)
    if forced:
        return 0
    return None


def event_bucket(e, gender):
    name = e.get('n') or ''
    meta = e.get('meta') or {}
    key = canonical_event_name(name, meta)
    event_type = meta.get('type')
    sets = event_selection_sets(gender)
    if event_type == 'GS' or key in sets['gs'] or name in sets['gs']:
        return 'gs'
    if event_type == 'YE' or key in sets['ye'] or name in sets['ye']:
        return 'ye'
    if gender == 'MS':
        if event_type == 'M1000' and (key in sets['m1000_mandatory'] or name in sets['m1000_mandatory']):
            return 'atp_mandatory_1000'
        return 'other'
    if event_type == 'M1000' and (key in sets['m1000_nc'] or name in sets['m1000_nc']):
        return 'wta_1000_nc'
    if event_type == 'M1000' and (key in sets['m1000_c'] or name in sets['m1000_c']):
        return 'wta_1000_c'
    return 'other'


def build_live_available_events(parsed_events):
    c, nc = {}, {}
    for e in parsed_events:
        e2 = clone_event(e)
        e2['source'] = 'live'
        e2['lt_inc'] = bool(e.get('inc'))
        target = c if e.get('inc') else nc
        target[e['n']] = e2

    available = {}
    available.update(nc)
    available.update(c)
    return available


def event_absorbed_by_live_details(available, event_name, meta):
    wanted = norm_event_key(canonical_event_name(event_name, meta))
    for existing in (available or {}).values():
        existing_meta = existing.get('meta') or {}
        same_name = norm_event_key(existing.get('n')) == norm_event_key(event_name)
        same_key = norm_event_key(canonical_event_name(existing.get('n'), existing_meta)) == wanted
        if (same_name or same_key) and int(existing_meta.get('year') or 0) == int((meta or {}).get('year') or 0):
            return True
    return False


def pop_matching_event(adjusted, event_name, meta):
    wanted_name = norm_event_key(event_name)
    wanted_key = norm_event_key(canonical_event_name(event_name, meta))
    removed = []
    for name, existing in list(adjusted.items()):
        existing_meta = existing.get('meta') or {}
        same_name = norm_event_key(name) == wanted_name
        same_key = norm_event_key(canonical_event_name(name, existing_meta)) == wanted_key
        if same_name or same_key:
            removed.append(adjusted.pop(name))
    return removed


def with_event_candidate(available, gender, event_name, this_event_score,
                         cal_cache, dynamic_info_map, cur_month, cur_year,
                         source='current', force_year=None, skip_if_absorbed=False, survivor_events=None):
    if not event_name:
        return dict(available)

    score = int(this_event_score or 0)
    meta = get_meta(event_name, gender, cal_cache, dynamic_info_map, cur_month, cur_year,
                    force_year=force_year or cur_year, survivor_events=survivor_events)
    forced = is_force_counting_event(event_name, gender, meta)
    start_counting_score = start_counting_score_for_event(event_name, gender, meta, forced)
    adjusted = {name: clone_event(e) for name, e in available.items()}
    if skip_if_absorbed and event_absorbed_by_live_details(adjusted, event_name, meta):
        return adjusted
    originals = pop_matching_event(adjusted, event_name, meta)
    original = originals[0] if originals else None
    if score <= 0 and not forced:
        return adjusted

    ey, em = expiry_ym(meta)
    adjusted[event_name] = {
        'n': event_name,
        's': score,
        'inc': True,
        'lt_inc': bool(original and original.get('lt_inc', original.get('inc'))),
        'forced': forced,
        'meta': meta,
        'expiry': f'{ey}年{em}月',
        'current': source == 'current',
        'source': source,
        'start_counting_score': start_counting_score,
        'counting_started': forced or score > 0,
    }
    return adjusted


def with_current_event_candidate(available, gender, event_name, this_event_score,
                                 cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events=None):
    return with_event_candidate(
        available, gender, event_name, this_event_score,
        cal_cache, dynamic_info_map, cur_month, cur_year,
        source='current', force_year=cur_year, skip_if_absorbed=False, survivor_events=survivor_events
    )


def overlay_events_for_user(overlays, uid, gender, current_event_name=None):
    tour = 'ATP' if gender == 'MS' else 'WTA'
    uid = str(uid)
    res = []
    for rec in overlays or []:
        if rec.get('tour') != tour:
            continue
        name = rec.get('event_name') or ''
        if not name:
            continue
        scores = rec.get('scores') or rec.get('rows') or {}
        if uid not in scores:
            continue
        res.append({
            'event_name': name,
            'score': int(scores.get(uid) or 0),
            'year': int(rec.get('year') or 0) or None,
            'event_id': rec.get('event_id') or '',
            'is_current': bool(current_event_name and name == current_event_name),
        })
    return res


def with_pending_event_candidates(available, pending_events, gender, cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events=None):
    adjusted = {name: clone_event(e) for name, e in available.items()}
    for rec in pending_events or []:
        adjusted = with_event_candidate(
            adjusted, gender, rec.get('event_name'), rec.get('score', 0),
            cal_cache, dynamic_info_map, cur_month, cur_year,
            source='pending', force_year=rec.get('year') or cur_year, skip_if_absorbed=True, survivor_events=survivor_events
        )
    return adjusted


def select_events_by_rules(values, gender):
    values = [
        e for e in values
        if not (e.get('meta') or {}).get('expired_by_survivor_calendar')
    ]

    def live_included(e):
        return bool(e.get('lt_inc', e.get('inc')))

    def source_priority(e):
        if live_included(e):
            return 0
        if e.get('source') in ('current', 'pending'):
            return 1
        if e.get('forced'):
            return 2
        return 3

    def expiry_key(e):
        m = re.match(r'(\d+)年(\d+)月', str(e.get('expiry') or ''))
        if m:
            return int(m.group(1)), int(m.group(2))
        return 9999, 99

    def srt(items):
        return sorted(items, key=lambda x: (
            -int(x.get('s') or 0),
            source_priority(x),
            expiry_key(x),
            x.get('n') or '',
        ))

    if gender == 'MS':
        gs = srt([e for e in values if event_bucket(e, gender) == 'gs'])
        ye = srt([e for e in values if event_bucket(e, gender) == 'ye'])[:1]
        m1_all = srt([e for e in values if event_bucket(e, gender) == 'atp_mandatory_1000'])
        m1_top, m1_spare = m1_all[:5], m1_all[5:]
        others = srt([e for e in values if event_bucket(e, gender) == 'other'] + m1_spare)
        rem = max(0, 18 - len(gs) - len(m1_top))
        selected = gs + ye + m1_top + others[:rem]
    else:
        gs = srt([e for e in values if event_bucket(e, gender) == 'gs'])
        ye = srt([e for e in values if event_bucket(e, gender) == 'ye'])[:1]
        nc2_all = srt([e for e in values if event_bucket(e, gender) == 'wta_1000_nc'])
        cc_all = srt([e for e in values if event_bucket(e, gender) == 'wta_1000_c'])
        nc_top, nc_spare = nc2_all[:1], nc2_all[1:]
        cc_top, cc_spare = cc_all[:6], cc_all[6:]
        others = srt([e for e in values if event_bucket(e, gender) == 'other'] + nc_spare + cc_spare)
        rem = max(0, 18 - len(gs) - len(nc_top) - len(cc_top))
        selected = gs + ye + nc_top + cc_top + others[:rem]

    return selected


def select_live_included_events(values):
    return [clone_event(e) for e in values if e.get('lt_inc', e.get('inc'))]


def sum_events(events):
    return sum(int(e.get('s') or 0) for e in events)


def select_countable_events(parsed_events, gender, event_name, this_event_score, target_score,
                            cal_cache, dynamic_info_map, cur_month, cur_year, pending_events=None,
                            survivor_events=None):
    """Select the instant ranking composition.

    LiveTennis details are the historical ledger. Current/pending survivor events
    are authoritative: when they replace the same canonical event, always use the
    survivor-current score and then reselect under the official ranking rules.
    """
    baseline_available = build_live_available_events(parsed_events)
    pending_available = with_pending_event_candidates(
        baseline_available, pending_events, gender, cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events
    )
    adjusted_available = with_current_event_candidate(
        pending_available, gender, event_name, this_event_score,
        cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events
    )

    baseline_selected = select_live_included_events(list(baseline_available.values()))
    adjusted_selected = select_events_by_rules(list(adjusted_available.values()), gender)
    baseline_total = sum_events(baseline_selected)
    adjusted_total = sum_events(adjusted_selected)
    target = int(target_score or 0)
    has_event_adjustment = adjusted_available != baseline_available

    mode = 'baseline'
    selected = baseline_selected
    available = baseline_available
    if has_event_adjustment:
        mode = 'event_adjusted_forced'
        selected = adjusted_selected
        available = adjusted_available
    elif baseline_total != target:
        if adjusted_total == target or abs(adjusted_total - target) < abs(baseline_total - target):
            mode = 'event_adjusted' if has_event_adjustment else 'official_recomposed'
            selected = adjusted_selected
            available = adjusted_available
        elif has_event_adjustment:
            mode = 'baseline_closest'
    elif adjusted_total == target and has_event_adjustment:
        mode = 'baseline_live_preferred'

    return selected, list(available.values()), mode


def current_event_info(event_name, gender, cal_cache, dynamic_info_map, cur_month, cur_year, survivor_events=None):
    if not event_name:
        return None
    meta = get_meta(event_name, gender, cal_cache, dynamic_info_map, cur_month, cur_year,
                    force_year=cur_year, survivor_events=survivor_events)
    ey, em = expiry_ym(meta)
    forced = is_force_counting_event(event_name, gender, meta)
    return {
        'name': event_name,
        'type': meta.get('type'),
        'surface': meta.get('surface'),
        'year': meta.get('year'),
        'month': meta.get('month'),
        'start_date': meta.get('start_date'),
        'end_date': meta.get('end_date'),
        'expiry': f'{ey}年{em}月',
        'forced': forced,
        'start_counting_score': start_counting_score_for_event(event_name, gender, meta, forced),
    }


def get_label(u):
    total=u['s'] or 1
    gs=u['gs'];ye=u['ye'];m1=u['m1'];a5=u['a5']
    hard=u['hard'];cl=u['clay'];gr=u['grass']
    gs_pct=u['gs_pct'];ye_pct=u.get('ye_pct',0);m1_pct=u['m1_pct']
    a5_pct=u['a5_pct'];hard_pct=u['hard_pct'];cl_pct=u['clay_pct'];gr_pct=u['grass_pct']
    gs_r=gs/total;ye_r=ye/total;m1_r=m1/total;a5_r=a5/total
    hard_r=hard/total;cl_r=cl/total;gr_r=gr/total
    if ye>=500 or ye_r>=0.12:
        if ye_pct>=80: return '🏆 年终称霸','#7c3aed'
        return '🌙 年终强手','#a78bfa'
    if gr_r>=0.32:
        if gr_pct>=95: return '🌿 草地传说','#15803d'
        if gr_pct>=80: return '🍃 草地大赢家','#16a34a'
        if gr_pct>=55: return '🌱 草地好手','#4ade80'
        return '🌱 草地追梦者','#86efac'
    if gs_pct>=97 and gs_r>=0.50: return '👑 大满贯神话','#b45309'
    if gs_r>=0.65:
        if gs_pct>=90: return '👑 大满贯传奇','#d97706'
        if gs_pct>=75: return '🎾 大满贯收割机','#f97316'
        if gs_pct>=55: return '🏅 大满贯主力','#fb923c'
        return '🎯 大满贯好手','#fbbf24'
    if gs_r>=0.52:
        if gs_pct>=95: return '👑 大满贯传奇','#d97706'
        if gs_pct>=82: return '🎾 大满贯收割机','#f97316'
        if gs_pct>=68: return '💪 大满贯实力派','#ea580c'
        if gs_pct>=50: return '🏅 大满贯主力','#fb923c'
        return '🎯 大满贯好手','#fbbf24'
    if gs_r>=0.40:
        if gs_pct>=90: return '🎾 大满贯收割机','#f97316'
        if gs_pct>=75: return '💪 大满贯实力派','#ea580c'
        if gs_pct>=55: return '🏅 大满贯主力','#fb923c'
        if gs_pct>=35: return '🎯 大满贯好手','#f97316'
        return '🎯 大满贯追梦者','#fbbf24'
    if m1_r>=0.40:
        if m1_pct>=95: return '⚡ 1000赛霸主','#dc2626'
        if m1_pct>=80: return '⚡ 1000赛达人','#ef4444'
        if m1_pct>=62: return '⚡ 1000赛精英','#f87171'
        if m1_pct>=45: return '💫 1000赛好手','#fca5a5'
        return '💫 1000赛常客','#fed7d7'
    if m1_r>=0.32:
        if m1_pct>=85: return '⚡ 1000赛达人','#ef4444'
        if m1_pct>=65: return '⚡ 1000赛精英','#f87171'
        return '💫 1000赛好手','#fca5a5'
    combo_pct=(gs_pct+m1_pct)/2
    if (gs_r+m1_r)>=0.60 and combo_pct>=88: return '🌟 顶尖全能王','#6366f1'
    if (gs_r+m1_r)>=0.55 and combo_pct>=78: return '🎪 精英综合体','#8b5cf6'
    if (gs_r+m1_r)>=0.48 and combo_pct>=65: return '🎨 大赛全才','#a78bfa'
    if (gs_r+m1_r)>=0.42: return '🧩 大赛均衡型','#c4b5fd'
    if cl_r>=0.38:
        if cl_pct>=95: return '🧱 红土之王','#b91c1c'
        if cl_pct>=80: return '🏺 红土大师','#ef4444'
        if cl_pct>=62: return '🏺 红土达人','#f87171'
        if cl_pct>=45: return '🪴 红土好手','#fca5a5'
        return '🪴 红土爱好者','#fed7d7'
    if hard_r>=0.60:
        if hard_pct>=95: return '💎 硬地霸主','#1d4ed8'
        if hard_pct>=80: return '🔷 硬地之王','#3b82f6'
        if hard_pct>=62: return '🔷 硬地稳健王','#60a5fa'
        if hard_pct>=45: return '🔹 硬地好手','#93c5fd'
        return '🔹 硬地常客','#bfdbfe'
    if a5_r>=0.28:
        if a5_pct>=88: return '🌆 500赛小王子','#0369a1'
        if a5_pct>=70: return '🏙️ 500赛精英','#0ea5e9'
        if a5_pct>=45: return '🏘️ 500赛常客','#7dd3fc'
        return '🏘️ 500赛常客','#bfdbfe'
    overall=(gs_pct+m1_pct)/2
    if overall>=85: return '🧩 全面稳健型','#475569'
    if overall>=65: return '🧩 全面均衡型','#64748b'
    if overall>=35: return '🌀 积分探索者','#94a3b8'
    return '🌱 初出茅庐','#9ca3af'


def calc_feat_pct(users, feat):
    vals=sorted([u[feat] for u in users],reverse=True); n=len(vals)
    for u in users:
        r=sum(1 for x in vals if x>u[feat])
        u[f'{feat}_pct']=(1-r/n)*100 if n>0 else 0


def fetch_rank_data(session, csrf, gidx):
    all_rows=[]; start=0
    while True:
        r=session.post(f'{BASE_URL}/zh/survivor/rank/{gidx}/year',
            headers={'X-CSRF-TOKEN':csrf,'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
            data=f'draw=1&start={start}&length=1000&device=0',timeout=30)
        r.raise_for_status(); d=r.json(); rows=d.get('data',[])
        all_rows.extend(rows); total=d.get('recordsTotal',0)
        if len(all_rows)>=total or not rows: break
        start+=1000; time.sleep(0.3)
    return all_rows


def build_users(rows, gender, ir_map, cur_map, event_name, cal_cache, dynamic_info_map, cur_month, cur_year,
                event_overlays=None, survivor_events=None):
    EXPIRY_MONTHS=[]
    m2,y2=cur_month+1,cur_year
    if m2>12: m2=1;y2+=1
    for _ in range(12):
        EXPIRY_MONTHS.append(f'{y2}年{m2}月'); m2+=1
        if m2>12: m2=1;y2+=1
    users=[]
    for r in rows:
        uid=str(r.get('user_id','')); name=re.sub(r'<[^>]+>','',str(r.get('username',''))).strip()
        rank=r.get('rank',9999) or 9999; det=r.get('details','')
        ci=cur_map.get(uid,{})
        score=ci.get('instant_score',r.get('score',0) or 0)
        this_ev=ci.get('this_event_score',0)
        evs=parse_details(det,gender,cal_cache,dynamic_info_map,cur_month,cur_year,survivor_events)
        pending_events = overlay_events_for_user(event_overlays, uid, gender, current_event_name=event_name)
        included, calc_pool, composition_mode = select_countable_events(
            evs, gender, event_name, this_ev, score, cal_cache, dynamic_info_map, cur_month, cur_year,
            pending_events, survivor_events
        )

        ts,te,ss,em2={},{},{},{}
        for e in included:
            t=e['meta']['type'];sk=e['meta']['surface'];sc2=e['s']
            ts[t]=ts.get(t,0)+sc2
            if t not in te: te[t]=[]
            te[t].append(e)
            ss[sk]=ss.get(sk,0)+sc2
            if e['expiry']:
                if e['expiry'] not in em2: em2[e['expiry']]={'total':0,'events':[]}
                em2[e['expiry']]['total']+=sc2; em2[e['expiry']]['events'].append(f"{e['n']}({sc2})")
        ho=ss.get('hard_out',0);hi=ss.get('hard_in',0)
        selected_names = {e['n'] for e in included}
        calc_pool_payload = []
        for e in calc_pool:
            payload = event_payload(e)
            payload['selected'] = e.get('n') in selected_names
            if payload.get('current'):
                payload['counting_started'] = payload['selected'] or payload.get('forced')
            calc_pool_payload.append(payload)
        u={'uid':uid,'n':name,'s':score,'rank':rank,
           'gs':ts.get('GS',0),'ye':ts.get('YE',0),'m1':ts.get('M1000',0),'a5':ts.get('A500',0),'a2':ts.get('A250',0),
           'hard':ho+hi,'clay':ss.get('clay',0),'grass':ss.get('grass',0),'surf_scores':ss,
           'type_evs':{t:[{'n':e['n'],'s':e['s'],'inc':e.get('inc', True),'lt_inc':e.get('lt_inc', e.get('inc', True)),
                           'forced':e['forced'],'current':e.get('current', False),'source':e.get('source', 'live'),
                           'surf':e['meta']['surface'],'expiry':e['expiry']}
                           for e in sorted(evs2,key=lambda x:-x['s'])] for t,evs2 in te.items()},
           'calc_pool':calc_pool_payload,
           'composition_total':sum(e['s'] for e in included),
           'composition_gap':score-sum(e['s'] for e in included),
           'composition_mode':composition_mode,
           'exp_list':[{'mk':mk,'total':em2.get(mk,{'total':0})['total'],'events':em2.get(mk,{'events':[]})['events']}
                       for mk in EXPIRY_MONTHS]}
        users.append(u)
    users.sort(key=lambda u:ir_map.get(u['uid'],u['rank'] or 9999))
    for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
        calc_feat_pct(users,feat)
    for u in users:
        lb,lc=get_label(u); u['label']=lb; u['label_color']=lc; u['base_label']=lb; u['base_label_color']=lc
        u['ir']=ir_map.get(u['uid'],u['rank'])
        for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']: u.pop(f'{feat}_pct',None)
        u.pop('hard',None);u.pop('clay',None);u.pop('grass',None)
    if users: users[0]['label']='🥇 世界第一';users[0]['label_color']='#b45309'
    return users


def main():
    tz_cn=timezone(timedelta(hours=8))
    now=datetime.now(tz_cn); cur_month=now.month; cur_year=now.year
    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 开始生成积分构成数据（官方赛历版）...")
    session=make_session()

    print("读取官方赛历...")
    cal_cache = load_official_calendar()
    dynamic_info_map = None
    print(f"  官方赛历赛事: {len(cal_cache.get('events', []))} 个")
    print("读取幸存者赛事表...")
    survivor_events = load_survivor_events(session, cur_year)
    print(f"  幸存者赛事索引: {len(survivor_events.get('events', []))} 个")
    event_overlays = load_current_event_overlays()
    print(f"  当前站/待吸收缓存: {len(event_overlays)} 站")

    resp_ms=session.get(f'{BASE_URL}/zh/survivor/rank/MS/year',timeout=20)
    csrf_ms=re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"',resp_ms.text).group(1)
    resp_ws=session.get(f'{BASE_URL}/zh/survivor/rank/WS/year',timeout=20)
    csrf_ws=re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"',resp_ws.text).group(1)
    print("获取ATP排名..."); ms_rows=fetch_rank_data(session,csrf_ms,'1'); print(f"  {len(ms_rows)} 用户")
    print("获取WTA排名..."); ws_rows=fetch_rank_data(session,csrf_ws,'2'); print(f"  {len(ws_rows)} 用户")

    try:
        with open('data/current.json',encoding='utf-8') as f: cur=json.load(f)
        ms_ir={str(r['user_id']):r.get('instant_rank') for r in cur['ms']['rows'] if r.get('instant_rank')}
        ws_ir={str(r['user_id']):r.get('instant_rank') for r in cur['ws']['rows'] if r.get('instant_rank')}
        ms_cur={str(r['user_id']):{'instant_score':r.get('instant_score',0) or 0,'this_event_score':r.get('this_event_score',0) or 0}
                for r in cur['ms']['rows']}
        ws_cur={str(r['user_id']):{'instant_score':r.get('instant_score',0) or 0,'this_event_score':r.get('this_event_score',0) or 0}
                for r in cur['ws']['rows']}
        ms_event=cur['ms'].get('event_name',''); ws_event=cur['ws'].get('event_name','')
        print(f"当前赛事: ATP={ms_event}, WTA={ws_event}")
    except Exception as e:
        print(f"  ⚠️ current.json读取失败: {e}"); ms_ir={}; ws_ir={}; ms_cur={}; ws_cur={}; ms_event=''; ws_event=''

    print("构建ATP积分构成...")
    ms_users=build_users(ms_rows,'MS',ms_ir,ms_cur,ms_event,cal_cache,dynamic_info_map,cur_month,cur_year,event_overlays,survivor_events)
    print("构建WTA积分构成...")
    ws_users=build_users(ws_rows,'WS',ws_ir,ws_cur,ws_event,cal_cache,dynamic_info_map,cur_month,cur_year,event_overlays,survivor_events)

    now_str=now.strftime('%Y-%m-%d %H:%M:%S')
    output={
        'updated_at':now_str,
        'calendar_source':'official_calendar',
        'survivor_events_source':'survivor_calendar/history/cache',
        'event_overlay_count':len(event_overlays),
        'expiry_months':[
            f'{(cur_year + (cur_month+i)//12)}年{((cur_month+i)%12)+1}月'
            for i in range(12)
        ],
        'current_events':{
            'ms':current_event_info(ms_event,'MS',cal_cache,dynamic_info_map,cur_month,cur_year,survivor_events),
            'ws':current_event_info(ws_event,'WS',cal_cache,dynamic_info_map,cur_month,cur_year,survivor_events),
        },
        'ms':ms_users,
        'ws':ws_users
    }
    os.makedirs('data',exist_ok=True)
    with open('data/breakdown.json','w',encoding='utf-8') as f:
        json.dump(output,f,ensure_ascii=False,separators=(',',':'))
    size_kb=os.path.getsize('data/breakdown.json')//1024
    print(f"[{now_str}] 完成！{size_kb} KB | ATP:{len(ms_users)} WTA:{len(ws_users)}")


if __name__=='__main__':
    main()
