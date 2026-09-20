/* Read-only previews use the live renderers and the live stylesheets.
 * The frame isolates viewport media queries, IDs and preview controls from the app.
 * No account state, roster state or event handlers are copied into the frame.
 */
(function(){
 'use strict';
 const mounted=new Map();
 const labels={hall:'配置大厅',lineup:'我的阵容',banner:'顶部 banner',board:'收益榜',jinx:'毒奶榜'};

 function sceneHtml(badge,name,scene){
  if(scene==='lineup')return managerSidebar(managerCalc(),managerRules(),'',{badge,name});
  if(scene==='banner'){
   // Clone the actual header, including its current title, timestamp and account layout.
   const header=document.getElementById('hdr').cloneNode(true);
   [...header.children].forEach(el=>{if(!el.classList.contains('hdt'))el.remove()});
   header.classList.add('badge-login-header');
   header.dataset.badge=managerBadgeThemeKey(badge);
   const top=header.querySelector('.hdt'),chip=header.querySelector('.auth-chip');
   top.classList.add('login-bar');top.dataset.badge=header.dataset.badge;
   chip.classList.add('badged');chip.dataset.badge=header.dataset.badge;
   chip.innerHTML=managerHeaderLoginBadge(name,badge);
   return header.outerHTML;
  }
  if(scene==='board'){
   const current=(MANAGER_REMOTE_STATION_NET_BOARD||[]).find(row=>row.user===name);
   const rows=[Object.assign({rank:1,user:name,net:3340,player:2720,combo:620},current||{},{badge,user:name})];
   return '<div class="manager-boards-page">'+managerStationNetTableHtml(rows,'本站净收益',1)+'</div>';
  }
  if(scene==='jinx'){
   const current=(JINX_LEADERBOARD||[]).find(row=>row.display_name===name&&row.tour==='ATP');
   return renderJinxLeaderCard('ATP',[Object.assign({tour:'ATP',display_name:name,score:1260,hit_count:18},current||{},{badge,display_name:name})]);
  }
  const submitted=managerSubmittedRecord(),calc=managerCalc();
  const current=(MANAGER_REMOTE_CONFIGS||[]).find(row=>row.user===name);
  const model=submitted?{style:calc.style,cost:submitted.cost,players:managerSanitizeLedgerPlayers(submitted.players||[]).map(managerLedgerPlayerName),note:'已提交，换人 '+MANAGER_TRANSFER_COUNT+'/1。'+(submitted.note||'')}:current||{style:calc.style,cost:calc.spent,players:calc.players.map(p=>managerPlayerDisplayName(p,true)),note:'当前阵容'};
  return managerHallCardHtml(Object.assign({},model,{user:name,badge}));
 }

 function componentWidth(scene){
  if(scene==='banner')return document.getElementById('hdr').getBoundingClientRect().width;
  if(scene==='lineup'){
   const side=document.querySelector('.manager-grid>.manager-side');
   if(side&&side.getBoundingClientRect().width)return side.getBoundingClientRect().width;
   return innerWidth>900?340:Math.max(260,innerWidth-40);
  }
  if(scene==='hall'){
   const card=document.querySelector('.manager-board-grid>.manager-hall-card');
   if(card)return card.getBoundingClientRect().width;
   // Measure the real grid rules rather than maintain a second breakpoint/column count.
   const body=document.querySelector('.manager-grid>.manager-panel>.manager-panel-b');
   if(body){
    const grid=document.createElement('div');grid.className='manager-board-grid';
    grid.style.cssText='height:0;overflow:hidden;visibility:hidden;pointer-events:none';
    grid.innerHTML='<div></div><div></div><div></div>';body.append(grid);
    const width=grid.firstElementChild.getBoundingClientRect().width;grid.remove();
    if(width)return width;
   }
  }
  const panel=document.querySelector('.manager-grid>.manager-panel>.manager-panel-b');
  return Math.max(280,(panel?panel.clientWidth-28:innerWidth-40));
 }

 function mount(host){
  const scene=host.dataset.nativeScene,theme=NewBadgeSkins.get(host.dataset.nativeBadge);
  const badge=managerFindBadge(theme.badge_key),name=host.dataset.nativeName;
  const frame=document.createElement('iframe');
  frame.title=labels[scene]+'实装预览';frame.className='native-badge-preview-frame';
  frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('scrolling','no');
  frame.style.visibility='hidden';host.setAttribute('aria-busy','true');delete host.dataset.nativeReady;
  const viewport=innerWidth,width=Math.min(viewport,componentWidth(scene));
  frame.style.width=viewport+'px';
  host.append(frame);
  const doc=frame.contentDocument;
  doc.open();doc.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body></body></html>');doc.close();
  const base=doc.createElement('base');base.href=document.baseURI;doc.head.append(base);
  const styleLoads=[];
  document.head.querySelectorAll('style,link[rel="stylesheet"]').forEach(node=>{
   const copy=node.cloneNode(true);
   if(copy.tagName==='LINK')styleLoads.push(new Promise(resolve=>{copy.onload=resolve;copy.onerror=resolve}));
   doc.head.append(copy);
  });
  doc.body.className=document.body.className;
  doc.body.dataset.skinPack='new-nine';doc.body.dataset.siteTheme=theme.theme;
  doc.documentElement.style.colorScheme='light';
  const layout=doc.createElement('style');
  // Only the surrounding canvas and placement change. Component CSS is untouched.
  layout.textContent='html,body{margin:0!important;padding:0!important;min-height:0!important;overflow:hidden!important;background:transparent!important}#native-preview-root{display:flow-root;width:'+width+'px}.manager-side{position:static!important}#hdr{position:static!important;margin:0!important}';
  doc.head.append(layout);
  const root=doc.createElement('div');root.id='native-preview-root';root.dataset.readOnly='true';
  root.innerHTML=sceneHtml(badge,name,scene);
  root.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(attr=>{if(/^on/i.test(attr.name))el.removeAttribute(attr.name)}));
  doc.body.append(root);
  // Keep native horizontal table scrolling while blocking every preview action.
  for(const type of ['click','submit'])doc.addEventListener(type,event=>{event.preventDefault();event.stopImmediatePropagation()},true);
  // Use the same table wrapper, name fitting and image rendering as the live page.
  NewBadgeRelease.afterRender(root);
  let pending=0,ready=false;
  function resize(){
   cancelAnimationFrame(pending);
   pending=requestAnimationFrame(()=>{
    if(!host.isConnected)return;
    NewBadgeSkins.fit(root);
    const scale=Math.min(1,host.clientWidth/width);
    const height=Math.ceil(root.getBoundingClientRect().height);
    frame.style.height=height+'px';frame.style.transform='scale('+scale+')';
    host.style.height=Math.ceil(height*scale)+'px';
    if(ready){frame.style.visibility='visible';host.dataset.nativeReady='true';host.removeAttribute('aria-busy')}
   });
  }
  const observer=new ResizeObserver(resize);observer.observe(root);observer.observe(host);
  doc.querySelectorAll('link').forEach(link=>link.addEventListener('load',resize));
  doc.querySelectorAll('img').forEach(img=>{img.loading='eager';img.addEventListener('load',resize)});
  Promise.all(styleLoads).then(async()=>{
   if(!host.isConnected)return;
   root.getBoundingClientRect();
   const artKeys=[scene==='banner'?'banner':scene==='lineup'?'lineup':scene==='hall'?'hall':'leaderboard','cardNameplate'];
   await Promise.all([doc.fonts.ready,...[...doc.images].map(img=>img.decode().catch(()=>{})),...artKeys.map(key=>{
    const img=new Image();img.src=theme.assets[key];return img.decode().catch(()=>{});
   })]);
   ready=true;resize();
  });
  resize();
  mounted.set(host,{frame,observer,viewport,dispose(){observer.disconnect();cancelAnimationFrame(pending)}});
 }

 function hydrate(root=document){
  for(const [host,state] of mounted){if(!host.isConnected){state.dispose();mounted.delete(host)}}
  root.querySelectorAll('.native-badge-preview').forEach(host=>{if(!mounted.has(host))mount(host)});
 }
 let resizeFrame;
 addEventListener('resize',()=>{
  cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
   for(const [host,state] of mounted){
    if(state.viewport===innerWidth)continue;
    state.dispose();mounted.delete(host);host.replaceChildren();if(host.isConnected)mount(host);
   }
  });
 });
 window.ManagerNativeBadgePreview={hydrate,sceneHtml};
})();
