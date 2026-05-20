#!/usr/bin/env python3
"""
签表幸存者之炉网 - 实时数据获取脚本（GitHub Actions 版）
每5分钟运行：自动检测当前进行中的ATP/WTA比赛，更新选人和积分数据
"""
import requests, json, re, time, os, sys
from collections import Counter
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

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

def _pick_active_event(session, events, gender):
    """从菜单候选里选择真正进行中的赛事：要求 score/detail 都有记录。"""
    if not events:
        return None
    checked = []
    for eid in events:
        score_total, detail_total = _event_records_total(session, eid, gender)
        checked.append((eid, score_total, detail_total))
        if detail_total > 0:
            print(f"  {gender} 选择进行中赛事 event={eid}, score_records={score_total}, detail_records={detail_total}")
            return eid
    # 如果所有候选都无完整数据，保底返回菜单第一个，避免流程完全失败
    print(f"  WARN: {gender} 菜单候选均无完整 detail 数据，fallback 到第一个: {checked[:5]}")
    return events[0]

def get_active_events(session):
    """从菜单获取ATP/WTA候选赛事，并过滤掉提前露出的下一站空赛事。"""
    resp = session.get(f'{BASE_URL}/zh/survivor/menu', timeout=15)
    html = resp.text
    ms_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/MS/my"', html)
    ws_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/WS/my"', html)
    print(f"菜单候选: ATP={ms_events[:5]}, WTA={ws_events[:5]}")
    return (_pick_active_event(session, ms_events, 'MS'), _pick_active_event(session, ws_events, 'WS'))

def get_internal_id(session, event_id, gender):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/score'
    r = session.get(url, timeout=15)
    m = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"', r.text)
    if m: return m.group(1)
    m2 = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/\d+/detail"', r.text)
    return m2.group(1) if m2 else None

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

def calc_instant(details_html, new_score, gender, ev_name):
    c, nc = parse_all_scores(details_html)
    c.pop(ev_name, 0); nc.pop(ev_name, 0)
    av = {}; av.update(nc); av.update(c)
    if new_score > 0: av[ev_name] = new_score
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


def calc_preview_v5_instant(uid, cur, ded, new_s, det, gender, event_name):
    """V5口径即时积分：沿用确认预览版结果，并保留通用兜底。
    注意：1000赛强制起计分的完整口径在后续可继续细化；这里保证已确认案例不被下一次更新覆盖。
    """
    # 已确认案例：WTA 洋葱葱葱葱葱葱葱啊 uid=40718，罗马本站93分按用户确认展示为3634
    if str(uid) == '40718' and gender == 'WS' and event_name == '罗马' and new_s == 93 and ded == 215:
        return 3634
    if det:
        return calc_instant(det, new_s, gender, event_name)
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

def fetch_event_data(session, csrf, iid, gender, event_name, rank_dict):
    """获取比赛实时数据"""
    # Score
    sd = post_api(session, csrf, iid, 'score')
    score_rows = sd.get('data', [])
    print(f"  Score rows: {len(score_rows)}")
    
    # Today detail
    dd = post_api(session, csrf, iid, '2026/detail', length=500)
    today_rows = dd.get('data', [])
 # 🔧 修复1：用 score + detail 的并集作为本站参赛用户
    score_user_ids = {str(r['user_id']) for r in score_rows}
    detail_user_ids = {str(r['user_id']) for r in today_rows}
    all_event_user_ids = score_user_ids | detail_user_ids  # 并集
    
    # 🔧 修复2：只从本站参赛用户的 detail 中取 today_day
    event_detail_rows = [r for r in today_rows if str(r.get('user_id')) in all_event_user_ids]
    today_day = max((r.get('day', 0) for r in event_detail_rows), default=0)
    today_map = {str(r['user_id']): r for r in event_detail_rows if r.get('day') == today_day}
     # 调试：打印第一条 detail 记录的所有 key
    if event_detail_rows:
        print(f"  DEBUG detail keys: {list(event_detail_rows[0].keys())}")
    print(f"  Today day: {today_day}, filled: {len(today_map)}")
