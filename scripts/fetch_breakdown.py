#!/usr/bin/env python3
"""
签表幸存者之炉网 - 积分构成数据生成脚本 v2
改进：
1. 动态从 live-tennis.cn 赛历读取赛事元数据（级别/场地），按年份准确匹配
2. 使用即时积分（instant_score）而非当前积分（score），与实时选人对齐
"""
import re, json, time, os, requests
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

# ============================================================
# 已知室内赛事（颜色无法区分室内室外，需要手动维护）
# ============================================================
INDOOR_EVENTS = {
    '鹿特丹','巴黎','都灵','霍巴特','林茨','武汉','多哈','达拉斯',
    '维也纳','巴塞尔','斯德哥尔摩','奥斯汀','孟菲斯','首尔',
    '蒙彼利埃','德拉海滩','布鲁塞尔','利雅得','新加坡','深圳',
}

# 大满贯（特殊处理）
GS_EVENTS = {'澳网': 1, '法网': 6, '温网': 7, '美网': 9}

# 年终（特殊处理）
YE_EVENTS = {
    'ATP': {'都灵': 11, '伦敦': 11},
    'WTA': {'利雅得': 11, '深圳': 11, '新加坡': 11, '吉达': 11},
}

# ============================================================
# 动态读取赛历
# ============================================================
def scrape_calendar_year(year, session):
    """从赛历页面获取该年所有赛事的级别+场地+月份"""
    try:
        r = session.get(f'{BASE_URL}/zh/calendar/{year}', timeout=20)
        html = r.text
    except Exception as e:
        print(f"  ⚠️ 赛历{year}获取失败: {e}")
        return {}

    def logo_to_type(logo):
        logo = logo.lower()
        if 'gs-' in logo or '-gs' in logo: return 'BOTH', 'GS'
        if 'wta-final' in logo or 'wta-lvr' in logo: return 'WTA', 'YE'
        if 'atp-final' in logo or 'atp-lvr' in logo: return 'ATP', 'YE'
        if 'wta-1000' in logo: return 'WTA', 'M1000'
        if 'wta-500' in logo: return 'WTA', 'A500'
        if 'wta-250' in logo: return 'WTA', 'A250'
        if 'atp-1000' in logo: return 'ATP', 'M1000'
        if 'atp-500' in logo: return 'ATP', 'A500'
        if 'atp-250' in logo: return 'ATP', 'A250'
        return None, 'OTH'

    def color_to_base_surface(color):
        c = color.lower()
        if c in ('#f85a40', '#c84b34', '#a0522d', '#cc4400'): return 'clay'
        if c in ('#a4c639', '#336b2a', '#4cbc4c', '#5a8a3c', '#8fbc8f'): return 'grass'
        return 'hard'

    # 提取每个赛事块中的位置信息（用于推算月份）
    # 赛历是以日期为列的表格，每个 td 的 colspan 代表天数
    # 通过统计 colspan 累计推算月份（较复杂）
    # 简化方案：从赛事签表页面获取日期，或从已有知识
    # 实际上：月份信息在 live-tennis.cn 赛历里不容易直接提取
    # 我们用"赛事名称→月份"的静态映射作为 fallback

    pattern = re.compile(
        r'href="https://www\.live-tennis\.cn/zh/draw/(\d+)/' + str(year) + r'"\s+'
        r'style="background-color:\s*(#[0-9a-fA-F]+)"\s*>\s*'
        r'<img[^>]*level_logo/([^"]+)"[^>]*/>\s*'
        r'(?:<img[^>]*/>\s*)?'
        r'([^\n<]{2,25})\s*</div>',
        re.DOTALL
    )

    events = {}
    for m in pattern.finditer(html):
        eid, color, logo, name = m.group(1), m.group(2), m.group(3), m.group(4).strip()
        gender, etype = logo_to_type(logo)
        if not gender or etype == 'OTH':
            continue

        base = color_to_base_surface(color)
        surface = base
        if base == 'hard':
            surface = 'hard_in' if name in INDOOR_EVENTS else 'hard_out'

        if gender == 'BOTH':
            for g in ('ATP', 'WTA'):
                events[(g, name)] = {'type': etype, 'surface': surface, 'eid': eid}
        else:
            events[(gender, name)] = {'type': etype, 'surface': surface, 'eid': eid}

    return events

