/* Catalogue and visual hooks only. Wallet, purchase and equip RPCs stay in index.html. */
(function(){
 'use strict';
 const C=window.NewBadgeSkins,wrap=html=>'<span class="new-skin-scope">'+html+'</span>';
 C.themes.forEach(t=>{
  MANAGER_BADGE_FALLBACKS.push({badge_key:t.badge_key,title:t.title,formal_name:t.formal_name,subtitle:t.category_label,category:t.category,category_label:t.category_label,serial_number:t.serial_number,description:t.description,story:t.story,motifs:t.motifs,available_from:t.available_from,available_until:'',price:t.price,sale_status:'for_sale',image_url:t.assets.badge,thumb_url:t.assets.thumb,rarity:'limited',sort_order:t.sort_order});
  MANAGER_BADGE_STORIES[t.badge_key]=t.story;
  MANAGER_BADGE_VISUAL_META[t.theme]={label:t.title,icon:t.assets.badge,nameplate:t.assets.cardNameplate,header:t.assets.hall,lineupHeader:t.assets.lineup,banner:t.assets.banner,surface:t.assets.leaderboard,surfaceWide:t.assets.shop,thumb:t.assets.thumb};
 });
 function identity(t,name,opts={}){const compact=!!(opts.card||opts.prominent);return '<span class="new-skin-scope new-release-identity'+(opts.login?' new-release-login':compact?' new-release-compact':'')+'">'+C.identity(t,name,!opts.login&&!compact)+'</span>';}
 function hero(t,name,opts={}){return '<span class="new-skin-scope new-release-hero'+(opts.sidebar?' new-release-hero--lineup':'')+'" data-badge="'+t.theme+'">'+C.badge(t,'new-portrait')+C.plate(t,name,true)+'</span>';}
 const artObserver=window.IntersectionObserver?new IntersectionObserver(entries=>{
  entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-art-ready');artObserver.unobserve(entry.target)}});
 },{rootMargin:'350px'}):null;
 function afterRender(root=document){
  root.querySelectorAll('.new-release-shop-item:not(.is-art-ready)').forEach(card=>{
   if(artObserver)artObserver.observe(card);else card.classList.add('is-art-ready');
  });
  root.querySelectorAll('table .new-identity--row').forEach(identity=>{
   const table=identity.closest('table');table.classList.add('new-badge-leaderboard');
   if(!table.parentElement.matches('.new-board-wrap,.new-skin-rank-scroll,.manager-table-scroll')){
    const scroll=document.createElement('div');scroll.className='new-skin-rank-scroll';table.before(scroll);scroll.append(table);
   }
  });
  C.scheduleFit();
 }
 window.NewBadgeRelease={get:C.get,identity,hero,afterRender,
  card:(t,owned,equipped,source,isNew)=>'<div class="new-skin-scope new-release-shop-item">'+C.card(t,owned,equipped,source,isNew)+'</div>',
  detail:(t,name,scene)=>'<div class="new-skin-scope">'+C.detail(t,name,scene==='header'?'banner':scene)+'</div>'
 };
})();
