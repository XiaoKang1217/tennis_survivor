#!/usr/bin/env python3
"""
签表幸存者之炉网 - 用户偏好数据获取脚本（稳定版）
每天运行：统计2026赛季所有用户的参赛偏好数据

关键修复：
1. 赛事列表使用 internal_id 硬编码，避免逐站打开页面获取 internal_id 时超时
2. 所有请求带 retry/backoff，live-tennis 偶发超时不直接失败
3. 克星逻辑：fill_status=球员输球时，送走用户的是 players[day]
4. 克星并列：先比送走时 score.day，day越小越克；day相同再比赛站顺序
5. 合并 data/current.json 的 instant_rank，偏好页按即时排名展示
"""
import os
import re
import json
import time
import requests
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://www.live-tennis.cn"

# 真实赛程天数：用于夺冠/决赛口径
REAL_MAX_DAY = {
    '香港': 7, '布里斯班': 8, '阿德莱德': 6, '霍巴特': 6, '澳网': 13,
    '蒙彼利埃': 7, '阿布扎比': 7, '鹿特丹': 7, '多哈': 7,
    '阿卡普尔科': 6, '梅里达': 7, '印第安维尔斯': 11, '迈阿密': 11,
    '休斯顿': 7, '查尔斯顿': 7, '蒙特卡洛': 8, '林茨': 7,
    '慕尼黑': 7, '斯图加特': 7, '马德里': 11, '罗马': 11,
}

EVENT_ORDER_MS = ['香港','阿德莱德','澳网','蒙彼利埃','鹿特丹','多哈','阿卡普尔科',
                  '印第安维尔斯','迈阿密','休斯顿','蒙特卡洛','慕尼黑','马德里','罗马']
EVENT_ORDER_WS = ['布里斯班','霍巴特','澳网','阿布扎比','多哈','迪拜','梅里达',
                  '印第安维尔斯','迈阿密','查尔斯顿','林茨','斯图加特','马德里','罗马']

# 2026 已开赛站点，直接使用幸存者内部 iid，避免 get_internal_id 超时
EVENTS = [
    (121, 'MS', '香港'),
    (122, 'WS', '布里斯班'),
    (123, 'MS', '阿德莱德'),
    (124, 'WS', '霍巴特'),
    (126, 'MS', '澳网'),
    (125, 'WS', '澳网'),
    (127, 'MS', '蒙彼利埃'),
    (128, 'WS', '阿布扎比'),
    (130, 'MS', '鹿特丹'),
    (129, 'WS', '多哈'),
    (132, 'MS', '多哈'),
    (131, 'WS', '迪拜'),
    (134, 'MS', '阿卡普尔科'),
    (133, 'WS', '梅里达'),
    (136, 'MS', '印第安维尔斯'),
    (135, 'WS', '印第安维尔斯'),
    (138, 'MS', '迈阿密'),
    (137, 'WS', '迈阿密'),
    (140, 'MS', '休斯顿'),
    (139, 'WS', '查尔斯顿'),
    (141, 'MS', '蒙特卡洛'),
    (142, 'WS', '林茨'),
    (143, 'MS', '慕尼黑'),
    (144, 'WS', '斯图加特'),
    (145, 'MS', '马德里'),
    (146, 'WS', '马德里'),
    (147, 'MS', '罗马'),
    (148, 'WS', '罗马'),
]

# 当前仍在进行的赛事，不统计夺冠
CURRENT_IID = {
    'MS': 147,
    'WS': 148,
}


def make_session():
    s = requests.Session()
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=1.2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=['GET', 'POST']
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount('https://', adapter)
    s.mount('http://', adapter)
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Referer': BASE_URL,
        'Accept-Language': 'zh-CN,zh;q=0.9',
    })
    return s


def get_csrf(session):
    """取一个可用的 CSRF token。"""
    url = f'{BASE_URL}/zh/survivor/event/20416/2026/MS/score'
    r = session.get(url, timeout=30)
    r.raise_for_status()
    m = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', r.text)
    if not m:
        raise RuntimeError('无法获取 csrf-token')
    return m.group(1)


def post_score(session, csrf, iid, start=0, length=2000):
    url = f'{BASE_URL}/zh/survivor/event/{iid}/score'
    r = session.post(
        url,
        headers={
            'X-CSRF-TOKEN': csrf,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
        },
        data=f'draw=1&start={start}&length={length}&device=0',
        timeout=45
    )
    r.raise_for_status()
    return r.json()


def clean_username(html):
    return re.sub(r'<[^>]+>', '', str(html)).strip()