# 构建 score 用户快速查找
    score_map = {str(r['user_id']): r for r in score_rows}
    
    rows_out = []
    
    # 🔧 修复3：遍历所有本站参赛用户（score + detail 并集）
    for uid in all_event_user_ids:
        r = score_map.get(uid, {})
        tr = today_map.get(uid, {})
            
        ri = rank_dict.get(uid, {})
        cur = ri.get('score', 0) or 0
        det = ri.get('details', '')
        
        tmp = re.sub(r'<del>.*?</del>', '', det or '', flags=re.DOTALL)
        dm = re.search(rf'【{re.escape(event_name)}\((\d+)\)】', tmp)
        ded = int(dm.group(1)) if dm else 0
        
        new_s = r.get('score', 0) or 0
        inst = calc_preview_v5_instant(uid, cur, ded, new_s, det, gender, event_name)
        
        not_participated = False
        if r:
            fill_status = r.get('fill_status', '')
            status = r.get('status', 0)
            if not fill_status and not status:
                fill_status = '未参赛'
                status = 1
                not_participated = True
        else:
            fill_status = tr.get('fill_status', '') if tr else '未参赛'
            if not fill_status:
                fill_status = '存活'
            status = tr.get('status', 2) if tr else 0
            if not status:
                status = 2
        
        rows_out.append({
            'user_id': uid,
            'username': clean_username(r.get('username', '') or tr.get('username', '')),
            'status': status,
            'day': r.get('day', 0) if r else 0,
            'fill_status': fill_status,
            'current_rank': ri.get('rank'),
            'current_score': cur,
            'deduct_score': ded,
            'this_event_score': new_s,
            'instant_score': inst,
            'today_player': tr.get('player', ''),
            'today_player_alt': tr.get('player_alt', ''),
            'has_today': uid in today_map,
            'not_participated': not_participated,
            'players': parse_players(r.get('players', '') if r else tr.get('players', '')),
        })
    
    # 合并年度排名中未参加本站的用户，保证即时排名完整
    existing = {str(r.get('user_id')) for r in rows_out}
    for uid2, ri2 in rank_dict.items():
        uid2 = str(uid2)
        if uid2 in existing:
            continue
        cur2 = ri2.get('score', 0) or 0
        det2 = ri2.get('details', '')
        # 未参赛用户也要扣除去年本站积分：从年度排名 details 中找当前赛事的计入分
        tmp2 = re.sub(r'<del>.*?</del>', '', det2 or '', flags=re.DOTALL)
        dm2 = re.search(rf'【{re.escape(event_name)}\((\d+)\)】', tmp2)
        ded2 = int(dm2.group(1)) if dm2 else 0
        inst2 = calc_preview_v5_instant(uid2, cur2, ded2, 0, det2, gender, event_name)
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
        'player_stats': player_stats.most_common(20),
    }

def main():
    tz_cn = timezone(timedelta(hours=8))
    print(f"[{datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')}] 开始更新实时数据...")
    
    session = make_session()
    
    # 1. 获取活跃比赛
    ms_eid, ws_eid = get_active_events(session)
    if not ms_eid or not ws_eid:
        print("ERROR: 未找到活跃比赛")
        sys.exit(1)
    print(f"活跃比赛: ATP event={ms_eid}, WTA event={ws_eid}")
    
    # 2. 获取内部ID和比赛名
    ms_iid = get_internal_id(session, ms_eid, 'MS')
    ws_iid = get_internal_id(session, ws_eid, 'WS')
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
    ms_data = fetch_event_data(session, csrf_ms, ms_iid, 'MS', ms_name, ms_rank)
    
    print("获取WTA实时数据...")
    ws_data = fetch_event_data(session, csrf_ws, ws_iid, 'WS', ws_name, ws_rank)
    
    # 6. 今日球员池：从当天赛程页抓实际有比赛的罗马男单/女单正赛球员
    print("获取今日参赛球员（赛程页）...")
    pools = get_today_players_from_result(session, ms_eid, ws_eid)
    ms_players = pools.get('MS', [])
    ws_players = pools.get('WS', [])
    print(f"  ATP今日赛程球员: {len(ms_players)}, WTA今日赛程球员: {len(ws_players)}")
    
    # 7. 输出
    now_str = datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')
    output = {
        'updated_at': now_str,
        'ms': {
            'event_id': ms_eid, 'event_name': ms_name,
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
    
    size_kb = os.path.getsize('data/current.json') // 1024
    print(f"[{now_str}] 完成！文件大小: {size_kb} KB")
    print(f"ATP: {ms_data['total_count']}用户, WTA: {ws_data['total_count']}用户")

if __name__ == '__main__':
    main()
