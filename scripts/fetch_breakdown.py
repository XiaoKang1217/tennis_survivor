#!/usr/bin/env python3
"""
签表幸存者之炉网 - 积分构成数据生成脚本（最终版）
改进：
1. 动态获取赛事月份（并发查询，处理赛事改期，如林茨从10月改到4月）
2. 赛事级别/场地从赛历动态读取（处理升降级）
3. 使用即时积分（instant_score），加入本站当前得分
"""
import re, json, time, os, requests, concurrent.futures
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

# 月份静态映射（fallback：赛事未改期时使用）
MONTH_FALLBACK = {
    '澳网':1,'霍巴特':1,'布里斯班':1,'阿德莱德':1,'奥克兰':1,'香港':1,
    '鹿特丹':2,'多哈':2,'迪拜':2,'阿布扎比':2,'阿卡普尔科':2,'梅里达':2,
    '蒙彼利埃':2,'洛斯卡沃斯':2,'达拉斯':2,'孟菲斯':2,
    '印第安维尔斯':3,'迈阿密':4,'蒙特卡洛':4,'休斯顿':4,'查尔斯顿':4,
    '慕尼黑':5,'斯图加特':5,'马德里':5,'罗马':5,'斯特拉斯堡':5,'布拉格':5,'九江':5,
    '哈雷':6,'马洛卡':6,'柏林':6,'巴特洪堡':6,
    '汉堡':7,'温斯顿塞勒姆':8,'华盛顿':8,'东京':8,'多伦多':8,'蒙特利尔':8,
    '辛辛那提':8,'克利夫兰':8,'美网':9,'首尔':9,
    '北京':10,'上海':10,'武汉':10,'巴塞尔':10,'维也纳':10,
    '林茨':10,'杭州':10,'宁波':10,
    '巴黎':11,'都灵':11,'利雅得':11,'深圳':11,'新加坡':11,'吉达':11,'法网':6,
}

INDOOR_EVENTS = {
    '鹿特丹','巴黎','都灵','霍巴特','林茨','武汉','多哈','达拉斯',
    '维也纳','巴塞尔','斯德哥尔摩','奥斯汀','孟菲斯','首尔',
    '蒙彼利埃','德拉海滩','布鲁塞尔','利雅得','新加坡','深圳','吉达',
}

GS_ATTRS = {'澳网': 'hard_out', '法网': 'clay', '温网': 'grass', '美网': 'hard_out'}
GS_MONTHS = {'澳网': 1, '法网': 6, '温网': 7, '美网': 9}
YE_EVENTS = {
    'ATP': {'都灵': 11, '伦敦': 11},
    'WTA': {'利雅得': 11, '深圳': 11, '新加坡': 11, '吉达': 11},
}

def make_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': BASE_URL
    })
    return s

# ── 赛历读取 ──────────────────────────────────────────────
def scrape_calendar(year, session):
    try:
        r = session.get(f'{BASE_URL}/zh/calendar/{year}', timeout=20)
        html = r.text
    except Exception as e:
        print(f"  ⚠️ 赛历{year}获取失败: {e}"); return {}

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
        return 'hard_in' if name in INDOOR_EVENTS else 'hard_out'

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