def parse_players(players_html):
    return re.findall(r'【([^】]*)】', players_html or '')


def load_current_instant_rank():
    """从 data/current.json 合并实时 sheet 的即时排名。"""
    try:
        with open('data/current.json', 'r', encoding='utf-8') as f:
            cur = json.load(f)
        ms_ir = {str(r.get('user_id')): r.get('instant_rank') for r in cur.get('ms', {}).get('rows', []) if r.get('instant_rank')}
        ws_ir = {str(r.get('user_id')): r.get('instant_rank') for r in cur.get('ws', {}).get('rows', []) if r.get('instant_rank')}
        print(f'加载即时排名：ATP {len(ms_ir)} 人，WTA {len(ws_ir)} 人')
        return ms_ir, ws_ir
    except Exception as e:
        print(f'读取 data/current.json 失败，偏好页即时排名将为空：{e}')
        return {}, {}


def compute_preference(all_score_data, gender_key, ir_dict=None):
    eo_list = EVENT_ORDER_MS if gender_key == 'MS' else EVENT_ORDER_WS
    eo = {n: i for i, n in enumerate(eo_list)}

    us = defaultdict(lambda: {
        'username': '',
        'elim_p': defaultdict(lambda: [0, 9999, []]),  # count, tie_key(day*100+event_idx), events
        'adv_p': defaultdict(lambda: [0, -1, []]),     # count, last_event_idx, events
        'champ_p': defaultdict(list),
        'final_p': defaultdict(list),
        'participated': [],
        'eliminated': [],
        'championed': [],
        'ev_participated': 0,
        'ev_eliminated': 0,
        'ev_champion': 0,
    })

    for iid, ev_name, ev_data in all_score_data:
        users = ev_data.get('users', {})
        real_md = REAL_MAX_DAY.get(ev_name, ev_data.get('max_day', 0))
        ev_idx = eo.get(ev_name, 99)
        is_current = (iid == CURRENT_IID.get(gender_key))
        if not users or real_md == 0:
            continue

        for uid, u in users.items():
            uid = str(uid)
            username = u.get('username', '')
            if not username:
                continue
            day = u.get('day', 0)
            fs = u.get('fill_status', '')
            players = u.get('players', [])

            if not us[uid]['username']:
                us[uid]['username'] = username
            us[uid]['ev_participated'] += 1
            us[uid]['participated'].append(ev_name)

            # 夺冠：只统计已结束比赛；正在进行的罗马不统计夺冠
            is_champ = (fs == '存活' and day == real_md and not is_current)

            if is_champ:
                us[uid]['ev_champion'] += 1
                us[uid]['championed'].append(ev_name)
                # 夺冠站所有幸存天都算福星
                for i in range(min(day, len(players))):
                    p = players[i]
                    if p and p != '轮空':
                        us[uid]['adv_p'][p][0] += 1
                        us[uid]['adv_p'][p][1] = max(us[uid]['adv_p'][p][1], ev_idx)
                        us[uid]['adv_p'][p][2].append(ev_name)
                # 带夺冠球员：最高分档，对应最后一天选手
                idx = real_md - 1
                if idx < len(players) and players[idx] and players[idx] != '轮空':
                    us[uid]['champ_p'][players[idx]].append(ev_name)
            else:
                us[uid]['ev_eliminated'] += 1
                us[uid]['eliminated'].append((ev_name, fs))

                # 福星：用户已经幸存的每一天 players[0] 到 players[day-1]
                for i in range(min(day, len(players))):
                    p = players[i]
                    if p and p != '轮空':
                        us[uid]['adv_p'][p][0] += 1
                        us[uid]['adv_p'][p][1] = max(us[uid]['adv_p'][p][1], ev_idx)
                        us[uid]['adv_p'][p][2].append(ev_name)

                # 克星：球员输球时，真正送走用户的是 players[day]
                if fs == '球员输球':
                    if day < len(players) and players[day] and players[day] != '轮空' and players[day] != '':
                        killer = players[day]
                        us[uid]['elim_p'][killer][0] += 1
                        # 并列：先比 score.day，day越小越克；day相同再比赛站顺序
                        us[uid]['elim_p'][killer][1] = min(us[uid]['elim_p'][killer][1], day * 100 + ev_idx)
                        us[uid]['elim_p'][killer][2].append(ev_name)

                # 带进决赛：得到本站次高分档，day = real_max_day - 1
                if day == real_md - 1 and real_md > 1:
                    idx = real_md - 2
                    if idx < len(players) and players[idx] and players[idx] != '轮空' and players[idx] != '':
                        us[uid]['final_p'][players[idx]].append(ev_name)

    result = []
    ir_dict = ir_dict or {}
    for uid, stats in us.items():
        if stats['ev_participated'] == 0:
            continue

        el = stats['elim_p']
        if el:
            mc = max(v[0] for v in el.values())
            worst = min([(p, v) for p, v in el.items() if v[0] == mc], key=lambda x: x[1][1])
            wn, wc = worst[0], mc
        else:
            wn, wc = '', 0

        ad = stats['adv_p']
        if ad:
            mc = max(v[0] for v in ad.values())
            best = max([(p, v) for p, v in ad.items() if v[0] == mc], key=lambda x: x[1][1])
            bn, bc = best[0], mc
        else:
            bn, bc = '', 0

        champ_cnt = Counter({p: len(v) for p, v in stats['champ_p'].items()})
        final_cnt = Counter({p: len(v) for p, v in stats['final_p'].items()})

        result.append({
            'user_id': uid,
            'username': stats['username'],
            'events_participated': stats['ev_participated'],
            'events_eliminated': stats['ev_eliminated'],
            'events_champion': stats['ev_champion'],
            'worst_player_name': wn,
            'worst_player_count': wc,
            'best_player_name': bn,
            'best_player_count': bc,
            'champion_players': '；'.join([f'{p}({c}次)' for p, c in champ_cnt.most_common()]) if champ_cnt else '—',
            'final_players': '；'.join([f'{p}({c}次)' for p, c in final_cnt.most_common()]) if final_cnt else '—',
            'instant_rank': ir_dict.get(uid),
            # 明细，供 index.html 展开行使用
            'detail_participated': stats['participated'],
            'detail_eliminated': [f'{n}（{f}）' for n, f in stats['eliminated']],
            'detail_championed': stats['championed'],
            'detail_elim': {p: v[2] for p, v in stats['elim_p'].items()},
            'detail_adv': dict(sorted(((p, v[2]) for p, v in stats['adv_p'].items()), key=lambda x: -len(x[1]))[:5]),
            'detail_champ': {p: v for p, v in stats['champ_p'].items()},
            'detail_final': {p: v for p, v in stats['final_p'].items()},
        })

    result.sort(key=lambda x: (x.get('instant_rank') is None, x.get('instant_rank') or 9999, -x.get('events_participated', 0)))
    return result


