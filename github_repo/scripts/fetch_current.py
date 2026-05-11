#!/usr/bin/env python3
"""
签表幸存者之炉网 - 实时数据获取脚本
每5分钟运行：自动检测当前进行中的ATP/WTA比赛，更新选人和积分数据
"""
import requests, json, re, time, os
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

# ===== 真实赛程天数 =====
REAL_MAX_DAY = {
    '香港':7,'布里斯班':8,'阿德莱德':6,'霍巴特':6,'澳网':13,
    '蒙彼利埃':7,'阿布扎比':7,'鹿特丹':7,'多哈':7,
    '阿卡普尔科':6,'梅里达':7,'印第安维尔斯':11,'迈阿密':11,
    '休斯顿':7,'查尔斯顿':7,'蒙特卡洛':8,'林茨':7,
    '慕尼黑':7,'斯图加特':7,'马德里':11,'罗马':11,
    '汉堡':7,'巴黎':10,'哈雷':7,'诺丁汉':5,'伯明翰':5,
    '东京':7,'多伦多':11,'蒙特利尔':11,'辛辛那提':10,'温斯顿塞勒姆':7,
    '美网':14,'温网':14,'法网':14,'上海':11,'维也纳':7,'巴塞尔':7,
}

# ATP/WTA 大师赛强制计入规则
ATP_GS = {'澳网','法网','温网','美网'}
ATP_YE = {'都灵','南京','珠海'}
ATP_M1000 = {'印第安维尔斯','迈阿密','马德里','罗马','多伦多','蒙特利尔','辛辛那提','上海','巴黎'}
WTA_GS = {'澳网','法网','温网','美网'}
WTA_YE = {'利雅得','深圳','新加坡','珠海'}
WTA_M1000_NC = {'多哈','迪拜','武汉'}
WTA_M1000_C = {'印第安维尔斯','迈阿密','马德里','罗马','蒙特利尔','多伦多','辛辛那提','北京'}

def make_session():
    s = requests.Session()
    s.headers.update({'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Referer': BASE_URL})
    return s

def get_csrf(session, url):
    resp = session.get(url, timeout=15)
    m = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', resp.text)
    return m.group(1) if m else ''

def post_api(session, csrf, iid, suffix, start=0, length=2000):
    r = session.post(f'{BASE_URL}/zh/survivor/event/{iid}/{suffix}',
        headers={'X-CSRF-TOKEN': csrf, 'Content-Type': 'application/x-www-form-urlencoded'},
        data=f'draw=1&start={start}&length={length}&device=0', timeout=25)
    return r.json()

def clean_username(html):
    return re.sub(r'<[^>]+>', '', str(html)).strip()

def get_active_events(session):
    """从菜单获取当前活跃的ATP和WTA比赛"""
    resp = session.get(f'{BASE_URL}/zh/survivor/menu', timeout=10)
    html = resp.text
    # 找所有比赛链接（按顺序，第一个就是最新的）
    matches = re.findall(r'href="(https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/([A-Z]+)/my)"', html)
    ms_events = [(eid, g, href) for href, eid, g in matches if g == 'MS']
    ws_events = [(eid, g, href) for href, eid, g in matches if g == 'WS']
    return ms_events[0] if ms_events else None, ws_events[0] if ws_events else None

def get_internal_id(session, event_id, year, gender):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/score'
    r = session.get(url, timeout=10)
    m = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"', r.text)
    if m: return m.group(1)
    m2 = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/\d+/detail"', r.text)
    return m2.group(1) if m2 else None

def get_event_name(session, event_id, year, gender):
    """从页面获取比赛名称"""
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/my'
    r = session.get(url, timeout=10)
    m = re.search(r'setBrowserTitle\("签表幸存者 - ([^"]+)"\)', r.text)
    if m:
        title = m.group(1)
        # 格式: "2026 罗马 男单" -> "罗马"
        parts = title.strip().split()
        if len(parts) >= 2:
            return parts[1]
    return event_id

