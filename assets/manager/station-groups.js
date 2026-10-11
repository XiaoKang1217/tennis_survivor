var MANAGER_CONTINUING_CONTEXTS = [];
var MANAGER_CONTINUING_USER = '';
function managerDisplayGroup(mode) {
  return MANAGER_ACTIVE_EVENTS && MANAGER_ACTIVE_EVENTS.display_groups && MANAGER_ACTIVE_EVENTS.display_groups[mode] || null;
}
function managerMarketPacks() {
  var carried = MANAGER_ACTIVE_EVENTS && MANAGER_ACTIVE_EVENTS.display_events || [];
  return carried.map(function(item){return managerEventPack(item.event_key);}).concat(managerContestPacks());
}
function managerPlayerPurchasable(player) {
  var readOnly = MANAGER_ACTIVE_EVENTS && MANAGER_ACTIVE_EVENTS.display_events || [];
  return !readOnly.some(function(item){return player.eventKey===item.event_key || player.tour===item.tour;});
}
function managerContinuingLedgerContexts() {
  return AUTH_USER && MANAGER_CONTINUING_USER===AUTH_USER.id ? MANAGER_CONTINUING_CONTEXTS : [];
}
async function managerLoadContinuingStates() {
  if(managerLocalSimulationMode() || !AUTH_USER || !supabaseConfigured())return;
  var user=AUTH_USER.id,items=MANAGER_ACTIVE_EVENTS.continuing_stations||[],contexts=[];
  for(var item of items){
    var state=await optionalSupabaseRpc('tour_manager_get_my_state',{p_station_key:item.station_key,p_season:managerSeason()});
    state=await managerHydrateRemoteContracts(state);
    var publication=MANAGER_CONTINUING_PUBLICATIONS[item.station_key];
    if(!publication){
      publication=await managerFetchJson(item.publication_file).catch(function(){return null;});
      if(publication)MANAGER_CONTINUING_PUBLICATIONS[item.station_key]=publication;
    }
    if(state)contexts.push({state:state,stationKey:item.station_key,stationName:item.station_name,publication:publication});
  }
  if(!AUTH_USER || AUTH_USER.id!==user)return;
  MANAGER_CONTINUING_USER=user;MANAGER_CONTINUING_CONTEXTS=contexts;
}
var MANAGER_CONTINUING_PUBLICATIONS = {};
function managerContinuingPlayerStats(player,state,stationKey){
  var contract=player.contract||{};
  return {earned:Number(contract.earned_points)||0,
    yesterday:managerPlayerYesterdayIncome(player,contract,state,stationKey),
    round:managerContractRoundDisplay(contract,player,'未开赛'),
    status:contract.is_active===false?'已换下':(managerContractEliminated(contract)?'已出局':'存活')};
}
function managerContinuingLineupModel(context){
  var state=context.state,lineup=state.lineup;
  if(!managerRemoteLineupIsAuthoritative(lineup))return null;
  var rules=context.publication&&context.publication.snapshot&&context.publication.snapshot.station_config.rules;
  if(!rules)return {unavailable:true};
  var all=(state.contracts||[]).map(managerPlayerFromContract).filter(Boolean);
  var players=all.filter(function(p){return p.isActive!==false;});
  var roundFor=function(p){return p.contract.predicted_round||'OUT';};
  function score(rounds){
    var gross=rounds.reduce(function(sum,x){return sum+managerRoundValue(x.round,x.player.level,x.player.tour,x.player.drawSize);},0);
    return managerCanadaComboScenario(gross,rounds,{rules:rules,hopeId:lineup.village_hope_player_key});
  }
  var forecast=score(players.map(function(p){return {player:p,round:roundFor(p)};}));
  var best=managerBestRoundMap(players),maximum=score(players.map(function(p){return {player:p,round:best[p.id]||'OUT'};}));
  var stats=all.map(function(p){return managerContinuingPlayerStats(p,state,context.stationKey);});
  return {players:players,all:all,roundFor:roundFor,forecast:forecast,cost:Number(lineup.lineup_cost)||0,
    original:Number(lineup.original_lineup_cost??lineup.lineup_cost)||0,discount:Number(lineup.welfare_discount)||0,
    grantUsed:Number(lineup.station_grant_used)||0,walletUsed:Number(lineup.wallet_used)||0,
    earned:stats.reduce(function(s,x){return s+x.earned;},0),yesterday:stats.reduce(function(s,x){return s+x.yesterday;},0),
    alive:stats.filter(function(x){return x.status==='存活';}).length,max:maximum.gross+maximum.bonus-(Number(lineup.lineup_cost)||0)};
}
function managerRenderContinuingLineup(context){
  var m=managerContinuingLineupModel(context);
  if(!m)return '<div class="manager-empty">本站没有已提交阵容。</div>';
  if(m.unavailable)return '<div class="manager-empty">本站规则暂未加载，请刷新重试。</div>';
  function rows(items){return items.map(function(x){return '<div><span>'+esc(x[0])+'</span><b>'+esc(String(x[1]))+'</b></div>';}).join('');}
  var f=m.forecast,hope=f.villageHopePlayer;
  var current=[['总支出',m.cost+'，其中签约金花费 '+m.grantUsed+'，本金花费 '+m.walletUsed],['签约原价',m.original],['低保折扣',m.discount?'-'+m.discount:'未触发'],['累计收益',m.earned],['昨天收益',m.yesterday],['目前存活',m.alive+' 人'],['预计最高收益',m.max]];
  var prediction=[['全村的希望',hope?managerPlayerDisplayName(hope,true)+'（原价 '+hope.price+'）':context.state.lineup.village_hope_player_name||'未指定'],['毛收益',f.gross],['奖励',f.bonus],['折后成本',m.cost],['当前预测净收益',f.gross+f.bonus-m.cost],['阵容风格',managerLineupStyle(m.players)]];
  function cards(players){return players.map(function(p){return managerMyPlayerCard(p,p.isActive===false,{round:m.roundFor(p),stats:managerContinuingPlayerStats(p,context.state,context.stationKey)});}).join('');}
  var replaced=m.all.filter(function(p){return p.isActive===false;});
  return '<div class="manager-my-summary-grid"><div class="manager-my-highlight"><h4>队伍目前收益</h4><div class="manager-kv">'+rows(current)+'</div></div><div class="manager-my-highlight"><h4>当前预测</h4><div class="manager-kv">'+rows(prediction)+'</div></div></div><div class="manager-roster-title">当前阵容</div><div class="manager-my-lineup">'+cards(m.players)+'</div>'+(replaced.length?'<div class="manager-roster-title">换下球员</div><div class="manager-my-lineup">'+cards(replaced)+'</div>':'');
}
function managerRenderMyLineup(){
  var stations=MANAGER_ACTIVE_EVENTS&&MANAGER_ACTIVE_EVENTS.continuing_stations||[];
  if(!stations.length)return managerRenderCurrentLineup();
  function section(name,content){return '<section class="manager-station-lineup"><h3>'+esc(name)+'</h3>'+content+'</section>';}
  return section(managerStationName(),managerRenderCurrentLineup())+stations.map(function(station){
    var ctx=managerContinuingLedgerContexts().find(function(x){return x.stationKey===station.station_key;});
    return section(station.station_name,ctx?managerRenderContinuingLineup(ctx):'<div class="manager-empty">'+(!AUTH_USER?'登录后查看本站阵容。':'正在读取本站阵容，请稍候。')+'</div>');
  }).join('');
}
function managerGroupedLedgerRows() {
  var seen=new Set(),rows=[];
  managerRemoteLedgerContexts().forEach(function(ctx){
    managerVisibleLedgerRows(ctx.state.ledger||[]).forEach(function(row){
      var key=managerLedgerRowStationKey(row,ctx.stationKey),id=row.id||[key,row.created_at,row.type,row.amount].join('|');
      if(seen.has(id))return;seen.add(id);rows.push({row:row,stationKey:key});
    });
  });
  if(!MANAGER_REMOTE_STATE)(MANAGER_LEDGER||[]).forEach(function(row){rows.push({row:row,stationKey:managerLedgerRowStationKey(row,managerStationKey())});});
  return rows;
}
function managerGroupedIncomeTotals(rows, includeOther) {
  return rows.reduce(function(out,x){
    var part=managerIncomePartsFromRow(x.row);
    if(part && (includeOther || part.kind!=='other')){out[part.kind]+=part.amount;out.total+=part.amount;}
    return out;
  },{player:0,combo:0,prediction:0,other:0,total:0});
}
function managerGroupedStationIncome() {
  var keys=managerDisplayGroup('current').station_keys;
  return managerGroupedIncomeTotals(managerGroupedLedgerRows().filter(function(x){return keys.includes(x.stationKey);}),true);
}
function managerGroupedDailyIncomeSummary() {
  var rows=managerGroupedLedgerRows(),dateKey=managerChinaDateKey(),groups=[];
  ['current','previous'].forEach(function(mode){
    var group=managerDisplayGroup(mode);if(!group)return;
    var all=rows.filter(function(x){return group.station_keys.includes(x.stationKey);});
    var day=all.filter(function(x){return managerChinaDateKey(x.row.created_at||x.row.updated_at||x.row.date)===dateKey;});
    groups.push({label:(mode==='current'?'本站：':'上站：')+group.label,day:managerGroupedIncomeTotals(day,false),total:managerGroupedIncomeTotals(all,false)});
  });
  if(!groups.some(function(group){return group.day.total>0;}))return null;
  var day=managerGroupedIncomeTotals(rows.filter(function(x){return managerChinaDateKey(x.row.created_at||x.row.updated_at||x.row.date)===dateKey;}),false);
  return {byDate:true,dateKey:dateKey,stationKey:managerStationKey(),groups:groups,yesterdayIncome:day.total,
    careerTotal:managerGroupedIncomeTotals(rows,false).total};
}
function managerGroupedIncomeDialogText(summary,name) {
  return '亲爱的'+name+'，今日收益到账。\n'+summary.groups.map(function(g){
    return g.label+'\n今日到账 '+g.day.total+'，其中球员收益'+g.day.player+'，combo收益'+g.day.combo+'，竞猜收益'+g.day.prediction+'。\n累计收益 '+g.total.total+'，其中球员收益'+g.total.player+'，combo收益'+g.total.combo+'，竞猜收益'+g.total.prediction+'。';
  }).join('\n\n')+'\n\n参赛以来累计收益 '+summary.careerTotal+'。';
}