# ── 并发查询当年赛事月份（只查可能改期的赛事）─────────────
def _fetch_month_task(args):
    eid, gender, year, hdr = args
    try:
        s2 = requests.Session(); s2.headers.update(hdr)
        g_str = 'WS' if gender == 'WTA' else 'MS'
        r = s2.get(f'{BASE_URL}/zh/survivor/event/{eid}/{year}/{g_str}/score', timeout=10)
        csrf_m = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"', r.text)
        iid_m = re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"', r.text)
        if not csrf_m or not iid_m: return eid, None
        csrf = csrf_m.group(1); iid = iid_m.group(1)
        r3 = s2.post(f'{BASE_URL}/zh/survivor/event/{iid}/{year}/detail',
            headers={'X-CSRF-TOKEN':csrf,'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
            data='draw=1&start=0&length=3&device=0', timeout=10)
        for row in r3.json().get('data', []):
            ds = row.get('date_short','')
            if ds: return eid, int(ds.split('/')[0])
    except: pass
    return eid, None

def fetch_suspect_months(cal_cur_year, cur_month, cur_year, session_headers):
    """
    对当年赛历里，静态月份 > cur_month 的赛事，并发查实际月份。
    返回 {(gender, name): actual_month}
    """
    # 找可能被误判的赛事（静态月份>cur_month，但今年可能已提前举办）
    tasks = []
    eid_to_key = {}
    for (g, name), info in cal_cur_year.items():
        static_m = MONTH_FALLBACK.get(name, 0)
        if static_m > cur_month:  # 静态月份 > 当前月份，可能改期
            eid = info.get('eid')
            if eid and eid not in eid_to_key:
                tasks.append((eid, g, cur_year, session_headers))
                eid_to_key[eid] = (g, name)

    if not tasks:
        return {}

    print(f"  并发查询 {len(tasks)} 个可能改期赛事的实际月份...")
    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(_fetch_month_task, t): t for t in tasks}
        for fut in concurrent.futures.as_completed(futs):
            eid, month = fut.result()
            if month is not None and eid in eid_to_key:
                g, name = eid_to_key[eid]
                result[(g, name)] = month
                # 同一赛事可能有男子和女子两个key
                other_g = 'WTA' if g == 'ATP' else 'ATP'
                if (other_g, name) in cal_cur_year:
                    result[(other_g, name)] = month
    return result

# ── 元数据查找 ────────────────────────────────────────────
def get_meta(ev, gender, cal_cache, dynamic_months, cur_month, cur_year):
    g_str = 'ATP' if gender == 'MS' else 'WTA'
    if ev in GS_ATTRS:
        m = GS_MONTHS[ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'type': 'GS', 'surface': GS_ATTRS[ev], 'month': m, 'year': yr}
    if ev in YE_EVENTS.get(g_str, {}):
        m = YE_EVENTS[g_str][ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'type': 'YE', 'surface': 'hard_in', 'month': m, 'year': yr}

    # 先检查动态月份（当年可能改期的赛事）
    dyn_month = dynamic_months.get((g_str, ev))
    if dyn_month is not None:
        # 有动态月份 → 判断是今年还是去年
        yr = cur_year if dyn_month <= cur_month else cur_year - 1
        # 场地从赛历获取
        cal_yr = cal_cache.get(yr if yr == cur_year else cur_year, {})
        info = cal_yr.get((g_str, ev)) or cal_cache.get(cur_year - 1, {}).get((g_str, ev))
        surf = info['surface'] if info else ('hard_out')
        etype = info['type'] if info else 'A250'
        return {'type': etype, 'surface': surf, 'month': dyn_month, 'year': yr}

    # 用静态月份
    static_m = MONTH_FALLBACK.get(ev, 6)
    yr = cur_year if static_m <= cur_month else cur_year - 1
    # 从赛历获取级别+场地（先查推断年份，再查另一年）
    for y in [yr, cur_year if yr == cur_year - 1 else cur_year - 1]:
        info = cal_cache.get(y, {}).get((g_str, ev))
        if info:
            return {'type': info['type'], 'surface': info['surface'], 'month': static_m, 'year': yr}
    return {'type': 'OTH', 'surface': 'unknown', 'month': static_m, 'year': yr}

def expiry_ym(meta):
    return meta['year'] + 1, meta['month']

