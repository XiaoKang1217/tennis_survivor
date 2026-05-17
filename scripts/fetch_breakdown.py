#!/usr/bin/env python3
"""
签表幸存者之炉网 - 积分构成数据生成脚本（动态赛历版）
改进：
1. 从 /zh/draw/{eid}/{year} 动态获取每个赛事实际月份和场地（自动处理ATP/WTA同地不同月）
2. 赛事级别从赛历动态读取（处理升降级）
3. 使用即时积分（instant_score），加入本站当前得分
"""
import re, json, time, os, requests
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

GS_ATTRS = {'澳网': 'hard_out', '法网': 'clay', '温网': 'grass', '美网': 'hard_out'}
GS_MONTHS = {'澳网': 1, '法网': 6, '温网': 7, '美网': 9}
YE_EVENTS = {
    'ATP': {'都灵': 11, '伦敦': 11},
    'WTA': {'利雅得': 11, '深圳': 11, '新加坡': 11, '吉达': 11},
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

# ── 元数据查找 ────────────────────────────────────────────
def get_meta(ev, gender, cal_cache, dynamic_info_map, cur_month, cur_year):
    g_str = 'ATP' if gender == 'MS' else 'WTA'

    # 大满贯
    if ev in GS_ATTRS:
        m = GS_MONTHS[ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'type': 'GS', 'surface': GS_ATTRS[ev], 'month': m, 'year': yr}

    # 年终
    if ev in YE_EVENTS.get(g_str, {}):
        m = YE_EVENTS[g_str][ev]
        yr = cur_year if m <= cur_month else cur_year - 1
        return {'type': 'YE', 'surface': 'hard_in', 'month': m, 'year': yr}

    # 从动态信息映射获取
    dyn_info = dynamic_info_map.get((g_str, ev))
    if dyn_info is None:
        other_g = 'WTA' if g_str == 'ATP' else 'ATP'
        dyn_info = dynamic_info_map.get((other_g, ev))

    if dyn_info is not None:
        m = dyn_info['month']
        yr = cur_year if m <= cur_month else cur_year - 1
        surf = dyn_info['surface']
        # 级别从赛历获取
        info = cal_cache.get(cur_year, {}).get((g_str, ev))
        if not info:
            for y in [cur_year - 1, cur_year]:
                info = cal_cache.get(y, {}).get((g_str, ev))
                if info:
                    break
        etype = info['type'] if info else 'A250'
        return {'type': etype, 'surface': surf, 'month': m, 'year': yr}

    # 兜底
    return {'type': 'A250', 'surface': 'hard_out', 'month': 6, 'year': cur_year}


def expiry_ym(meta):
    return meta['year'] + 1, meta['month']


def parse_details(det, gender, cal_cache, dynamic_info_map, cur_month, cur_year):
    if not det: return []
    res = []
    def add(ev, sc, inc, forced):
        meta = get_meta(ev, gender, cal_cache, dynamic_info_map, cur_month, cur_year)
        ey, em = expiry_ym(meta) if inc else (0, 0)
        res.append({'n':ev,'s':sc,'inc':inc,'forced':forced,'meta':meta,
                    'expiry':f'{ey}年{em}月' if inc else None})
    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', det):
        add(m.group(1).strip(), int(m.group(2)), True, True)
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', det):
        add(m.group(1).strip(), int(m.group(2)), False, False)
    tmp = re.sub(r'<b>【[^】]*】</b>','',det)
    tmp = re.sub(r'<del>【[^】]*】</del>','',tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】',tmp):
        add(m.group(1).strip(), int(m.group(2)), True, False)
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


def build_users(rows, gender, ir_map, cur_map, event_name, cal_cache, dynamic_info_map, cur_month, cur_year):
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
        evs=parse_details(det,gender,cal_cache,dynamic_info_map,cur_month,cur_year)
        included=[e for e in evs if e['inc']]

        if event_name:
            included=[e for e in included if e.get('n') != event_name]

        if this_ev>0 and event_name:
            meta=get_meta(event_name,gender,cal_cache,dynamic_info_map,cur_month,cur_year)
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
    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] 开始生成积分构成数据（动态赛历版）...")
    session=make_session()

    print("读取赛历...")
    cal_cache={}
    for y in [cur_year-1, cur_year]:
        cal_cache[y]=scrape_calendar(y, session)
        print(f"  {y}年: {len(cal_cache[y])} 个赛事")
        time.sleep(0.5)
    
    print("动态获取赛事月份（从 calendar_list 页面）...")
    dynamic_info_map = build_dynamic_info_map_from_calendar_list(cal_cache, cur_year, session)

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
    ms_users=build_users(ms_rows,'MS',ms_ir,ms_cur,ms_event,cal_cache,dynamic_info_map,cur_month,cur_year)
    print("构建WTA积分构成...")
    ws_users=build_users(ws_rows,'WS',ws_ir,ws_cur,ws_event,cal_cache,dynamic_info_map,cur_month,cur_year)

    now_str=now.strftime('%Y-%m-%d %H:%M:%S')
    output={'updated_at':now_str,'ms':ms_users,'ws':ws_users}
    os.makedirs('data',exist_ok=True)
    with open('data/breakdown.json','w',encoding='utf-8') as f:
        json.dump(output,f,ensure_ascii=False,separators=(',',':'))
    size_kb=os.path.getsize('data/breakdown.json')//1024
    print(f"[{now_str}] 完成！{size_kb} KB | ATP:{len(ms_users)} WTA:{len(ws_users)}")


if __name__=='__main__':
    main()