# ============================================================
# 月份静态映射（fallback，动态读取无月份时用）
# ============================================================
MONTH_FALLBACK = {
    '澳网':1,'霍巴特':1,'布里斯班':1,'阿德莱德':1,'奥克兰':1,'香港':1,
    '鹿特丹':2,'多哈':2,'迪拜':2,'阿布扎比':2,'阿卡普尔科':2,'梅里达':2,
    '蒙彼利埃':2,'洛斯卡沃斯':2,'达拉斯':2,'孟菲斯':2,'布宜诺斯艾利斯':2,
    '印第安维尔斯':3,'迈阿密':4,'蒙特卡洛':4,'休斯顿':4,'查尔斯顿':4,
    '慕尼黑':5,'斯图加特':5,'马德里':5,'罗马':5,'斯特拉斯堡':5,'布拉格':5,
    '九江':5,'汉堡':7,'哈雷':6,'马洛卡':6,'伊斯特本':6,'柏林':6,
    '巴特洪堡':6,'诺丁汉':6,'温网':7,'温斯顿塞勒姆':8,'华盛顿':8,'东京':8,
    '首尔':9,'宁波':10,'多伦多':8,'蒙特利尔':8,'辛辛那提':8,'美网':9,'克利夫兰':8,
    '北京':10,'上海':10,'武汉':10,'巴塞尔':10,'维也纳':10,'林茨':10,
    '巴黎':11,'都灵':11,'利雅得':11,'深圳':11,'新加坡':11,'吉达':11,'伦敦':11,
    '法网':6,'杭州':10,'北京':10,
}

def get_meta_dynamic(ev, gender, year, cal_cache):
    """按年份查找赛事元数据"""
    # 先查当年赛历
    key = ('ATP' if gender == 'MS' else 'WTA', ev)
    meta = cal_cache.get(year, {}).get(key)
    if not meta:
        # 大满贯特殊处理
        if ev in GS_EVENTS:
            month = GS_EVENTS[ev]
            return {'type': 'GS', 'surface': 'clay' if ev == '法网' else ('grass' if ev == '温网' else 'hard_out'), 'month': month}
        # 年终特殊处理
        g_str = 'ATP' if gender == 'MS' else 'WTA'
        if ev in YE_EVENTS.get(g_str, {}):
            return {'type': 'YE', 'surface': 'hard_in', 'month': YE_EVENTS[g_str][ev]}
        # fallback：未知赛事
        return {'type': 'OTH', 'surface': 'unknown', 'month': MONTH_FALLBACK.get(ev, 6)}

    month = MONTH_FALLBACK.get(ev, 6)
    return {'type': meta['type'], 'surface': meta['surface'], 'month': month}

def infer_event_year(event_month, cur_month, cur_year):
    """推断积分对应的年份（52周滚动）"""
    if event_month <= cur_month:
        return cur_year      # 今年已举办
    else:
        return cur_year - 1  # 去年举办，今年还没开始

def expiry_ym(event_month, cur_month, cur_year):
    """计算失效年月（下一年同月）"""
    ev_year = infer_event_year(event_month, cur_month, cur_year)
    return ev_year + 1, event_month

