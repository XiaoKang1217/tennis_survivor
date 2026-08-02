#!/usr/bin/env python3
"""
签表幸存者之炉网 - 实时数据获取脚本（GitHub Actions 版）
定时运行：自动检测当前进行中的ATP/WTA比赛，更新选人和积分数据
"""
import requests, json, re, time, os, sys
from collections import Counter
from datetime import datetime, timezone, timedelta
import fetch_breakdown as official_scoring

BASE_URL = "https://www.live-tennis.cn"
PICK_COUNTS_PATH = os.path.join('data', 'daily_jinx_pick_counts.json')

# 2026 加拿大站与华盛顿站在 8 月 2 日存在官方赛历日期重叠。
# 当天经纪人 Current Data 只统计加拿大站；此补丁次日自动失效，
# 不改变后续赛事的通用自动选站逻辑。
CURRENT_EVENT_DATE_OVERRIDES = {
    '2026-08-02': {
        'MS': '20421',  # ATP Montreal
        'WS': '30806',  # WTA Toronto
    },
}

REAL_MAX_DAY = {
    '香港':7,'布里斯班':8,'阿德莱德':6,'霍巴特':6,'澳网':13,
    '蒙彼利埃':7,'阿布扎比':7,'鹿特丹':7,'多哈':7,
    '阿卡普尔科':6,'梅里达':7,'印第安维尔斯':11,'迈阿密':11,
    '休斯顿':7,'查尔斯顿':7,'蒙特卡洛':8,'林茨':7,
    '慕尼黑':7,'斯图加特':7,'马德里':11,'罗马':11,
    '汉堡':7,'热内亚':7,'里昂':7,'巴黎':10,'哈雷':7,'温网':14,
    '东京':7,'多伦多':11,'蒙特利尔':11,'辛辛那提':10,'美网':14,'上海':11,
    '维也纳':7,'巴塞尔':7,'法网':14,
}

ATP_GS={'澳网','法网','温网','美网'}
ATP_YE={'都灵','南京','珠海'}
ATP_M1000={'印第安维尔斯','迈阿密','马德里','罗马','多伦多','蒙特利尔','辛辛那提','上海','巴黎'}
WTA_GS={'澳网','法网','温网','美网'}
WTA_YE={'利雅得','深圳','新加坡','珠海'}
WTA_M1000_NC={'多哈','迪拜','武汉'}
WTA_M1000_C={'印第安维尔斯','迈阿密','马德里','罗马','蒙特利尔','多伦多','辛辛那提','北京'}

def make_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': BASE_URL
    })
    return s

def get_page_with_csrf(session, url):
    resp = session.get(url, timeout=20)
    m = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', resp.text)
    csrf = m.group(1) if m else ''
    return resp, csrf

