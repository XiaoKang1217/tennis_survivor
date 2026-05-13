#!/usr/bin/env python3
"""
签表幸存者之炉网 - 积分构成数据生成脚本
每天运行：生成 ATP/WTA 用户积分构成数据（含标签、各赛事类型、场地类型、失效时间）
"""
import re, json, time, os, requests
from collections import defaultdict
from datetime import datetime, timezone, timedelta

BASE_URL = "https://www.live-tennis.cn"

# ============================================================
# 赛事元数据（精确修正）
# COMMON：仅大满贯（ATP+WTA共用）
# ATP_META：ATP专属（含ATP年终都灵）
# WTA_META：WTA专属（含WTA年终利雅得、伦敦=WTA500草地）
# ============================================================
COMMON = {
    '澳网': {'surface':'hard_out','month':1, 'type':'GS'},
    '法网': {'surface':'clay',   'month':6, 'type':'GS'},
    '温网': {'surface':'grass',  'month':7, 'type':'GS'},
    '美网': {'surface':'hard_out','month':9,'type':'GS'},
}
ATP_META = {
    # ATP年终
    '都灵':     {'surface':'hard_in', 'month':11,'type':'YE'},
    # ATP 1000赛
    '印第安维尔斯':{'surface':'hard_out','month':3, 'type':'M1000'},
    '迈阿密':   {'surface':'hard_out','month':4, 'type':'M1000'},
    '蒙特卡洛': {'surface':'clay',   'month':4, 'type':'M1000'},
    '马德里':   {'surface':'clay',   'month':5, 'type':'M1000'},
    '罗马':     {'surface':'clay',   'month':5, 'type':'M1000'},
    '多伦多':   {'surface':'hard_out','month':8, 'type':'M1000'},
    '蒙特利尔': {'surface':'hard_out','month':8, 'type':'M1000'},
    '辛辛那提': {'surface':'hard_out','month':8, 'type':'M1000'},
    '上海':     {'surface':'hard_out','month':10,'type':'M1000'},
    '巴黎':     {'surface':'hard_in', 'month':11,'type':'M1000'},
    # ATP 500赛
    '鹿特丹':   {'surface':'hard_in', 'month':2, 'type':'A500'},
    '多哈':     {'surface':'hard_in', 'month':2, 'type':'A500'},
    '阿卡普尔科':{'surface':'hard_out','month':2,'type':'A500'},
    '北京':     {'surface':'hard_out','month':10,'type':'A500'},
    '迪拜':     {'surface':'hard_out','month':2, 'type':'A500'},
    '华盛顿':   {'surface':'hard_out','month':8, 'type':'A500'},
    '汉堡':     {'surface':'clay',   'month':7, 'type':'A500'},
    '哈雷':     {'surface':'grass',  'month':6, 'type':'A500'},
    '巴塞尔':   {'surface':'hard_in', 'month':10,'type':'A500'},
    '维也纳':   {'surface':'hard_in', 'month':10,'type':'A500'},
    # ATP 250赛
    '香港':     {'surface':'hard_out','month':1, 'type':'A250'},
    '阿德莱德': {'surface':'hard_out','month':1, 'type':'A250'},
    '蒙彼利埃': {'surface':'hard_in', 'month':2, 'type':'A250'},
    '梅里达':   {'surface':'clay',   'month':2, 'type':'A250'},
    '洛斯卡沃斯':{'surface':'hard_out','month':2,'type':'A250'},
    '休斯顿':   {'surface':'clay',   'month':4, 'type':'A250'},
    '慕尼黑':   {'surface':'clay',   'month':5, 'type':'A250'},
    '马洛卡':   {'surface':'grass',  'month':6, 'type':'A250'},
    '温斯顿塞勒姆':{'surface':'hard_out','month':8,'type':'A250'},
    '杭州':     {'surface':'hard_out','month':10,'type':'A250'},
}
WTA_META = {
    # WTA年终（利雅得是现在的，利雅得/吉达）
    '利雅得':   {'surface':'hard_in', 'month':11,'type':'YE'},
    '吉达':     {'surface':'hard_in', 'month':11,'type':'YE'},
    # 历史WTA年终（深圳2019/2023，新加坡2014-2018）—— 保留以防万一
    '深圳':     {'surface':'hard_in', 'month':11,'type':'YE'},
    '新加坡':   {'surface':'hard_in', 'month':11,'type':'YE'},
    # WTA 1000赛（非合赛）
    '多哈':     {'surface':'hard_in', 'month':2, 'type':'M1000'},
    '迪拜':     {'surface':'hard_out','month':2, 'type':'M1000'},
    '武汉':     {'surface':'hard_in', 'month':10,'type':'M1000'},
    # WTA 1000赛（合赛）
    '印第安维尔斯':{'surface':'hard_out','month':3,'type':'M1000'},
    '迈阿密':   {'surface':'hard_out','month':4, 'type':'M1000'},
    '马德里':   {'surface':'clay',   'month':5, 'type':'M1000'},
    '罗马':     {'surface':'clay',   'month':5, 'type':'M1000'},
    '蒙特利尔': {'surface':'hard_out','month':8, 'type':'M1000'},
    '多伦多':   {'surface':'hard_out','month':8, 'type':'M1000'},
    '辛辛那提': {'surface':'hard_out','month':8, 'type':'M1000'},
    '北京':     {'surface':'hard_out','month':10,'type':'M1000'},
    # WTA 500赛
    '伦敦':     {'surface':'grass',  'month':6, 'type':'A500'},  # ← 女王杯，不是年终！
    '查尔斯顿': {'surface':'clay',   'month':4, 'type':'A500'},
    '斯图加特': {'surface':'clay',   'month':5, 'type':'A500'},
    '柏林':     {'surface':'grass',  'month':6, 'type':'A500'},
    '巴特洪堡': {'surface':'grass',  'month':6, 'type':'A500'},
    '东京':     {'surface':'hard_out','month':8, 'type':'A500'},
    '首尔':     {'surface':'hard_in', 'month':9, 'type':'A500'},
    '宁波':     {'surface':'hard_out','month':10,'type':'A500'},
    # WTA 250赛
    '布里斯班': {'surface':'hard_out','month':1, 'type':'A250'},
    '霍巴特':   {'surface':'hard_in', 'month':1, 'type':'A250'},
    '阿布扎比': {'surface':'hard_out','month':2, 'type':'A250'},
    '梅里达':   {'surface':'clay',   'month':2, 'type':'A250'},
    '林茨':     {'surface':'hard_in', 'month':10,'type':'A250'},
    '斯特拉斯堡':{'surface':'clay',  'month':5, 'type':'A250'},
    '布拉格':   {'surface':'clay',   'month':5, 'type':'A250'},
    '九江':     {'surface':'clay',   'month':5, 'type':'A250'},
    '克利夫兰': {'surface':'hard_out','month':8, 'type':'A250'},
}