def parse_details(det, gender, cur_month, cur_year, cal_cache):
    if not det: return []
    res = []

    def add_event(ev, sc, inc, forced, det_type='inline'):
        year = infer_event_year(
            MONTH_FALLBACK.get(ev, 6) if det_type == 'inline' else 6,
            cur_month, cur_year
        )
        meta = get_meta_dynamic(ev, gender, year, cal_cache)
        ey, em = expiry_ym(meta['month'], cur_month, cur_year)
        res.append({
            'n': ev, 's': sc, 'inc': inc, 'forced': forced,
            'meta': meta, 'expiry': f'{ey}年{em}月' if inc else None
        })

    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', det):
        add_event(m.group(1).strip(), int(m.group(2)), True, True)
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', det):
        add_event(m.group(1).strip(), int(m.group(2)), False, False)
    tmp = re.sub(r'<b>【[^】]*】</b>', '', det)
    tmp = re.sub(r'<del>【[^】]*】</del>', '', tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】', tmp):
        add_event(m.group(1).strip(), int(m.group(2)), True, False)
    return res

# ============================================================
# 标签逻辑（复用之前版本，不变）
# ============================================================
def get_label(u):
    total = u['s'] or 1
    gs=u['gs']; ye=u['ye']; m1=u['m1']; a5=u['a5']
    hard=u['hard']; cl=u['clay']; gr=u['grass']
    gs_pct=u['gs_pct']; ye_pct=u.get('ye_pct',0); m1_pct=u['m1_pct']
    a5_pct=u['a5_pct']; hard_pct=u['hard_pct']; cl_pct=u['clay_pct']; gr_pct=u['grass_pct']
    gs_r=gs/total; ye_r=ye/total; m1_r=m1/total; a5_r=a5/total
    hard_r=hard/total; cl_r=cl/total; gr_r=gr/total
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
    overall_pct=(gs_pct+m1_pct)/2
    if overall_pct>=85: return '🧩 全面稳健型','#475569'
    if overall_pct>=65: return '🧩 全面均衡型','#64748b'
    if overall_pct>=35: return '🌀 积分探索者','#94a3b8'
    return '🌱 初出茅庐','#9ca3af'

def calc_feat_pct(users, feat):
    vals = sorted([u[feat] for u in users], reverse=True)
    n = len(vals)
    for u in users:
        v = u[feat]
        rank = sum(1 for x in vals if x > v)
        u[f'{feat}_pct'] = (1 - rank/n)*100 if n > 0 else 0

def make_session():
    s = requests.Session()
    s.headers.update({'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36','Accept-Language':'zh-CN,zh;q=0.9','Referer':BASE_URL})
    return s

def fetch_rank_data(session, csrf, gender_idx):
    all_rows = []
    start = 0
    while True:
        r = session.post(f'{BASE_URL}/zh/survivor/rank/{gender_idx}/year',
            headers={'X-CSRF-TOKEN':csrf,'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
            data=f'draw=1&start={start}&length=1000&device=0',timeout=30)
        r.raise_for_status()
        d = r.json()
        rows = d.get('data',[])
        all_rows.extend(rows)
        total = d.get('recordsTotal',0)
        if len(all_rows) >= total or not rows: break
        start += 1000
        time.sleep(0.3)
    return all_rows

def build_users(rows, gender, ir_map, cur_map, event_name, cal_cache, cur_month, cur_year):
    """
    ir_map: uid → instant_rank
    cur_map: uid → {instant_score, this_event_score, current_score, deduct_score}
    event_name: 当前进行中的赛事名
    """
    EXPIRY_MONTHS = []
    m2, y2 = cur_month+1, cur_year
    if m2>12: m2=1; y2+=1
    for _ in range(12):
        EXPIRY_MONTHS.append(f'{y2}年{m2}月'); m2+=1
        if m2>12: m2=1; y2+=1

    users = []
    for r in rows:
        uid = str(r.get('user_id',''))
        name = re.sub(r'<[^>]+>','',str(r.get('username',''))).strip()
        rank = r.get('rank',9999) or 9999
        det = r.get('details','')

        # ── 使用即时积分 ──────────────────────────────────────
        cur_info = cur_map.get(uid, {})
        instant_score = cur_info.get('instant_score', r.get('score',0) or 0)
        this_event_score = cur_info.get('this_event_score', 0)
        score = instant_score  # 用即时积分作为总分

        # ── 解析积分明细（从details） ─────────────────────────
        events = parse_details(det, gender, cur_month, cur_year, cal_cache)
        included = [e for e in events if e['inc']]

        # ── 加入本站当前得分 ───────────────────────────────────
        if this_event_score > 0 and event_name:
            ev_meta = get_meta_dynamic(event_name, gender, cur_year, cal_cache)
            ey, em = expiry_ym(ev_meta['month'], cur_month, cur_year)
            included.append({
                'n': event_name, 's': this_event_score,
                'inc': True, 'forced': False,
                'meta': ev_meta, 'expiry': f'{ey}年{em}月'
            })

        # ── 汇总各维度积分 ────────────────────────────────────
        ts, te, ss, em2 = {}, {}, {}, {}
        for e in included:
            t = e['meta']['type']; sk = e['meta']['surface']; sc2 = e['s']
            ts[t] = ts.get(t,0) + sc2
            if t not in te: te[t] = []
            te[t].append(e)
            ss[sk] = ss.get(sk,0) + sc2
            if e['expiry']:
                if e['expiry'] not in em2: em2[e['expiry']] = {'total':0,'events':[]}
                em2[e['expiry']]['total'] += sc2
                em2[e['expiry']]['events'].append(f"{e['n']}({sc2})")

        ho = ss.get('hard_out',0); hi = ss.get('hard_in',0)
        u = {
            'uid': uid, 'n': name, 's': score, 'rank': rank,
            'gs': ts.get('GS',0), 'ye': ts.get('YE',0),
            'm1': ts.get('M1000',0), 'a5': ts.get('A500',0), 'a2': ts.get('A250',0),
            'hard': ho+hi, 'clay': ss.get('clay',0), 'grass': ss.get('grass',0),
            'surf_scores': ss,
            'type_evs': {t: [{'n':e['n'],'s':e['s'],'forced':e['forced'],'surf':e['meta']['surface'],'expiry':e['expiry']}
                              for e in sorted(evs,key=lambda x:-x['s'])]
                         for t,evs in te.items()},
            'exp_list': [{'mk':mk,'total':em2.get(mk,{'total':0})['total'],'events':em2.get(mk,{'events':[]})['events']}
                         for mk in EXPIRY_MONTHS],
        }
        users.append(u)

    users.sort(key=lambda u: ir_map.get(u['uid'], u['rank'] or 9999))
    for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
        calc_feat_pct(users, feat)
    for u in users:
        lb, lc = get_label(u)
        u['label'] = lb; u['label_color'] = lc
        u['ir'] = ir_map.get(u['uid'], u['rank'])
        for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
            u.pop(f'{feat}_pct', None)
        u.pop('hard', None); u.pop('clay', None); u.pop('grass', None)
    if users:
        users[0]['label'] = '🥇 世界第一'; users[0]['label_color'] = '#b45309'
    return users

def main():
    tz_cn = timezone(timedelta(hours=8))
    now = datetime.now(tz_cn)
    cur_month = now.month
    cur_year = now.year
    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 开始生成积分构成数据（v2）...")

    session = make_session()

    # ── 动态读取两年的赛历 ─────────────────────────────────
    print("读取赛历数据（动态按年份匹配）...")
    cal_cache = {}
    for y in [cur_year - 1, cur_year]:
        cal_cache[y] = scrape_calendar_year(y, session)
        print(f"  {y}年: {len(cal_cache[y])} 个赛事")
        time.sleep(0.5)

    # ── 获取排名数据 ───────────────────────────────────────
    resp_ms = session.get(f'{BASE_URL}/zh/survivor/rank/MS/year', timeout=20)
    csrf_ms = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', resp_ms.text).group(1)
    resp_ws = session.get(f'{BASE_URL}/zh/survivor/rank/WS/year', timeout=20)
    csrf_ws = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', resp_ws.text).group(1)

    print("获取ATP排名..."); ms_rows = fetch_rank_data(session, csrf_ms, '1')
    print(f"  ATP: {len(ms_rows)} 用户")
    print("获取WTA排名..."); ws_rows = fetch_rank_data(session, csrf_ws, '2')
    print(f"  WTA: {len(ws_rows)} 用户")

    # ── 读取 current.json 获取即时积分 ─────────────────────
    try:
        with open('data/current.json', encoding='utf-8') as f:
            cur = json.load(f)
        ms_ir = {str(r['user_id']): r.get('instant_rank') for r in cur['ms']['rows'] if r.get('instant_rank')}
        ws_ir = {str(r['user_id']): r.get('instant_rank') for r in cur['ws']['rows'] if r.get('instant_rank')}
        ms_cur = {str(r['user_id']): {'instant_score': r.get('instant_score',0) or 0,
                                       'this_event_score': r.get('this_event_score',0) or 0,
                                       'current_score': r.get('current_score',0) or 0,
                                       'deduct_score': r.get('deduct_score',0) or 0}
                  for r in cur['ms']['rows']}
        ws_cur = {str(r['user_id']): {'instant_score': r.get('instant_score',0) or 0,
                                       'this_event_score': r.get('this_event_score',0) or 0,
                                       'current_score': r.get('current_score',0) or 0,
                                       'deduct_score': r.get('deduct_score',0) or 0}
                  for r in cur['ws']['rows']}
        ms_event = cur['ms'].get('event_name','')
        ws_event = cur['ws'].get('event_name','')
        print(f"当前赛事: ATP={ms_event}, WTA={ws_event}")
    except Exception as e:
        print(f"  读取current.json失败: {e}"); ms_ir={}; ws_ir={}; ms_cur={}; ws_cur={}; ms_event=''; ws_event=''

    # ── 构建用户数据 ───────────────────────────────────────
    print("构建ATP积分构成（即时积分+动态赛历）...")
    ms_users = build_users(ms_rows, 'MS', ms_ir, ms_cur, ms_event, cal_cache, cur_month, cur_year)
    print("构建WTA积分构成（即时积分+动态赛历）...")
    ws_users = build_users(ws_rows, 'WS', ws_ir, ws_cur, ws_event, cal_cache, cur_month, cur_year)

    # ── 输出 ───────────────────────────────────────────────
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')
    output = {'updated_at': now_str, 'ms': ms_users, 'ws': ws_users}
    os.makedirs('data', exist_ok=True)
    with open('data/breakdown.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',',':'))
    size_kb = os.path.getsize('data/breakdown.json') // 1024
    print(f"[{now_str}] 完成！breakdown.json: {size_kb} KB")
    print(f"ATP: {len(ms_users)} 用户，WTA: {len(ws_users)} 用户")

if __name__ == '__main__':
    main()
