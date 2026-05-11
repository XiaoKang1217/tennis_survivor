#!/usr/bin/env python3
"""
签表幸存者之炉网 - 用户偏好数据获取脚本
每天运行：统计2026赛季所有用户的参赛偏好数据
"""
import requests, json, re, time, os
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

REAL_MAX_DAY = {
    '香港':7,'布里斯班':8,'阿德莱德':6,'霍巴特':6,'澳网':13,
    '蒙彼利埃':7,'阿布扎比':7,'鹿特丹':7,'多哈':7,
    '阿卡普尔科':6,'梅里达':7,'印第安维尔斯':11,'迈阿密':11,
    '休斯顿':7,'查尔斯顿':7,'蒙特卡洛':8,'林茨':7,
    '慕尼黑':7,'斯图加特':7,'马德里':11,'罗马':11,
    '汉堡':7,'热内亚':7,'里昂':7,'巴黎':10,
}

# 已结束比赛（进行中的不统计夺冠）
FINISHED_EVENTS_CHECK = True  # 通过fill_status='存活'判断是否结束

EVENT_ORDER_MS = ['香港','阿德莱德','澳网','蒙彼利埃','鹿特丹','多哈','阿卡普尔科',
                  '印第安维尔斯','迈阿密','休斯顿','蒙特卡洛','慕尼黑','马德里','罗马']
EVENT_ORDER_WS = ['布里斯班','霍巴特','澳网','阿布扎比','多哈','迪拜','梅里达',
                  '印第安维尔斯','迈阿密','查尔斯顿','林茨','斯图加特','马德里','罗马']

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

def get_all_2026_events(session):
    """2026赛季所有签表幸存者比赛（硬编码，避免 GitHub Actions 环境下赛历页解析不全导致只统计当前站）"""
    return [
        ('20336','MS'),   # ATP 香港
        ('30800','WS'),   # WTA 布里斯班
        ('28998','MS'),   # ATP 阿德莱德
        ('31050','WS'),   # WTA 霍巴特
        ('AO','MS'),      # ATP 澳网
        ('AO','WS'),      # WTA 澳网
        ('20375','MS'),   # ATP 蒙彼利埃
        ('32088','WS'),   # WTA 阿布扎比
        ('20407','MS'),   # ATP 鹿特丹
        ('31003','WS'),   # WTA 多哈
        ('20451','MS'),   # ATP 多哈
        ('30718','WS'),   # WTA 迪拜
        ('20807','MS'),   # ATP 阿卡普尔科
        ('32085','WS'),   # WTA 梅里达
        ('20404','MS'),   # ATP 印第安维尔斯
        ('30609','WS'),   # WTA 印第安维尔斯
        ('20403','MS'),   # ATP 迈阿密
        ('30902','WS'),   # WTA 迈阿密
        ('20717','MS'),   # ATP 休斯顿
        ('30804','WS'),   # WTA 查尔斯顿
        ('20410','MS'),   # ATP 蒙特卡洛
        ('30528','WS'),   # WTA 林茨
        ('20308','MS'),   # ATP 慕尼黑
        ('31051','WS'),   # WTA 斯图加特
        ('21536','MS'),   # ATP 马德里
        ('31038','WS'),   # WTA 马德里
        ('20416','MS'),   # ATP 罗马
        ('30709','WS'),   # WTA 罗马
    ]

def get_internal_id(session, event_id, year, gender):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/score'
    r = session.get(url, timeout=10)
    m = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"', r.text)
    if m: return m.group(1)
    url2 = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/detail'
    r2 = session.get(url2, timeout=10)
    m2 = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/\d+/detail"', r2.text)
    return m2.group(1) if m2 else None

def get_event_name(session, event_id, year, gender):
    url = f'{BASE_URL}/zh/survivor/event/{event_id}/{year}/{gender}/my'
    r = session.get(url, timeout=10)
    m = re.search(r'setBrowserTitle\("签表幸存者 - ([^"]+)"\)', r.text)
    if m:
        parts = m.group(1).strip().split()
        if len(parts) >= 2: return parts[1]
    return event_id