def get_meta(ev, g):
    if g == 'MS':
        return ATP_META.get(ev) or COMMON.get(ev) or {'surface':'unknown','month':6,'type':'OTH'}
    return WTA_META.get(ev) or COMMON.get(ev) or {'surface':'unknown','month':6,'type':'OTH'}

def expiry_ym(month):
    now_month = datetime.now().month
    now_year = datetime.now().year
    if month > now_month:
        return now_year, month
    return now_year + 1, month

def parse_details(det, g):
    if not det: return []
    res = []
    for m in re.finditer(r'<b>【([^】(]+)\((\d+)\)】</b>', det):
        ev, sc = m.group(1).strip(), int(m.group(2))
        meta = get_meta(ev, g); ey, em = expiry_ym(meta['month'])
        res.append({'n':ev,'s':sc,'inc':True,'forced':True,'meta':meta,'expiry':f'{ey}年{em}月'})
    for m in re.finditer(r'<del>【([^】(]+)\((\d+)\)】</del>', det):
        ev, sc = m.group(1).strip(), int(m.group(2))
        meta = get_meta(ev, g)
        res.append({'n':ev,'s':sc,'inc':False,'forced':False,'meta':meta,'expiry':None})
    tmp = re.sub(r'<b>【[^】]*】</b>', '', det)
    tmp = re.sub(r'<del>【[^】]*】</del>', '', tmp)
    for m in re.finditer(r'【([^】(]+)\((\d+)\)】', tmp):
        ev, sc = m.group(1).strip(), int(m.group(2))
        meta = get_meta(ev, g); ey, em = expiry_ym(meta['month'])
        res.append({'n':ev,'s':sc,'inc':True,'forced':False,'meta':meta,'expiry':f'{ey}年{em}月'})
    return res

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

