#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily history data builder for tennis_survivor.
Generates data/history.json: preference_by_year, disasters, flights, fortunes.
"""
import os,re,json,time,random,requests,concurrent.futures
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
BASE_URL='https://www.live-tennis.cn'
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
CACHE=ROOT/'.cache_history_events'
DATA.mkdir(exist_ok=True); CACHE.mkdir(exist_ok=True)

def make_session():
    s=requests.Session(); retry=Retry(total=4,connect=4,read=4,backoff_factor=.8,status_forcelist=[429,500,502,503,504],allowed_methods=['GET','POST'])
    ad=HTTPAdapter(max_retries=retry,pool_connections=10,pool_maxsize=10)
    s.mount('https://',ad); s.mount('http://',ad)
    s.headers.update({'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36','Accept-Language':'zh-CN,zh;q=0.9','Referer':BASE_URL})
    return s

def clean(x): return re.sub(r'<[^>]+>','',str(x)).strip()
def parse_players(x): return re.findall(r'【([^】]*)】', x or '')

def calendar(year):
    s=make_session(); html=s.get(f'{BASE_URL}/zh/survivor/calendar/{year}',timeout=30).text
    links=re.findall(r'href="https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/'+str(year)+r'/(MS|WS)/(?:my|score)"[^>]*>(.*?)</a>', html, re.S)
    out=[]; seen=set()
    for eid,g,txt in links:
        name=clean(txt).replace('ATP','').replace('WTA','').strip()
        key=(year,eid,g,name)
        if key not in seen:
            seen.add(key); out.append({'year':year,'eid':eid,'gender':g,'name':name})
    return out

def survivor_calendar_status(years=(2024,2025,2026)):
    """Official survivor calendar status. /score = finished, /my = ongoing."""
    out={}
    sess=make_session()
    for year in years:
        html=sess.get(f'{BASE_URL}/zh/survivor/calendar/{year}',timeout=30).text
        for eid,g,mode in re.findall(r'https://www\.live-tennis\.cn/zh/survivor/event/([^/]+)/'+str(year)+r'/(MS|WS)/(score|my)',html):
            out[(year,eid,g)] = mode
    return out

def fetch_survivor_schedule_day(ev):
    """Objective survivor schedule from event fill page. F round data-id is objective final day."""
    key=(ev['year'],ev['eid'],ev['gender'])
    sched=globals().setdefault('SCHEDULE_DAY_CACHE',{})
    if key in sched: return sched[key]
    sess=make_session()
    url=f"{BASE_URL}/zh/survivor/event/{ev['eid']}/{ev['year']}/{ev['gender']}/my"
    html=sess.get(url,timeout=30).text
    pairs=re.findall(r'<div\s+data-id="(\d+)"\s+class="cSurvivorDayPickInfo">.*?当前轮次：\s*([^&<\s]+)', html, re.S)
    final_days=[int(day) for day,rnd in pairs if rnd.strip()=='F']
    all_days=[int(day) for day,rnd in pairs]
    final_day=max(final_days) if final_days else (max(all_days) if all_days else ev.get('max_day',0))
    sched[key]=(final_day, max(0, final_day-1))
    return sched[key]

def fetch_one(ev):
    safe=f"{ev['year']}_{ev['gender']}_{ev['eid']}_{ev['name']}".replace('/','_')
    fn=CACHE/(safe+'.json')
    if fn.exists(): return json.load(open(fn,encoding='utf-8'))
    s=make_session(); page=f"{BASE_URL}/zh/survivor/event/{ev['eid']}/{ev['year']}/{ev['gender']}/score"
    text=s.get(page,timeout=30).text
    tok=re.search(r'name="csrf-token"[^>]*content="([^"]+)"',text)
    token=tok.group(1) if tok else ''
    m=re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/score"',text) or re.search(r'url:\s*"https://www\.live-tennis\.cn/zh/survivor/event/(\d+)/\d+/detail"',text)
    if not m: raise RuntimeError('no iid')
    iid=int(m.group(1))
    r=s.post(f'{BASE_URL}/zh/survivor/event/{iid}/score',headers={'X-CSRF-TOKEN':token,'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},data='draw=1&start=0&length=5000&device=0',timeout=50)
    r.raise_for_status(); rows=r.json().get('data',[])
    users={str(x['user_id']):{'username':clean(x.get('username','')),'status':x.get('status',0),'day':x.get('day',0),'fill_status':x.get('fill_status',''),'players':parse_players(x.get('players',''))} for x in rows}
    res={**ev,'iid':iid,'max_day':max([u['day'] for u in users.values()] or [0]),'users':users}
    json.dump(res,open(fn,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    return res

def fetch_events():
    events=[]
    for y in [2024,2025,2026]: events+=calendar(y)
    res=[]; fails=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs={ex.submit(fetch_one,e):e for e in events}
        for f in concurrent.futures.as_completed(futs):
            e=futs[f]
            try: res.append(f.result())
            except Exception as err: fails.append((e,str(err))); print('WARN failed',e,err)
    if fails and not res:
        raise RuntimeError('all event fetch failed')
    return res

def current_ir():
    try:
        cur=json.load(open(DATA/'current.json',encoding='utf-8'))
        ms={str(r['user_id']):r.get('instant_rank') for r in cur.get('ms',{}).get('rows',[]) if r.get('instant_rank')}
        ws={str(r['user_id']):r.get('instant_rank') for r in cur.get('ws',{}).get('rows',[]) if r.get('instant_rank')}
        return ms,ws
    except Exception: return {},{}

def compute_pref(events,gender,years,ir):
    calendar_status=globals().get('SURVIVOR_CALENDAR_STATUS') or {(e.get('year'),e.get('eid'),e.get('gender')):'score' for e in events}
    us=defaultdict(lambda:{'username':'','elim_p':defaultdict(lambda:[0,9999,[]]),'adv_p':defaultdict(lambda:[0,-1,[]]),'champ_p':defaultdict(list),'runner_p':defaultdict(list),'participated':[],'eliminated':[],'championed':[],'ev_participated':0,'ev_eliminated':0,'ev_champion':0})
    filt=[e for e in events if e['gender']==gender and e['year'] in years]
    for idx,e in enumerate(filt):
        # 赛事是否已结束：官方幸存者赛历 /score=已结束，/my=进行中。
        title_closed=(calendar_status.get((e.get('year'),e.get('eid'),e.get('gender')))=='score')
        # 客观赛程：幸存者填写页中 当前轮次:F 的 data-id 是 F day。
        final_day, runner_day = fetch_survivor_schedule_day(e)
        for uid,u in e['users'].items():
            if not u['username']: continue
            st=us[uid]; st['username']=st['username'] or u['username']; st['ev_participated']+=1; st['participated'].append(f"{e['year']}{e['name']}")
            day=u['day']; fs=u['fill_status']; ps=u['players']
            # 夺冠：已结束赛事，客观 F day 用户依然存活。
            champ=(title_closed and fs=='存活' and day>=final_day)
            # 夺亚：已结束赛事，F day-1 存活，且 F day 不存活。
            # 数据表现为用户走到了 F day 但最终不是存活；夺亚球员取 F day-1 的选人。
            runner=(title_closed and (not champ) and fs!='存活' and day>=final_day)
            if champ:
                st['ev_champion']+=1; st['championed'].append(f"{e['year']}{e['name']}")
            else:
                st['ev_eliminated']+=1; st['eliminated'].append((f"{e['year']}{e['name']}",fs))
            for p in ps[:day]:
                if p and p!='轮空': st['adv_p'][p][0]+=1; st['adv_p'][p][1]=max(st['adv_p'][p][1],idx); st['adv_p'][p][2].append(f"{e['year']}{e['name']}")
            if fs=='球员输球' and day<len(ps) and ps[day] and ps[day]!='轮空':
                k=ps[day]; st['elim_p'][k][0]+=1; st['elim_p'][k][1]=min(st['elim_p'][k][1],day*100+idx); st['elim_p'][k][2].append(f"{e['year']}{e['name']}")
            if champ:
                j=min(final_day,len(ps)-1)
                if j>=0 and ps[j] and ps[j]!='轮空': st['champ_p'][ps[j]].append(f"{e['year']}{e['name']}")
            elif runner:
                j=min(runner_day,len(ps)-1)
                if j>=0 and ps[j] and ps[j]!='轮空': st['runner_p'][ps[j]].append(f"{e['year']}{e['name']}")
    res=[]
    for uid,st in us.items():
        el=st['elim_p']; ad=st['adv_p']
        if el:
            mc=max(v[0] for v in el.values()); wn,wv=min([(p,v) for p,v in el.items() if v[0]==mc],key=lambda x:x[1][1]); wc=mc
        else: wn=''; wc=0
        if ad:
            mc=max(v[0] for v in ad.values()); bn,bv=max([(p,v) for p,v in ad.items() if v[0]==mc],key=lambda x:x[1][1]); bc=mc
        else: bn=''; bc=0
        cc=Counter({p:len(v) for p,v in st['champ_p'].items()}); rc=Counter({p:len(v) for p,v in st['runner_p'].items()})
        res.append({'user_id':uid,'username':st['username'],'events_participated':st['ev_participated'],'events_eliminated':st['ev_eliminated'],'events_champion':st['ev_champion'],'worst_player_name':wn,'worst_player_count':wc,'best_player_name':bn,'best_player_count':bc,'champion_players':'、'.join([f'{p}×{c}' for p,c in cc.most_common(3)]) or '—','final_players':'、'.join([f'{p}×{c}' for p,c in rc.most_common()]) or '—','instant_rank':ir.get(uid),'d':{'p':st['participated'],'e':[f'{n}（{f}）' for n,f in st['eliminated']],'c':st['championed'],'el':{p:v[2] for p,v in st['elim_p'].items()},'ad':dict(sorted(((p,v[2]) for p,v in st['adv_p'].items()),key=lambda x:-len(x[1]))[:5]),'ch':{p:v for p,v in st['champ_p'].items()},'fi':{p:v for p,v in st['runner_p'].items()}}})
    res.sort(key=lambda x:(x.get('instant_rank') is None,x.get('instant_rank') or 9999,-x['events_participated']))
    return res


def roast(player, event, day, count, rank):
    """Generate unique, spicy roast comment for each disaster entry.
    Uses a large pool of templates varied by event, day, count, and rank
    so Top30 entries will all have distinct, flavourful comments.
    """
    day += 1
    # Characteristics for variation
    is_day1 = (day == 1)
    is_late = (day >= 6)
    is_upset = (count >= 80)
    seed = (hash(player + event) & 0x7fffffff) % 100

    # Large pool of templates split by context
    day1_pool = [
        f"Day1就送走了{count}人，{player}的签表教育课从不拖堂。{event}选手刚搭上去，就被他们礼貌请了下来。",
        f"{event} Day1首秀，{player}用一场比赛帮{count}人重新认识了自己的选手判断力。结论：再打磨一下。",
        f"{count}个人Day1就上了{player}的船，{player}Day1就凿了个洞。这场幸存者游轮没有救生圈。",
        f"{event}开场日，{player}替{count}人交了一份签表学费。学费不退，但经验留下了。",
        f"Day1{player}退场，{count}人的期望随之化作{event}的地面灰尘。热情换不来胜利，这是第一课。",
        f"{player}在{event} Day1完成了一次教科书级闪退，{count}人目送他走向更广阔的休息室。",
        f"Day1，{event}天气不错，{player}心情也不错，就是比赛输了，顺带把{count}个人的心情带走了。",
        f"{count}人信了{player}能撑过Day1，{player}表示：连Day1我都不想撑。{event}就此多了一段传说。",
    ]
    late_pool = [
        f"{event} Day{day}爆冷，{player}在{count}人的见证下选择了最意外的谢幕方式：悄悄地走，不留下任何理由。",
        f"{count}人陪{player}走到了Day{day}，然后他们在{event}的大门口发现：里面没有他们的位置了。",
        f"Day{day}，{event}签表只差临门一脚，{player}却原地刹车。{count}人站在外面看着他离开，沉默是最好的悼词。",
        f"{player}在{event} Day{day}的表现让{count}人深刻体会了什么叫\"希望越大失望越大\"，而且这是可量化的。",
        f"{count}人把{player}送进了{event} Day{day}，然后发现他们买的是单程票。幸好他们有备选——对吧？",
        f"Day{day}，{event}夜幕下，{player}安静地终结了{count}个人的幸存之路。比爆冷更可怕的是：有点意料之中。",
    ]
    big_upset_pool = [
        f"{event}本届最大惊雷之一：{player}把{count}个相信他的人一起炸翻。此役过后，{player}的名字将被写进幸存者黑名单。",
        f"{player}在{event}贡献了当年最知名的惨案之一，{count}人同时落地，场面壮观，史书留名。",
        f"{count}这个数字在{event}意味着什么？意味着{player}用一场比赛让整个签表群都沉默了三秒钟。",
        f"{event}因为{player}而拥有了一段幸存者史诗般的记忆：那天有{count}颗心碎得一模一样。",
    ]
    mid_pool = [
        f"{player}在{event} Day{day}带走了{count}人，用行动诠释了签表幸存者的核心精髓：你以为稳，其实不稳。",
        f"{count}个信了{player}的人，在{event} Day{day}统一领到了一张回程单。下次看清楚赔率再出发。",
        f"{event}赛场上，{player}完成了他Day{day}份内的工作——把{count}人礼送出境，效率极高。",
        f"{player}今日在{event}展示了幸存者的反向价值：帮{count}人提前结束了这场心理拉锯战，算是功德一件。",
        f"Day{day}，{player}在{event}主动交出了{count}个人押注的信任。他不欠大家解释，但大家欠自己一个反思。",
        f"{count}人把{player}列为{event} Day{day}的主力担当，他表示感谢，然后转身输了。感谢是真的，赢是假的。",
        f"{player}在{event}的Day{day}表现堪称本届\"安静型炸弹\"：引爆前没有预警，{count}人来不及反应就被带走了。",
        f"选{player}去{event}的{count}个人，在Day{day}学到了人生宝贵一课：球场上没有\"应该赢\"这回事。",
        f"{event} Day{day}，{player}让{count}人的签表本周作业直接清零。不是他不努力，是今天就是那种日子。",
        f"Day{day}，{player}在{event}宣告：我的任务已完成。{count}个跟着他的人表示：你的任务和我们的不一样。",
        f"{player}本次{event}之行目的明确：帮{count}人体验了一次\"从满怀希望到快速落地\"的完整情绪旅程。",
        f"{event} Day{day}，{count}人集体见证了{player}的提前退场。遗憾是有的，下次手更稳一点就好。",
        f"幸存者经典桥段在{event}重演：{player} Day{day}翻车，{count}人同步翻车，无一幸免，各自走好。",
        f"{player}在{event}的签表寿命是{day}天。{count}个人押注的{day}天就此到期，没有延期，没有退款。",
        f"Day{day}之后，{event}里{player}的传奇故事只有一个版本：{count}个人说他行，他选择了另一个方向证明。",
    ]

    # Pick by context and seed
    if is_day1 and seed < 70:
        pool = day1_pool
    elif is_late:
        pool = late_pool
    elif is_upset:
        pool = big_upset_pool
    else:
        pool = mid_pool

    # deterministic pick using seed for reproducibility
    return pool[seed % len(pool)]

def disasters(events,gender,year):
    c=Counter()
    for e in events:
        if e['gender']!=gender or e['year']!=year: continue
        for u in e['users'].values():
            if u['fill_status']=='球员输球':
                d=u['day']; ps=u['players']; p=ps[d] if d<len(ps) else ''
                if p and p!='轮空': c[(p,e['name'],d)]+=1
    return [{'rank':i,'player':p,'event':n,'day':d,'count':cnt,'comment':roast(p,n,d,cnt,i)} for i,((p,n,d),cnt) in enumerate(c.most_common(30),1)]

def flights(events,year):
    res={}
    for e in events:
        if e['year']!=year: continue
        key=f"{year} {e['name']} {'ATP' if e['gender']=='MS' else 'WTA'}"
        total=len(e['users']); days=defaultdict(lambda:{'loss':0,'suicide':0,'retired':0,'killers':Counter()})
        for u in e['users'].values():
            d=u['day']; fs=u['fill_status']; ps=u['players']
            if fs=='球员输球':
                days[d]['loss']+=1; p=ps[d] if d<len(ps) else ''
                if p and p!='轮空': days[d]['killers'][p]+=1
            elif '退赛' in fs: days[d]['retired']+=1
            elif '自杀' in fs: days[d]['suicide']+=1
        cum=0; arr=[]
        for d in sorted(days):
            x=days[d]; day_out=x['loss']+x['suicide']+x['retired']; cum+=day_out; alive=max(0,total-cum)
            top='、'.join([f'{p}({c})' for p,c in x['killers'].most_common(3)]) or '—'
            arr.append({'day':d,'g':'W' if e['gender']=='WS' else 'A','alive':alive,'out':x['loss'],'suicide':x['suicide'],'retired':x['retired'],'top':top})
        res[key]=arr
    return res

def fortunes():
    attrs=['上吉','大吉','小吉','半吉','末吉','平安','中平','守成','待时','有惊无险','先凶后吉','先吉后平','暗吉','微吉','小凶','半凶','凶中带救','险签','破财签','避祸签','下下','大凶','空亡','水逆','太岁动','紫微照','禄存守','破军开路','白虎临门','月德扶身','驿马动','桃花劫','孤辰','天喜','文昌','玄武藏','青龙得水','朱雀噪','勾陈困','腾蛇惊']
    good=['今日此人胜面偏亮，适合当主力，但别忘了备选。','签象偏吉：只要临场无退赛风声，可以放心大胆一点。','此人今日有贵气，关键分大概率站你这边。','顺风局概率高，选TA更像过桥，不像跳海。']
    mid=['五五开偏稳，能不能活主要看你备选填得真不真。','不算大吉，但也不是雷；临场消息决定生死。','此签中平，适合保守玩家，不适合上头梭哈。','能选，但别闭眼选；对手状态要再看一眼。']
    bad=['危险，今日TA很像航班机长，选前请三思。','凶意明显，若不是没得选，建议绕开。','此人今日冷风很重，热门身份也挡不住翻车味。','下手需谨慎：这签不是提醒你勇敢，是提醒你保命。']
    yi=['填备选','看退赛风声','等临场名单','选熟悉对位','避开伤病传闻','查交手记录','留一手','相信红土直觉']; ji=['裸奔','重复选择','半夜上头','迷信大种子','只看赔率','嘴硬','忘填备选','追冷过度']
    arr=[]
    for _ in range(1000):
        a=random.choice(attrs)
        txt=random.choice(bad if any(x in a for x in ['凶','下下','空亡','白虎','水逆','劫','险','破财']) else good if any(x in a for x in ['吉','紫微','禄存','天喜','青龙','月德']) else mid)
        arr.append({'attr':a,'text':txt,'yi':'、'.join(random.sample(yi,2)),'ji':'、'.join(random.sample(ji,2))})
    return arr

def main():
    global SURVIVOR_CALENDAR_STATUS
    tz=timezone(timedelta(hours=8)); SURVIVOR_CALENDAR_STATUS=survivor_calendar_status(); events=fetch_events(); msir,wsir=current_ir()
    hist={'updated_at':datetime.now(tz).strftime('%Y-%m-%d %H:%M:%S'),'preference_by_year':{},'disasters':{},'flights':{},'fortunes':fortunes()}
    for lab,yrs in [('2024',[2024]),('2025',[2025]),('2026',[2026]),('全部',[2024,2025,2026])]: hist['preference_by_year'][lab]={'ms':compute_pref(events,'MS',yrs,msir),'ws':compute_pref(events,'WS',yrs,wsir)}
    for y in [2024,2025,2026]: hist['disasters'][str(y)]={'ms':disasters(events,'MS',y),'ws':disasters(events,'WS',y)}; hist['flights'][str(y)]=flights(events,y)
    json.dump(hist,open(DATA/'history.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    print('history.json updated',hist['updated_at'])
if __name__=='__main__': main()