def compute_preference(all_score_data, gender_key):
    """计算用户偏好统计（包含完整逻辑）"""
    eo_list = EVENT_ORDER_MS if gender_key == 'MS' else EVENT_ORDER_WS
    eo = {n: i for i, n in enumerate(eo_list)}
    
    us = defaultdict(lambda: {
        'username': '',
        'elim_p': defaultdict(lambda: [0, 9999, []]),
        'adv_p': defaultdict(lambda: [0, -1, []]),
        'champ_p': defaultdict(list),
        'final_p': defaultdict(list),
        'participated': [], 'eliminated': [], 'championed': [],
        'ev_participated': 0, 'ev_eliminated': 0, 'ev_champion': 0,
    })
    
    for ev_name, ev_data in all_score_data.items():
        users = ev_data.get('users', {})
        real_md = REAL_MAX_DAY.get(ev_name, ev_data.get('max_day', 0))
        ev_idx = eo.get(ev_name, 99)
        # 检查是否结束（有fill_status='存活'的用户说明已结束）
        has_champion = any(u.get('fill_status') == '存活' for u in users.values())
        is_ongoing = not has_champion and ev_data.get('is_current', False)
        if not users or real_md == 0: continue
        
        for uid, u in users.items():
            uid = str(uid)
            username = u.get('username', '')
            if not username: continue
            day = u.get('day', 0)
            fs = u.get('fill_status', '')
            players = u.get('players', [])
            
            if not us[uid]['username']:
                us[uid]['username'] = username
            us[uid]['ev_participated'] += 1
            us[uid]['participated'].append(ev_name)
            
            # 夺冠判断
            is_champ = (fs == '存活' and day == real_md and not is_ongoing)
            
            if is_champ:
                us[uid]['ev_champion'] += 1
                us[uid]['championed'].append(ev_name)
                for i in range(min(day, len(players))):
                    p = players[i]
                    if p and p != '轮空':
                        us[uid]['adv_p'][p][0] += 1
                        us[uid]['adv_p'][p][1] = max(us[uid]['adv_p'][p][1], ev_idx)
                        us[uid]['adv_p'][p][2].append(ev_name)
                idx = real_md - 1
                if idx < len(players) and players[idx] and players[idx] != '轮空':
                    us[uid]['champ_p'][players[idx]].append(ev_name)
            else:
                us[uid]['ev_eliminated'] += 1
                us[uid]['eliminated'].append(ev_name)
                for i in range(min(day, len(players))):
                    p = players[i]
                    if p and p != '轮空':
                        us[uid]['adv_p'][p][0] += 1
                        us[uid]['adv_p'][p][1] = max(us[uid]['adv_p'][p][1], ev_idx)
                        us[uid]['adv_p'][p][2].append(ev_name)
                if fs == '球员输球':
                    if day < len(players) and players[day] and players[day] != '轮空' and players[day] != '':
                        k = players[day]
                        us[uid]['elim_p'][k][0] += 1
                        us[uid]['elim_p'][k][1] = min(us[uid]['elim_p'][k][1], day * 100 + ev_idx)
                        us[uid]['elim_p'][k][2].append(ev_name)
                if day == real_md - 1 and real_md > 1:
                    idx = real_md - 2
                    if idx < len(players) and players[idx] and players[idx] != '轮空' and players[idx] != '':
                        us[uid]['final_p'][players[idx]].append(ev_name)
    
    result = []
    for uid, stats in us.items():
        if stats['ev_participated'] == 0: continue
        el = stats['elim_p']
        if el:
            mc = max(v[0] for v in el.values())
            worst = min([(p,v) for p,v in el.items() if v[0]==mc], key=lambda x: x[1][1])
            wn, wc = worst[0], mc
        else:
            wn, wc = '', 0
        ad = stats['adv_p']
        if ad:
            mc = max(v[0] for v in ad.values())
            best = max([(p,v) for p,v in ad.items() if v[0]==mc], key=lambda x: x[1][1])
            bn, bc = best[0], mc
        else:
            bn, bc = '', 0
        champ_cnt = Counter({p:len(v) for p,v in stats['champ_p'].items()})
        final_cnt = Counter({p:len(v) for p,v in stats['final_p'].items()})
        result.append({
            'user_id': uid,
            'username': stats['username'],
            'events_participated': stats['ev_participated'],
            'events_eliminated': stats['ev_eliminated'],
            'events_champion': stats['ev_champion'],
            'worst_player_name': wn, 'worst_player_count': wc,
            'best_player_name': bn, 'best_player_count': bc,
            'champion_players': '；'.join([f"{p}({c}次)" for p,c in champ_cnt.most_common()]) if champ_cnt else '—',
            'final_players': '；'.join([f"{p}({c}次)" for p,c in final_cnt.most_common()]) if final_cnt else '—',
            # 明细（展开用）
            'detail_participated': stats['participated'],
            'detail_eliminated': stats['eliminated'],
            'detail_championed': stats['championed'],
            'detail_elim': {p: v[2] for p,v in stats['elim_p'].items()},
            'detail_adv': dict(sorted(((p,v[2]) for p,v in stats['adv_p'].items()), key=lambda x:-len(x[1]))[:5]),
            'detail_champ': {p:v for p,v in stats['champ_p'].items()},
            'detail_final': {p:v for p,v in stats['final_p'].items()},
        })
    return result