def build_users(rows, gender, ir_map):
    now_m = datetime.now().month; now_y = datetime.now().year
    EXPIRY_MONTHS = []
    m2, y2 = now_m+1, now_y
    if m2>12: m2=1; y2+=1
    for _ in range(12):
        EXPIRY_MONTHS.append(f'{y2}年{m2}月'); m2+=1
        if m2>12: m2=1; y2+=1

    users = []
    for r in rows:
        uid = str(r.get('user_id',''))
        name = re.sub(r'<[^>]+>','',str(r.get('username',''))).strip()
        score = r.get('score',0) or 0
        rank = r.get('rank',9999) or 9999
        det = r.get('details','')
        events = parse_details(det, gender)
        included = [e for e in events if e['inc']]
        ts,te,ss,em2 = {},{},{},{}
        for e in included:
            t=e['meta']['type']; sk=e['meta']['surface']; sc2=e['s']
            ts[t]=ts.get(t,0)+sc2
            if t not in te: te[t]=[]
            te[t].append(e)
            ss[sk]=ss.get(sk,0)+sc2
            if e['expiry']:
                if e['expiry'] not in em2: em2[e['expiry']]={'total':0,'events':[]}
                em2[e['expiry']]['total']+=sc2
                em2[e['expiry']]['events'].append(f"{e['n']}({sc2})")
        ho=ss.get('hard_out',0); hi=ss.get('hard_in',0)
        u = {'uid':uid,'n':name,'s':score,'rank':rank,
             'gs':ts.get('GS',0),'ye':ts.get('YE',0),'m1':ts.get('M1000',0),'a5':ts.get('A500',0),'a2':ts.get('A250',0),
             'hard':ho+hi,'clay':ss.get('clay',0),'grass':ss.get('grass',0),
             'surf_scores':ss,
             'type_evs':{t:[{'n':e['n'],'s':e['s'],'forced':e['forced'],'surf':e['meta']['surface'],'expiry':e['expiry']}
                             for e in sorted(evs,key=lambda x:-x['s'])] for t,evs in te.items()},
             'exp_list':[{'mk':mk,'total':em2.get(mk,{'total':0})['total'],'events':em2.get(mk,{'events':[]})['events']}
                         for mk in EXPIRY_MONTHS]}
        users.append(u)
    users.sort(key=lambda u: ir_map.get(u['uid'],u['rank'] or 9999))
    for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
        calc_feat_pct(users, feat)
    for i,u in enumerate(users):
        lb, lc = get_label(u)
        u['label']=lb; u['label_color']=lc
        u['ir']=ir_map.get(u['uid'],u['rank'])
        for feat in ['gs','ye','m1','a5','a2','hard','clay','grass']:
            u.pop(f'{feat}_pct',None)
        u.pop('hard',None); u.pop('clay',None); u.pop('grass',None)
    if users:
        users[0]['label']='🥇 世界第一'; users[0]['label_color']='#b45309'
    return users

def main():
    tz_cn = timezone(timedelta(hours=8))
    print(f"[{datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')}] 开始生成积分构成数据...")
    session = make_session()
    resp_ms = session.get(f'{BASE_URL}/zh/survivor/rank/MS/year',timeout=20)
    csrf_ms = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"',resp_ms.text).group(1)
    print("获取ATP排名数据...")
    ms_rows = fetch_rank_data(session, csrf_ms, '1')
    print(f"  ATP: {len(ms_rows)} 用户")
    resp_ws = session.get(f'{BASE_URL}/zh/survivor/rank/WS/year',timeout=20)
    csrf_ws = re.search(r'meta[^>]*name="csrf-token"[^>]*content="([^"]+)"',resp_ws.text).group(1)
    print("获取WTA排名数据...")
    ws_rows = fetch_rank_data(session, csrf_ws, '2')
    print(f"  WTA: {len(ws_rows)} 用户")
    try:
        with open('data/current.json',encoding='utf-8') as f: cur=json.load(f)
        ms_ir={str(r['user_id']):r.get('instant_rank') for r in cur['ms']['rows'] if r.get('instant_rank')}
        ws_ir={str(r['user_id']):r.get('instant_rank') for r in cur['ws']['rows'] if r.get('instant_rank')}
    except Exception as e:
        print(f"  读取current.json失败，使用rank排序: {e}"); ms_ir={}; ws_ir={}
    print("构建ATP积分构成...")
    ms_users = build_users(ms_rows,'MS',ms_ir)
    print("构建WTA积分构成...")
    ws_users = build_users(ws_rows,'WS',ws_ir)
    now_str = datetime.now(tz_cn).strftime('%Y-%m-%d %H:%M:%S')
    output = {'updated_at':now_str,'ms':ms_users,'ws':ws_users}
    os.makedirs('data',exist_ok=True)
    with open('data/breakdown.json','w',encoding='utf-8') as f:
        json.dump(output,f,ensure_ascii=False,separators=(',',':'))
    size_kb = os.path.getsize('data/breakdown.json')//1024
    print(f"[{now_str}] 完成！breakdown.json: {size_kb} KB")
    print(f"ATP: {len(ms_users)} 用户，WTA: {len(ws_users)} 用户")

if __name__ == '__main__':
    main()