def post_api(session, csrf, iid, suffix, start=0, length=2000):
    r = session.post(
        f'{BASE_URL}/zh/survivor/event/{iid}/{suffix}',
        headers={'X-CSRF-TOKEN': csrf, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest'},
        data=f'draw=1&start={start}&length={length}&device=0',
        timeout=30
    )
    r.raise_for_status()
    return r.json()

def post_api_all(session, csrf, iid, suffix, length=1000):
    """分页读取 DataTables 接口，避免 detail 超过默认 length 后被截断。"""
    start = 0
    all_rows = []
    total = None
    last = None
    while True:
        d = post_api(session, csrf, iid, suffix, start=start, length=length)
        rows = d.get('data', [])
        all_rows.extend(rows)
        if total is None:
            total = int(d.get('recordsTotal') or len(rows) or 0)
        last = d
        if len(all_rows) >= total or not rows:
            break
        start += length
        time.sleep(0.2)
    if last is None:
        return {'data': [], 'recordsTotal': 0}
    last['data'] = all_rows
    last['recordsTotal'] = total if total is not None else len(all_rows)
    return last

def clean_username(html):
    return re.sub(r'<[^>]+>', '', str(html)).strip()

def parse_players(players_str):
    return re.findall(r'【([^】]*)】', players_str or '')

def _event_records_total(session, event_id, gender):
    """返回赛事 score/detail 记录数。菜单会提前露出下一站，不能直接取第一个。"""
    try:
        page_url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/score'
        resp, csrf = get_page_with_csrf(session, page_url)
        if not csrf:
            return 0, 0
        iid = get_internal_id(session, event_id, gender)
        if not iid:
            return 0, 0
        headers = {'X-CSRF-TOKEN': csrf, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest'}
        payload = 'draw=1&start=0&length=1&device=0'
        r_score = session.post(f'{BASE_URL}/zh/survivor/event/{iid}/score', headers=headers, data=payload, timeout=20)
        r_score.raise_for_status()
        d_score = r_score.json()
        score_total = int(d_score.get('recordsTotal') or len(d_score.get('data', [])) or 0)

        r_detail = session.post(f'{BASE_URL}/zh/survivor/event/{iid}/2026/detail', headers=headers, data=payload, timeout=20)
        r_detail.raise_for_status()
        d_detail = r_detail.json()
        detail_total = int(d_detail.get('recordsTotal') or len(d_detail.get('data', [])) or 0)
        return score_total, detail_total
    except Exception as e:
        print(f"  WARN: 检查赛事数据失败 event={event_id} gender={gender}: {e}")
        return 0, 0

def _calendar_active_event(cal_cache, event_name, gender, today):
    if not cal_cache or not event_name or not today:
        return False
    tour = 'ATP' if gender == 'MS' else 'WTA'
    rows = (cal_cache.get('by_alias') or {}).get((tour, official_scoring.norm_event_key(event_name)), [])
    for rec in rows:
        if int(rec.get('year') or 0) != today.year:
            continue
        start = official_scoring.parse_ymd(rec.get('start_date'))
        end = official_scoring.parse_ymd(rec.get('end_date')) or start
        if start and end and start <= today <= end:
            return True
    return False

def _official_current_candidates(session, events, gender, cal_cache, today):
    if not cal_cache or not today:
        return []
    current = []
    for eid in events:
        try:
            name = get_event_name(session, eid, gender)
        except Exception as e:
            print(f"  WARN: 读取赛事名称失败 event={eid} gender={gender}: {e}")
            continue
        if _calendar_active_event(cal_cache, name, gender, today):
            current.append((eid, name))
    if current:
        print(f"  {gender} 官方赛历当前候选: {current[:5]}")
    return current

def _pick_active_event(session, events, gender, cal_cache=None, today=None):
    """从菜单候选里选择真正进行中的赛事：要求 score/detail 都有记录。"""
    if not events:
        return None
    official_current = _official_current_candidates(session, events, gender, cal_cache, today)
    candidates = [eid for eid, _ in official_current] if official_current else events
    checked = []
    for eid in candidates:
        score_total, detail_total = _event_records_total(session, eid, gender)
        checked.append((eid, score_total, detail_total))
        if detail_total > 0:
            print(f"  {gender} 选择进行中赛事 event={eid}, score_records={score_total}, detail_records={detail_total}")
            return eid
    if official_current:
        print(f"  WARN: {gender} 官方当前候选未查到完整 detail，fallback 到官方赛历第一个当前候选: {checked[:5]}")
        return official_current[0][0]
    # 如果所有候选都无完整数据，保底返回菜单第一个，避免流程完全失败
    print(f"  WARN: {gender} 菜单候选均无完整 detail 数据，fallback 到第一个: {checked[:5]}")
    return events[0]

def get_active_events(session, cal_cache=None, now_dt=None):
    """从菜单获取ATP/WTA候选赛事，并过滤掉提前露出的下一站空赛事。"""
    today = now_dt.date() if now_dt else None
    override = CURRENT_EVENT_DATE_OVERRIDES.get(today.isoformat()) if today else None
    if override:
        ms_eid = override['MS']
        ws_eid = override['WS']
        print(
            f"  当日计分站补丁: 仅统计加拿大 ATP event={ms_eid}, "
            f"WTA event={ws_eid}；忽略同日仍可选的华盛顿站"
        )
        return ms_eid, ws_eid

    resp = session.get(f'{BASE_URL}/zh/survivor/menu', timeout=15)
    html = resp.text
    ms_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/MS/my"', html)
    ws_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/WS/my"', html)
    print(f"菜单候选: ATP={ms_events[:5]}, WTA={ws_events[:5]}")
    return (
        _pick_active_event(session, ms_events, 'MS', cal_cache, today),
        _pick_active_event(session, ws_events, 'WS', cal_cache, today),
    )

def get_internal_id(session, event_id, gender, attempts=1):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/score'
    for attempt in range(max(1, attempts)):
        r = session.get(url, timeout=15)
        m = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"', r.text)
        if m:
            return m.group(1)
        m2 = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/\d+/detail"', r.text)
        if m2:
            return m2.group(1)
        if attempt + 1 < attempts:
            print(f"  WARN: 获取内部ID失败 event={event_id} gender={gender}，准备重试 {attempt + 2}/{attempts}")
            time.sleep(attempt + 1)
    return None

def get_event_name(session, event_id, gender):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/my'
    r = session.get(url, timeout=15)
    m = re.search(r'setBrowserTitle\("签表幸存者 - ([^"]+)"\)', r.text)
    if m:
        parts = m.group(1).strip().split()
        if len(parts) >= 2: return parts[1]
    return event_id

def get_today_players_from_page(session, event_id, gender):
    """备用：从幸存者/my页取球员（不再作为主来源）"""
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/my'
    r = session.get(url, timeout=15)
    names = set(re.findall(r'<pname>([^<]+)</pname>', r.text))
    names.update(re.findall(r'data-name="([^"]+)"', r.text))
    return sorted(p for p in names if p and p != '轮空')


def get_today_players_from_result(session, ms_event_id, ws_event_id):
    """从当天赛程页提取当前签表幸存者赛事的所有单打正赛球员。"""
    tz_cn = timezone(timedelta(hours=8))
    today = datetime.now(tz_cn).strftime('%Y-%m-%d')
    url = f'{BASE_URL}/zh/result/{today}'
    html = session.get(url, timeout=30).text

    result = {'MS': set(), 'WS': set()}
    
    # 找到所有赛事块（iResult后面跟赛事名）
    tour_blocks = list(re.finditer(r'id="iResult(\w+)"', html))
    
    for i, block_match in enumerate(tour_blocks):
        tour_name = block_match.group(1)  # 例如 Rome, Hamburg, Strasbourg
        block_start = block_match.start()
        
        # 确定当前赛事块的结束位置（下一个赛事块之前，或页面结尾）
        if i + 1 < len(tour_blocks):
            block_end = tour_blocks[i + 1].start()
        else:
            block_end = len(html)
        
        seg = html[block_start:block_end]
        
        # 从 open_stat() 中提取球员
        for m in re.finditer(r'open_stat\((.*?)\)', seg):
            args = re.findall(r'&quot;([^&]*)&quot;', m.group(1))
            if len(args) < 8:
                continue
            eid, tour, match_id, year, p1id, p2id, p1, p2 = args[:8]
            
            # 限定当前签表幸存者开启赛事
            if eid not in {str(ms_event_id), str(ws_event_id)}:
                continue
            
            # 获取比赛上下文（性别、轮次）
            pre = seg[max(0, m.start()-2500):m.start()]
            
            # 排除双打
            if 'is-double="1"' in pre:
                continue
            
            # 排除资格赛
            gm = re.search(r'<div class=cResultMatchGender>([^<]+)</div>', pre)
            rm = re.search(r'<div class=cResultMatchRound>([^<]+)</div>', pre)
            gender_txt = gm.group(1).strip() if gm else ''
            round_txt = rm.group(1).strip() if rm else ''
            
            if 'Q' in round_txt or '资格' in round_txt:
                continue
            
            # 按性别分类
            if gender_txt == '男单':
                result['MS'].update([p1, p2])
            elif gender_txt == '女单':
                result['WS'].update([p1, p2])

    return {k: sorted(v) for k, v in result.items()}


def parse_all_scores(details_html):
    if not details_html: return {}, {}
    c, nc = {}, {}
    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', details_html):
        c[m.group(1).strip()] = int(m.group(2))
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', details_html):
        nc[m.group(1).strip()] = int(m.group(2))
    tmp = re.sub(r'<b>【[^】]*】</b>', '', details_html)
    tmp = re.sub(r'<del>【[^】]*】</del>', '', tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】', tmp):
        n = m.group(1).strip()
        if n not in c: c[n] = int(m.group(2))
    return c, nc

def calc_current_deduct_score(details_html, gender, ev_name, cal_cache=None, cur_month=None, cur_year=None,
                              survivor_events=None):
    """旧分扣除展示口径：当前站同名旧分 + 已按幸存者赛历到期的旧计分项。"""
    if not details_html:
        return 0
    c, _ = parse_all_scores(details_html)
    if not c:
        return 0
    if not official_scoring.has_official_calendar(cal_cache):
        return int(c.get(ev_name, 0) or 0)

    cur_month = cur_month or datetime.now(timezone(timedelta(hours=8))).month
    cur_year = cur_year or datetime.now(timezone(timedelta(hours=8))).year
    current_meta = official_scoring.get_meta(
        ev_name, gender, cal_cache, None, cur_month, cur_year,
        force_year=cur_year, survivor_events=survivor_events
    ) if ev_name else {}
    current_name_key = official_scoring.norm_event_key(ev_name)
    current_event_key = official_scoring.norm_event_key(
        official_scoring.canonical_event_name(ev_name, current_meta)
    )

    total = 0
    for name, score in c.items():
        meta = official_scoring.get_meta(
            name, gender, cal_cache, None, cur_month, cur_year,
            survivor_events=survivor_events
        )
        name_key = official_scoring.norm_event_key(name)
        event_key = official_scoring.norm_event_key(
            official_scoring.canonical_event_name(name, meta)
        )
        same_current = ev_name and (name_key == current_name_key or event_key == current_event_key)
        if same_current or meta.get('expired_by_survivor_calendar'):
            total += int(score or 0)
    return total

def calc_instant(details_html, new_score, gender, ev_name, cal_cache=None, cur_month=None, cur_year=None,
                 event_overlays=None, uid=None, survivor_events=None):
    if official_scoring.has_official_calendar(cal_cache):
        cur_month = cur_month or datetime.now(timezone(timedelta(hours=8))).month
        cur_year = cur_year or datetime.now(timezone(timedelta(hours=8))).year
        events = official_scoring.parse_details(details_html, gender, cal_cache, None, cur_month, cur_year, survivor_events)
        available = official_scoring.build_live_available_events(events)
        pending_events = official_scoring.overlay_events_for_user(
            event_overlays, uid, gender, current_event_name=ev_name
        ) if uid else []
        available = official_scoring.with_pending_event_candidates(
            available, pending_events, gender, cal_cache, None, cur_month, cur_year, survivor_events
        )
        adjusted = official_scoring.with_current_event_candidate(
            available, gender, ev_name, new_score, cal_cache, None, cur_month, cur_year, survivor_events
        )
        selected = official_scoring.select_events_by_rules(list(adjusted.values()), gender)
        return official_scoring.sum_events(selected)

    c, nc = parse_all_scores(details_html)
    c.pop(ev_name, 0); nc.pop(ev_name, 0)
    av = {}; av.update(nc); av.update(c)
    if new_score > 0:
        av[ev_name] = new_score
    elif ev_name in (ATP_GS if gender == 'MS' else WTA_GS):
        # 大满贯是强制计分项。本站开始后，去年本站积分先扣除；
        # 若用户本站暂未得分，当前大满贯必须以 0 分占住一个计分槽，
        # 不能让其他普通赛事补位。
        av[ev_name] = 0
    def srt(lst): return sorted(lst, key=lambda x: -x[1])
    if gender == 'MS':
        gs = srt([(n,s) for n,s in av.items() if n in ATP_GS])
        ye = srt([(n,s) for n,s in av.items() if n in ATP_YE])
        m1 = srt([(n,s) for n,s in av.items() if n in ATP_M1000])
        m1t = m1[:5]; sp = m1[5:]
        ot = srt([(n,s) for n,s in av.items() if n not in ATP_GS and n not in ATP_YE and n not in ATP_M1000] + sp)
        rem = max(0, 18 - len(gs) - len(m1t))
        return sum(s for _,s in gs) + sum(s for _,s in ye[:1]) + sum(s for _,s in m1t) + sum(s for _,s in ot[:rem])
    else:
        gs = srt([(n,s) for n,s in av.items() if n in WTA_GS])
        ye = srt([(n,s) for n,s in av.items() if n in WTA_YE])
        nc2 = srt([(n,s) for n,s in av.items() if n in WTA_M1000_NC])
        cc = srt([(n,s) for n,s in av.items() if n in WTA_M1000_C])
        nt = nc2[:1]; nsp = nc2[1:]; ct = cc[:6]; csp = cc[6:]
        ot = srt([(n,s) for n,s in av.items() if n not in WTA_GS and n not in WTA_YE and n not in WTA_M1000_NC and n not in WTA_M1000_C] + nsp + csp)
        rem = max(0, 18 - len(gs) - len(nt) - len(ct))
        return sum(s for _,s in gs) + sum(s for _,s in ye[:1]) + sum(s for _,s in nt) + sum(s for _,s in ct) + sum(s for _,s in ot[:rem])


def calc_preview_v5_instant(uid, cur, ded, new_s, det, gender, event_name,
                            cal_cache=None, cur_month=None, cur_year=None, event_overlays=None, survivor_events=None):
    """官方赛历口径即时积分：当前站旧分到期后，按强制组和18站规则重选。"""
    if det:
        return calc_instant(det, new_s, gender, event_name, cal_cache, cur_month, cur_year, event_overlays, uid, survivor_events)
    return cur + new_s - ded

def fetch_rank_data(session, csrf, gender_idx):
    """获取年度排名数据（使用 /zh/survivor/rank/{gender_idx}/year 接口）"""
    all_rows = []
    start = 0
    while True:
        # 注意：排名API的路径是 /zh/survivor/rank/{idx}/year，不是 event
        r = session.post(
            f'{BASE_URL}/zh/survivor/rank/{gender_idx}/year',
            headers={'X-CSRF-TOKEN': csrf, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest'},
            data=f'draw=1&start={start}&length=1000&device=0',
            timeout=30
        )
        r.raise_for_status()
        d = r.json()
        rows = d.get('data', [])
        all_rows.extend(rows)
        total = d.get('recordsTotal', 0)
        if len(all_rows) >= total or not rows:
            break
        start += 1000
        time.sleep(0.3)
    return {
        str(r['user_id']): {
            'rank': r.get('rank'),
            'score': r.get('score', 0),
            'username': clean_username(r.get('username', '')),
            'details': r.get('details', '')
        } for r in all_rows
    }

def fetch_event_data(session, csrf, iid, gender, event_name, rank_dict,
                     cal_cache=None, cur_month=None, cur_year=None, event_overlays=None, survivor_events=None):
    """获取比赛实时数据"""
    # Score
    sd = post_api(session, csrf, iid, 'score')
    score_rows = sd.get('data', [])
    print(f"  Score rows: {len(score_rows)}")
    
    # Detail 可能超过 500 条；必须全量读取，否则 WTA 大满贯 Day1 会被截断。
    dd = post_api_all(session, csrf, iid, '2026/detail', length=1000)
    today_rows = dd.get('data', [])
    score_user_ids = {str(r['user_id']) for r in score_rows}
    settled_days = [
        r.get('day', 0) for r in today_rows
        if str(r.get('fill_status', '')).strip()
    ]
    settled_day = max(settled_days, default=None)
    today_day = max((r.get('day', 0) for r in today_rows), default=settled_day or 0)
    settled_map = {
        str(r['user_id']): r for r in today_rows
        if settled_day is not None and r.get('day') == settled_day
    }
    today_map = {str(r['user_id']): r for r in today_rows if r.get('day') == today_day}

    if score_user_ids or settled_map:
        # Day2 预填记录可能已经出现；只有 score 或已结算日记录才代表本站参赛。
        all_event_user_ids = score_user_ids | set(settled_map.keys())
    else:
        # Day1 未结算前没有 fill_status，只能用当日有效选人临时判断参赛。
        all_event_user_ids = {
            str(r['user_id']) for r in today_rows
            if r.get('day') == today_day and r.get('player') and r.get('player') != '轮空'
        }
   
    # 构建 score 用户快速查找
    score_map = {str(r['user_id']): r for r in score_rows}
    
    rows_out = []
    
    # 遍历本站有效参赛用户；Day2 才首次出现的预填记录不能补成参赛。
    for uid in all_event_user_ids:
        r = score_map.get(uid, {})
        sr = r or settled_map.get(uid, {})
        tr = today_map.get(uid, {})
            
        ri = rank_dict.get(uid, {})
        cur = ri.get('score', 0) or 0
        det = ri.get('details', '')
        
        ded = calc_current_deduct_score(
            det, gender, event_name, cal_cache, cur_month, cur_year, survivor_events
        )
        
        new_s = r.get('score', 0) or 0
        inst = calc_preview_v5_instant(
            uid, cur, ded, new_s, det, gender, event_name,
            cal_cache, cur_month, cur_year, event_overlays, survivor_events
        )
        
        not_participated = False
        today_player = (tr.get('player', '') if tr else '') or ''
        today_player_alt = (tr.get('player_alt', '') if tr else '') or ''
        if sr:
            fill_status = sr.get('fill_status', '')
            status = sr.get('status', 0)
            if not fill_status and not score_user_ids and settled_day is None and today_player and today_player != '轮空':
                fill_status = '存活'
                status = 2
            if not fill_status and not status:
                fill_status = '未参赛'
                status = 1
                not_participated = True
        else:
            fill_status = tr.get('fill_status', '') if tr else '未参赛'
            if not today_player or today_player == '轮空':
                # 只有 detail 没有 score 的用户，如果当天没有实际选人，属于未参赛。
                # 典型场景：Day1 轮空也需要象征性填人；忘填后 Day2 才开始填，仍不能算存活。
                fill_status = '未参赛'
                status = 1
                not_participated = True
            else:
                if not fill_status:
                    fill_status = '存活'
                status = tr.get('status', 2) if tr else 0
                if not status:
                    status = 2
        
        rows_out.append({
            'user_id': uid,
            'username': clean_username(sr.get('username', '') or tr.get('username', '') or ri.get('username', '')),
            'status': status,
            'day': sr.get('day', 0) if sr else 0,
            'fill_status': fill_status,
            'current_rank': ri.get('rank'),
            'current_score': cur,
            'deduct_score': ded,
            'this_event_score': new_s,
            'instant_score': inst,
            'today_player': today_player,
            'today_player_alt': today_player_alt,
            'has_today': uid in today_map and bool(today_player),
            'not_participated': not_participated,
            'players': parse_players(sr.get('players', '') if sr else tr.get('players', '')),
        })
    
    # 合并年度排名中未参加本站的用户，保证即时排名完整
    existing = {str(r.get('user_id')) for r in rows_out}
    for uid2, ri2 in rank_dict.items():
        uid2 = str(uid2)
        if uid2 in existing:
            continue
        cur2 = ri2.get('score', 0) or 0
        det2 = ri2.get('details', '')
        # 未参赛用户也要扣除当前即时口径下已失效的旧计分项。
        ded2 = calc_current_deduct_score(
            det2, gender, event_name, cal_cache, cur_month, cur_year, survivor_events
        )
        inst2 = calc_preview_v5_instant(
            uid2, cur2, ded2, 0, det2, gender, event_name,
            cal_cache, cur_month, cur_year, event_overlays, survivor_events
        )
        rows_out.append({
            'user_id': uid2,
            'username': ri2.get('username') or uid2,
            'status': None,
            'day': 0,
            'fill_status': '未参赛',
            'current_rank': ri2.get('rank'),
            'current_score': cur2,
            'deduct_score': ded2,
            'this_event_score': 0,
            'instant_score': inst2,
            'today_player': '',
            'today_player_alt': '',
            'has_today': False,
            'not_participated': True,
            'players': [],
        })

    # 计算即时排名
    with_rank = sorted([r for r in rows_out if r.get('current_rank')], key=lambda x: -x['instant_score'])
    for i, r in enumerate(with_rank):
        r['instant_rank'] = i + 1
        r['rank_change'] = r['current_rank'] - (i + 1)
    for r in rows_out:
        if not r.get('current_rank'):
            r['instant_rank'] = None
            r['rank_change'] = None
    rows_out.sort(key=lambda x: x.get('instant_rank') or 9999)
    
    # 统计
    today_filled = [r for r in rows_out if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空']
    # 只统计当日仍存活用户的选人
    today_filled_alive = [r for r in today_filled if r.get('fill_status') == '存活' or r.get('status') == 2]
    player_stats = Counter(r['today_player'] for r in today_filled_alive)
    site_rows = [r for r in rows_out if r.get('fill_status') != '未参赛' and not r.get('not_participated')]
    alive_count = sum(1 for r in site_rows if r.get('fill_status') == '存活' or r.get('status') == 2)
    suicide_count = sum(1 for r in site_rows if '自杀' in str(r.get('fill_status', '')))
    
    return {
        'rows': rows_out,
        'today_day': today_day,
        'alive_count': alive_count,
        'filled_count': len(today_filled),
        'total_count': len(site_rows),
        'user_count': len(rows_out),
        'suicide_count': suicide_count,
        'player_stats': player_stats.most_common(),
    }

def update_daily_jinx_pick_counts(output, now_dt):
    date_key = now_dt.date().isoformat()
    existing = []
    if os.path.exists(PICK_COUNTS_PATH):
        try:
            with open(PICK_COUNTS_PATH, 'r', encoding='utf-8') as f:
                existing = json.load(f).get('snapshots', [])
        except Exception:
            existing = []

    by_key = {}
    for item in existing:
        key = (item.get('date'), item.get('tour'), item.get('event_id'))
        if all(key):
            by_key[key] = item

    for group, tour in (('ms', 'ATP'), ('ws', 'WTA')):
        data = output.get(group) or {}
        event_id = data.get('event_id') or ''
        if not event_id:
            continue
        player_counts = {
            str(name): int(count or 0)
            for name, count in data.get('player_stats', [])
            if name
        }
        by_key[(date_key, tour, event_id)] = {
            'date': date_key,
            'tour': tour,
            'event_id': event_id,
            'event_name': data.get('event_name') or '',
            'today_day': data.get('today_day'),
            'filled_count': data.get('filled_count', 0),
            'updated_at': output.get('updated_at') or '',
            'player_counts': player_counts,
        }

    cutoff = now_dt.date() - timedelta(days=90)
    snapshots = []
    for item in by_key.values():
        try:
            item_date = datetime.fromisoformat(item.get('date', '')).date()
        except ValueError:
            continue
        if item_date >= cutoff:
            snapshots.append(item)
    snapshots.sort(key=lambda x: (x.get('date', ''), x.get('tour', ''), x.get('event_id', '')))

    with open(PICK_COUNTS_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'updated_at': output.get('updated_at') or '',
            'snapshots': snapshots,
        }, f, ensure_ascii=False, separators=(',', ':'))
    print(f"每日毒奶选人统计快照: {len(snapshots)} 条")


def update_current_event_overlays(output, now_dt):
    existing = official_scoring.load_current_event_overlays()
    by_key = {}
    for item in existing:
        key = (
            item.get('tour'),
            item.get('event_name'),
            int(item.get('year') or 0),
            item.get('event_id') or '',
        )
        if key[0] and key[1] and key[2]:
            by_key[key] = item

    for group, tour in (('ms', 'ATP'), ('ws', 'WTA')):
        data = output.get(group) or {}
        event_name = data.get('event_name') or ''
        if not event_name:
            continue
        meta = data.get('event_meta') or {}
        year = int(meta.get('year') or now_dt.year)
        event_id = data.get('event_id') or ''
        scores = {
            str(row.get('user_id')): int(row.get('this_event_score') or 0)
            for row in data.get('rows', [])
            if row.get('user_id') is not None
        }
        by_key[(tour, event_name, year, event_id)] = {
            'tour': tour,
            'event_name': event_name,
            'event_id': event_id,
            'year': year,
            'updated_at': output.get('updated_at') or '',
            'event_meta': meta,
            'scores': scores,
        }

    cutoff = now_dt.date() - timedelta(days=90)
    events = []
    for item in by_key.values():
        keep = True
        try:
            item_date = datetime.fromisoformat(str(item.get('updated_at', '')).split()[0]).date()
            keep = item_date >= cutoff
        except Exception:
            keep = True
        if keep:
            events.append(item)
    events.sort(key=lambda x: (x.get('tour') or '', int(x.get('year') or 0), x.get('event_name') or ''))

    os.makedirs(os.path.dirname(official_scoring.CURRENT_EVENT_OVERLAYS_PATH), exist_ok=True)
    with open(official_scoring.CURRENT_EVENT_OVERLAYS_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'updated_at': output.get('updated_at') or '',
            'events': events,
        }, f, ensure_ascii=False, separators=(',', ':'))
    print(f"当前站/待吸收缓存: {len(events)} 站")

def main():
    tz_cn = timezone(timedelta(hours=8))
    now_dt = datetime.now(tz_cn)
    print(f"[{now_dt.strftime('%Y-%m-%d %H:%M:%S')}] 开始更新实时数据...")
    
    session = make_session()
    print("读取官方赛历...")
    cal_cache = official_scoring.load_official_calendar()
    print(f"  官方赛历赛事: {len(cal_cache.get('events', []))} 个")
    if not official_scoring.has_official_calendar(cal_cache):
        print("ERROR: 官方赛历缺失，fetch_current 不再使用硬编码赛历兜底")
        sys.exit(1)
    print("读取幸存者赛事表...")
    survivor_events = official_scoring.load_survivor_events(session, now_dt.year)
    print(f"  幸存者赛事索引: {len(survivor_events.get('events', []))} 个")
    event_overlays = official_scoring.load_current_event_overlays()
    print(f"  当前站/待吸收缓存: {len(event_overlays)} 站")
    
    # 1. 获取活跃比赛
    ms_eid, ws_eid = get_active_events(session, cal_cache, now_dt)
    if not ms_eid or not ws_eid:
        print("ERROR: 未找到活跃比赛")
        sys.exit(1)
    print(f"活跃比赛: ATP event={ms_eid}, WTA event={ws_eid}")
    
    # 2. 获取内部ID和比赛名
    override_today = CURRENT_EVENT_DATE_OVERRIDES.get(now_dt.date().isoformat())
    internal_id_attempts = 3 if override_today else 1
    ms_iid = get_internal_id(session, ms_eid, 'MS', attempts=internal_id_attempts)
    ws_iid = get_internal_id(session, ws_eid, 'WS', attempts=internal_id_attempts)
    if not ms_iid or not ws_iid:
        print("ERROR: 获取内部ID失败")
        sys.exit(1)
    
    ms_name = get_event_name(session, ms_eid, 'MS')
    ws_name = get_event_name(session, ws_eid, 'WS')
    print(f"比赛名称: ATP={ms_name}(iid={ms_iid}), WTA={ws_name}(iid={ws_iid})")
    
    # 3. 获取CSRF token（分别获取ATP和WTA的）
    _, csrf_ms = get_page_with_csrf(session, f'{BASE_URL}/zh/survivor/event/{ms_eid}/2026/MS/score')
    _, csrf_ws = get_page_with_csrf(session, f'{BASE_URL}/zh/survivor/event/{ws_eid}/2026/WS/score')
    
    if not csrf_ms or not csrf_ws:
        print("ERROR: 获取CSRF token失败")
        sys.exit(1)
    print("CSRF tokens 获取成功")
    
    # 4. 年度排名（用ATP的csrf获取MS排名，WTA的csrf获取WS排名）
    print("获取ATP年度排名...")
    ms_rank = fetch_rank_data(session, csrf_ms, '1')
    print(f"  ATP排名用户数: {len(ms_rank)}")
    
    print("获取WTA年度排名...")
    ws_rank = fetch_rank_data(session, csrf_ws, '2')
    print(f"  WTA排名用户数: {len(ws_rank)}")
    
    # 5. 实时数据
    print("获取ATP实时数据...")
    ms_data = fetch_event_data(
        session, csrf_ms, ms_iid, 'MS', ms_name, ms_rank,
        cal_cache, now_dt.month, now_dt.year, event_overlays, survivor_events
    )
    
    print("获取WTA实时数据...")
    ws_data = fetch_event_data(
        session, csrf_ws, ws_iid, 'WS', ws_name, ws_rank,
        cal_cache, now_dt.month, now_dt.year, event_overlays, survivor_events
    )
    
    # 6. 今日球员池：从当天赛程页抓实际有比赛的罗马男单/女单正赛球员
    print("获取今日参赛球员（赛程页）...")
    pools = get_today_players_from_result(session, ms_eid, ws_eid)
    ms_players = pools.get('MS', [])
    ws_players = pools.get('WS', [])
    print(f"  ATP今日赛程球员: {len(ms_players)}, WTA今日赛程球员: {len(ws_players)}")
    
    # 7. 输出
    now_dt = datetime.now(tz_cn)
    now_str = now_dt.strftime('%Y-%m-%d %H:%M:%S')
    ms_event_meta = official_scoring.current_event_info(ms_name, 'MS', cal_cache, None, now_dt.month, now_dt.year, survivor_events)
    ws_event_meta = official_scoring.current_event_info(ws_name, 'WS', cal_cache, None, now_dt.month, now_dt.year, survivor_events)
    output = {
        'updated_at': now_str,
        'ms': {
            'event_id': ms_eid, 'event_name': ms_name,
            'event_meta': ms_event_meta,
            'today_day': ms_data['today_day'],
            'alive_count': ms_data['alive_count'],
            'filled_count': ms_data['filled_count'],
            'total_count': ms_data['total_count'],
            'player_stats': ms_data['player_stats'],
            'today_pool': ms_players,
            'rows': ms_data['rows'],
        },
        'ws': {
            'event_id': ws_eid, 'event_name': ws_name,
            'event_meta': ws_event_meta,
            'today_day': ws_data['today_day'],
            'alive_count': ws_data['alive_count'],
            'filled_count': ws_data['filled_count'],
            'total_count': ws_data['total_count'],
            'player_stats': ws_data['player_stats'],
            'today_pool': ws_players,
            'rows': ws_data['rows'],
        }
    }
    
    os.makedirs('data', exist_ok=True)
    with open('data/current.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
    update_daily_jinx_pick_counts(output, now_dt)
    update_current_event_overlays(output, now_dt)
    
    size_kb = os.path.getsize('data/current.json') // 1024
    print(f"[{now_str}] 完成！文件大小: {size_kb} KB")
    print(f"ATP: {ms_data['total_count']}用户, WTA: {ws_data['total_count']}用户")

if __name__ == '__main__':
    main()