def fetch_all_scores(session, csrf):
    ms_data = []
    ws_data = []
    for iid, gender, name in EVENTS:
        for attempt in range(3):
            try:
                d = post_score(session, csrf, iid)
                rows = d.get('data', [])
                ev_data = {
                    'max_day': max((r.get('day', 0) for r in rows), default=0),
                    'users': {
                        str(r['user_id']): {
                            'username': clean_username(r.get('username', '')),
                            'status': r.get('status', 0),
                            'day': r.get('day', 0),
                            'fill_status': r.get('fill_status', ''),
                            'players': parse_players(r.get('players', '')),
                        }
                        for r in rows
                    }
                }
                if gender == 'MS':
                    ms_data.append((iid, name, ev_data))
                else:
                    ws_data.append((iid, name, ev_data))
                print(f'  OK {name} {gender}: {len(rows)} 用户')
                break
            except Exception as e:
                print(f'  WARN {name} {gender} 第{attempt+1}次失败: {e}')
                time.sleep(2 + attempt * 2)
        else:
            print(f'  ERROR {name} {gender}: 多次重试失败，跳过')
        time.sleep(0.4)
    return ms_data, ws_data


def main():
    tz_cn = timezone(timedelta(hours=8))
    print(f'[{datetime.now(tz_cn).strftime("%Y-%m-%d %H:%M:%S")}] 开始更新用户偏好数据...')
    session = make_session()
    csrf = get_csrf(session)
    print(f'共找到 {len(EVENTS)} 个2026年比赛')

    ms_data, ws_data = fetch_all_scores(session, csrf)
    print('计算用户偏好...')
    ms_ir, ws_ir = load_current_instant_rank()
    ms_pref = compute_preference(ms_data, 'MS', ms_ir)
    ws_pref = compute_preference(ws_data, 'WS', ws_ir)

    now_str = datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')
    os.makedirs('data', exist_ok=True)
    with open('data/preference.json', 'w', encoding='utf-8') as f:
        json.dump({'updated_at': now_str, 'ms': ms_pref, 'ws': ws_pref}, f, ensure_ascii=False, separators=(',', ':'))

    print(f'[{now_str}] 偏好数据更新完成！ATP: {len(ms_pref)}, WTA: {len(ws_pref)}')


if __name__ == '__main__':
    main()