def main():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 开始更新用户偏好数据...")
    session = make_session()
    
    # 获取所有2026比赛
    events = get_all_2026_events(session)
    print(f"共找到 {len(events)} 个2026年比赛")
    
    csrf_base = get_csrf(session, 'https://www.live-tennis.cn/zh/survivor/rank/MS/year')
    
    ms_score_all = {}  # {name: {users: {uid: {...}}, max_day, is_current}}
    ws_score_all = {}
    
    # 获取当前活跃比赛（用于标记is_current）
    resp = session.get(f'{BASE_URL}/zh/survivor/menu', timeout=10)
    current_ms_links = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/MS/my"', resp.text)
    current_ws_links = re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/2026/WS/my"', resp.text)
    current_ms_eid = current_ms_links[0] if current_ms_links else None
    current_ws_eid = current_ws_links[0] if current_ws_links else None
    
    for eid, gender in events:
        iid = get_internal_id(session, eid, '2026', gender)
        if not iid:
            print(f"  跳过 {eid}/{gender}（无法获取内部ID）")
            continue
        ev_name = get_event_name(session, eid, '2026', gender)
        is_current = (eid == current_ms_eid and gender == 'MS') or (eid == current_ws_eid and gender == 'WS')
        
        try:
            sd = post_api(session, csrf_base, iid, 'score')
            rows = sd.get('data', [])
            max_day = max((r.get('day', 0) for r in rows), default=0)
            
            ev_data = {
                'max_day': max_day,
                'is_current': is_current,
                'users': {str(r['user_id']): {
                    'username': clean_username(r.get('username','')),
                    'status': r.get('status', 0),
                    'day': r.get('day', 0),
                    'fill_status': r.get('fill_status', ''),
                    'players': re.findall(r'【([^】]*)】', r.get('players',''))
                } for r in rows}
            }
            
            if gender == 'MS':
                ms_score_all[ev_name] = ev_data
            else:
                ws_score_all[ev_name] = ev_data
            
            print(f"  OK {ev_name} {gender}: {len(rows)} 用户")
            time.sleep(0.5)
        except Exception as e:
            print(f"  ERR {ev_name} {gender}: {e}")
    
    print("计算用户偏好...")
    ms_pref = compute_preference(ms_score_all, 'MS')
    ws_pref = compute_preference(ws_score_all, 'WS')
    
    tz_cn = timezone(timedelta(hours=8))
    now_str = datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')
    
    os.makedirs('data', exist_ok=True)
    with open('data/preference.json', 'w', encoding='utf-8') as f:
        json.dump({'updated_at': now_str, 'ms': ms_pref, 'ws': ws_pref}, f, ensure_ascii=False, separators=(',', ':'))
    
    print(f"[{now_str}] 偏好数据更新完成！ATP: {len(ms_pref)}, WTA: {len(ws_pref)}")

if __name__ == '__main__':
    main()
