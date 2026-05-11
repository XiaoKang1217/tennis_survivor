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

def get_active_events(session):
    """从菜单获取当前最新的ATP和WTA比赛"""
    resp = session.get(f'{BASE_URL}/zh/survivor/menu', timeout=15)
    html = resp.text
    ms_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/MS/my"', html)
    ws_events = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/WS/my"', html)
    return (ms_events[0] if ms_events else None, ws_events[0] if ws_events else None)

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
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/2026/{gender}/my'
    r = session.get(url, timeout=15)
    names = set(re.findall(r'<pname>([^<]+)</pname>', r.text))
    names.update(re.findall(r'data-name="([^"]+)"', r.text))
    return sorted(p for p in names if p and p != '轮空')

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

def fetch_rank_data(session, csrf, gender_idx):
    """获取年度排名数据（使用 /zh/survivor/rank/{gender_idx}/year 接口）"""
    all_rows = []
    start = 0
    while True:
        # 注意：排名API路径是 /zh/survivor/rank/{idx}/year
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
    today_day = max((r.get('day', 0) for r in today_rows), default=0)
    today_map = {str(r['user_id']): r for r in today_rows if r.get('day') == today_day}
    print(f"  Today day: {today_day}, filled: {len(today_map)}")
    
    rows_out = []
    for r in score_rows:
        uid = str(r['user_id'])
        ri = rank_dict.get(uid, {})
        cur = ri.get('score', 0) or 0
        det = ri.get('details', '')
        
        # 扣除积分（非删除线部分）
        tmp = re.sub(r'<del>.*?</del>', '', det or '', flags=re.DOTALL)
        dm = re.search(rf'【{re.escape(event_name)}\((\d+)\)】', tmp)
        ded = int(dm.group(1)) if dm else 0
        
        new_s = r.get('score', 0) or 0
        inst = calc_instant(det, new_s, gender, event_name) if det else (cur + new_s - ded)
        
        tr = today_map.get(uid, {})
        rows_out.append({
            'user_id': uid,
            'username': clean_username(r.get('username', '')),
            'status': r.get('status', 0),
            'day': r.get('day', 0),
            'fill_status': r.get('fill_status', ''),
            'current_rank': ri.get('rank'),
            'current_score': cur,
            'deduct_score': ded,
            'this_event_score': new_s,
            'instant_score': inst,
            'today_player': tr.get('player', ''),
            'today_player_alt': tr.get('player_alt', ''),
            'has_today': uid in today_map,
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
    player_stats = Counter(r['today_player'] for r in today_filled)
    alive_count = sum(1 for r in rows_out if r.get('fill_status') == '存活' or r.get('status') == 2)
    
    return {
        'rows': rows_out,
        'today_day': today_day,
        'alive_count': alive_count,
        'filled_count': len(today_filled),
        'total_count': len(rows_out),
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
    
    # 6. 今日球员池
    print("获取今日参赛球员...")
    ms_players = get_today_players_from_page(session, ms_eid, 'MS')
    ws_players = get_today_players_from_page(session, ws_eid, 'WS')
    # 补充 detail 里的球员
    ms_extra = set(
        r['today_player'] for r in ms_data['rows'] if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空'
    ) | set(
        r['today_player_alt'] for r in ms_data['rows'] if r.get('has_today') and r.get('today_player_alt') and r['today_player_alt'] != '轮空'
    )
    ws_extra = set(
        r['today_player'] for r in ws_data['rows'] if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空'
    ) | set(
        r['today_player_alt'] for r in ws_data['rows'] if r.get('has_today') and r.get('today_player_alt') and r['today_player_alt'] != '轮空'
    )
    ms_players = sorted(set(ms_players) | ms_extra)
    ws_players = sorted(set(ws_players) | ws_extra)
    print(f"  ATP今日球员: {len(ms_players)}, WTA今日球员: {len(ws_players)}")
    
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
