import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../../assets/manager/principal-reward.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
function context(rpc) {
  const ctx = vm.createContext({AUTH_USER:{id:'a'}, document:{getElementById:()=>null}, supabaseRpc:rpc});
  vm.runInContext(source, ctx);
  ctx.shown = [];
  ctx.managerShowPrincipalRewardNotice = notice => ctx.shown.push(notice);
  return ctx;
}
test('only recipient receives notice; successful check is not repeated', async () => {
  let calls = 0;
  const ctx = context(async()=>{ calls++; return {message:'reward'}; });
  await ctx.managerLoadPrincipalRewardNotice();
  await ctx.managerLoadPrincipalRewardNotice();
  assert.equal(calls,1);
  assert.equal(ctx.shown.length,1);
});
test('nonrecipient and logged-out account see no notice', async () => {
  const ctx = context(async()=>null);
  await ctx.managerLoadPrincipalRewardNotice();
  ctx.AUTH_USER = null;
  await ctx.managerLoadPrincipalRewardNotice();
  assert.equal(ctx.shown.length,0);
});
test('failed read can retry', async () => {
  let calls=0;
  const ctx = context(async()=>{if(!calls++)throw Error('network');return {message:'reward'};});
  await ctx.managerLoadPrincipalRewardNotice();
  await ctx.managerLoadPrincipalRewardNotice();
  assert.equal(ctx.shown.length,1);
});
test('account switch discards an in-flight response', async () => {
  let resolve;
  const ctx = context(()=>new Promise(r=>{resolve=r;}));
  const pending=ctx.managerLoadPrincipalRewardNotice();
  ctx.managerResetPrincipalRewardNotice();
  ctx.AUTH_USER={id:'b'};
  resolve({message:'belongs to a'});
  await pending;
  assert.equal(ctx.shown.length,0);
});
test('reward is shown in ledger and counted as other income, not Combo', () => {
  const ctx = vm.createContext({managerLedgerRowHidden:()=>false});
  for(const name of ['managerLedgerStatusText','managerIncomePartsFromRow']) {
    const start=html.indexOf('function '+name+'(');
    const end=html.indexOf('\nfunction ',start+1);
    vm.runInContext(html.slice(start,end),ctx);
  }
  assert.equal(ctx.managerLedgerStatusText('beijing_rublev_r1_reward_2026'),'庆祝卢布列夫北京第一轮赢球');
  const part=ctx.managerIncomePartsFromRow({type:'beijing_rublev_r1_reward_2026',amount:300});
  assert.equal(part.kind,'other');
  assert.equal(part.amount,300);
});