def get_today_players(session, event_id, year, gender):
    """从/my页面获取今日可选所有球员"""
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/my'
    r = session.get(url, timeout=10)
    # 从 pname 标签提取球员名
    names = set(re.findall(r'<pname>([^<]+)</pname>', r.text))
    # 备用：从 data-name 提取
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

def calc_instant(details_html, new_score, gender, ev='罗马'):
    c, nc = parse_all_scores(details_html)
    c.pop(ev, 0); nc.pop(ev, 0)
    av = {}; av.update(nc); av.update(c)
    if new_score > 0: av[ev] = new_score
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

def fetch_event_data(session, csrf, iid, gender, event_name, rank_dict):
    """获取一个比赛的实时数据"""
    # Score 数据
    sd = post_api(session, csrf, iid, 'score')
    score_rows = sd.get('data', [])
    
    # 今日 detail
    today_data = post_api(session, csrf, iid, '2026/detail', length=500)
    today_rows = today_data.get('data', [])
    
    # 找今日 day（取最大值）
    today_day = max((r.get('day', 0) for r in today_rows), default=0)
    today_map = {str(r['user_id']): r for r in today_rows if r.get('day') == today_day}
    
    # 计算即时积分+排名
    rows_calc = []
    ev_name_for_calc = event_name
    
    for r in score_rows:
        uid = str(r['user_id'])
        ri = rank_dict.get(uid, {})
        cur = ri.get('score', 0) or 0
        det = ri.get('details', '')
        
        # 修正 deduct_score（去掉删除线部分）
        tmp = re.sub(r'<del>.*?</del>', '', det or '', flags=re.DOTALL)
        dm = re.search(rf'【{re.escape(event_name)}\((\d+)\)】', tmp)
        ded = int(dm.group(1)) if dm else 0
        
        new_s = r.get('score', 0) or 0
        inst = calc_instant(det, new_s, gender, ev_name_for_calc) if det else (cur + new_s - ded)
        
        today_r = today_map.get(uid, {})
        
        rows_calc.append({
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
            'today_player': today_r.get('player', ''),
            'today_player_alt': today_r.get('player_alt', ''),
            'has_today': uid in today_map,
        })
    
    # 计算即时排名
    with_rank = sorted([r for r in rows_calc if r.get('current_rank')], key=lambda x: -x['instant_score'])
    for i, r in enumerate(with_rank):
        r['instant_rank'] = i + 1
        r['rank_change'] = r['current_rank'] - (i + 1)
    for r in rows_calc:
        if not r.get('current_rank'):
            r['instant_rank'] = None
            r['rank_change'] = None
    
    rows_calc.sort(key=lambda x: x.get('instant_rank') or 9999)
    
    # 今日选人统计
    from collections import Counter
    today_filled = [r for r in rows_calc if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空']
    player_stats = Counter(r['today_player'] for r in today_filled)
    alive_count = sum(1 for r in rows_calc if r.get('fill_status') == '存活' or r.get('status') == 2)
    
    return {
        'rows': rows_calc,
        'today_day': today_day,
        'alive_count': alive_count,
        'filled_count': len(today_filled),
        'player_stats': player_stats.most_common(20),
    }

def main():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 开始更新实时数据...")
    session = make_session()
    
    # 获取活跃比赛
    ms_event, ws_event = get_active_events(session)
    if not ms_event or not ws_event:
        print("未找到活跃比赛，跳过")
        return
    
    ms_eid, ms_gender, ms_url = ms_event
    ws_eid, ws_gender, ws_url = ws_event
    
    print(f"当前比赛: ATP={ms_eid}, WTA={ws_eid}")
    
    # 获取内部ID
    ms_iid = get_internal_id(session, ms_eid, '2026', 'MS')
    ws_iid = get_internal_id(session, ws_eid, '2026', 'WS')
    if not ms_iid or not ws_iid:
        print("获取内部ID失败")
        return
    
    # 获取比赛名称
    ms_name = get_event_name(session, ms_eid, '2026', 'MS')
    ws_name = get_event_name(session, ws_eid, '2026', 'WS')
    print(f"比赛名称: ATP={ms_name}, WTA={ws_name}")
    
    # 获取 CSRF token
    csrf = get_csrf(session, f'{BASE_URL}/zh/survivor/event/{ms_eid}/2026/MS/score')
    
    # 获取年度排名数据
    print("获取ATP年度排名...")
    ms_rank_raw = post_api(session, csrf, '1', 'year', 0, 3000)
    ms_rank = {}
    for r in ms_rank_raw.get('data', []):
        ms_rank[str(r['user_id'])] = {
            'rank': r.get('rank'),
            'score': r.get('score', 0),
            'details': r.get('details', '')
        }
    
    csrf2 = get_csrf(session, f'{BASE_URL}/zh/survivor/event/{ws_eid}/2026/WS/score')
    print("获取WTA年度排名...")
    ws_rank_raw = post_api(session, csrf2, '2', 'year', 0, 3000)
    ws_rank = {}
    for r in ws_rank_raw.get('data', []):
        ws_rank[str(r['user_id'])] = {
            'rank': r.get('rank'),
            'score': r.get('score', 0),
            'details': r.get('details', '')
        }
    
    # 获取实时数据
    print("获取ATP实时数据...")
    ms_data = fetch_event_data(session, csrf, ms_iid, 'MS', ms_name, ms_rank)
    
    print("获取WTA实时数据...")
    ws_data = fetch_event_data(session, csrf2, ws_iid, 'WS', ws_name, ws_rank)
    
    # 获取今日球员池
    ms_players = get_today_players(session, ms_eid, '2026', 'MS')
    ws_players = get_today_players(session, ws_eid, '2026', 'WS')
    # 补充 detail 里的球员
    ms_detail_players = list(set(
        r['today_player'] for r in ms_data['rows'] if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空'
    ) | set(
        r['today_player_alt'] for r in ms_data['rows'] if r.get('has_today') and r.get('today_player_alt') and r['today_player_alt'] != '轮空'
    ))
    ws_detail_players = list(set(
        r['today_player'] for r in ws_data['rows'] if r.get('has_today') and r.get('today_player') and r['today_player'] != '轮空'
    ) | set(
        r['today_player_alt'] for r in ws_data['rows'] if r.get('has_today') and r.get('today_player_alt') and r['today_player_alt'] != '轮空'
    ))
    ms_players = sorted(set(ms_players + ms_detail_players))
    ws_players = sorted(set(ws_players + ws_detail_players))
    
    # 生成输出
    tz_cn = timezone(timedelta(hours=8))
    now_str = datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')
    
    output = {
        'updated_at': now_str,
        'ms': {
            'event_id': ms_eid,
            'event_name': ms_name,
            'today_day': ms_data['today_day'],
            'alive_count': ms_data['alive_count'],
            'filled_count': ms_data['filled_count'],
            'total_count': len(ms_data['rows']),
            'player_stats': ms_data['player_stats'],
            'today_pool': ms_players,
            'rows': ms_data['rows'],
        },
        'ws': {
            'event_id': ws_eid,
            'event_name': ws_name,
            'today_day': ws_data['today_day'],
            'alive_count': ws_data['alive_count'],
            'filled_count': ws_data['filled_count'],
            'total_count': len(ws_data['rows']),
            'player_stats': ws_data['player_stats'],
            'today_pool': ws_players,
            'rows': ws_data['rows'],
        }
    }
    
    # 保存
    os.makedirs('data', exist_ok=True)
    with open('data/current.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
    
    print(f"[{now_str}] 更新完成! ATP: {len(ms_data['rows'])}用户, WTA: {len(ws_data['rows'])}用户")

if __name__ == '__main__':
    main()