def parse_details(det, gender, cal_cache, dynamic_months, cur_month, cur_year):
    if not det: return []
    res = []
    def add(ev, sc, inc, forced):
        meta = get_meta(ev, gender, cal_cache, dynamic_months, cur_month, cur_year)
        ey, em = expiry_ym(meta) if inc else (0, 0)
        res.append({'n':ev,'s':sc,'inc':inc,'forced':forced,'meta':meta,
                    'expiry':f'{ey}年{em}月' if inc else None})
    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', det): add(m.group(1).strip(),int(m.group(2)),True,True)
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', det): add(m.group(1).strip(),int(m.group(2)),False,False)
    tmp=re.sub(r'<b>【[^】]*】</b>','',det); tmp=re.sub(r'<del>【[^】]*】</del>','',tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】',tmp): add(m.group(1).strip(),int(m.group(2)),True,False)
    return res

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

def build_users(rows, gender, ir_map, cur_map, event_name, cal_cache, dynamic_months, cur_month, cur_year):
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
        evs=parse_details(det,gender,cal_cache,dynamic_months,cur_month,cur_year)
        included=[e for e in evs if e['inc']]

        # 当前赛事进行中时，rank details 里可能仍包含上一年同名赛事积分。
        # 例如 2026 罗马进行中，details 里还会有 2025 罗马；如果直接 append 2026 罗马，
        # 前端就会看到两个「罗马」。正确逻辑是：先移除旧同名赛事，再加入今年本站得分。
        if event_name:
            included=[e for e in included if e.get('n') != event_name]

        if this_ev>0 and event_name:
            meta=get_meta(event_name,gender,cal_cache,dynamic_months,cur_month,cur_year)
            ey,em=expiry_ym(meta)
            included.append({'n':event_name,'s':this_ev,'inc':True,'forced':False,'meta':meta,'expiry':f'{ey}年{em}月'})
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
        u={'uid':uid,'n':name,'s':score,'rank':rank,
           'gs':ts.get('GS',0),'ye':ts.get('YE',0),'m1':ts.get('M1000',0),'a5':ts.get('A500',0),'a2':ts.get('A250',0),
           'hard':ho+hi,'clay':ss.get('clay',0),'grass':ss.get('grass',0),'surf_scores':ss,
           'type_evs':{t:[{'n':e['n'],'s':e['s'],'forced':e['forced'],'surf':e['meta']['surface'],'expiry':e['expiry']}
                           for e in sorted(evs2,key=lambda x:-x['s'])] for t,evs2 in te.items()},
           'exp_list':[{'mk':mk,'total':em2.get(mk,{'total':0})['total'],'events':em2.get(mk,{'events':[]})['events']}
                       for mk in EXPIRY_MONTHS]}
        users.append(u)
    users.sort(key=lambda u:ir_map.get(u['uid'],u['rank'] or 9999))
    for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
        calc_feat_pct(users,feat)
    for u in users:
        lb,lc=get_label(u); u['label']=lb; u['label_color']=lc
        u['ir']=ir_map.get(u['uid'],u['rank'])
        for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']: u.pop(f'{feat}_pct',None)
        u.pop('hard',None);u.pop('clay',None);u.pop('grass',None)
    if users: users[0]['label']='🥇 世界第一';users[0]['label_color']='#b45309'
    return users

def main():
    tz_cn=timezone(timedelta(hours=8))
    now=datetime.now(tz_cn); cur_month=now.month; cur_year=now.year
    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 开始生成积分构成数据（最终版）...")
    session=make_session()

    print("读取赛历...")
    cal_cache={}
    for y in [cur_year-1, cur_year]:
        cal_cache[y]=scrape_calendar(y, session)
        print(f"  {y}年: {len(cal_cache[y])} 个赛事"); time.sleep(0.5)

    print("查询可能改期赛事的实际月份（并发）...")
    dynamic_months=fetch_suspect_months(cal_cache[cur_year], cur_month, cur_year, dict(session.headers))
    print(f"  查到 {len(dynamic_months)} 个赛事的实际月份")
    for k,v in dynamic_months.items():
        static=MONTH_FALLBACK.get(k[1],0)
        if static != v:
            print(f"  ⚡ 改期: {k[0]} {k[1]} 静态月份={static} → 实际月份={v}")

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
    ms_users=build_users(ms_rows,'MS',ms_ir,ms_cur,ms_event,cal_cache,dynamic_months,cur_month,cur_year)
    print("构建WTA积分构成...")
    ws_users=build_users(ws_rows,'WS',ws_ir,ws_cur,ws_event,cal_cache,dynamic_months,cur_month,cur_year)

    now_str=now.strftime('%Y-%m-%d %H:%M:%S')
    output={'updated_at':now_str,'ms':ms_users,'ws':ws_users}
    os.makedirs('data',exist_ok=True)
    with open('data/breakdown.json','w',encoding='utf-8') as f:
        json.dump(output,f,ensure_ascii=False,separators=(',',':'))
    size_kb=os.path.getsize('data/breakdown.json')//1024
    print(f"[{now_str}] 完成！{size_kb} KB | ATP:{len(ms_users)} WTA:{len(ws_users)}")

if __name__=='__main__':
    main()
