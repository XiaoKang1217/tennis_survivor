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
    if(state)contexts.push({state:state,stationKey:item.station_key,stationName:item.station_name});
  }
  if(!AUTH_USER || AUTH_USER.id!==user)return;
  MANAGER_CONTINUING_USER=user;MANAGER_CONTINUING_CONTEXTS=contexts;
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
