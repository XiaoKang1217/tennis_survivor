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
  assert.equal(ctx.managerLedgerStatusText('beijing_window_compensation_2026'),'忘记开启北京换人窗口补偿');
  const compensation=ctx.managerIncomePartsFromRow({type:'beijing_window_compensation_2026',amount:500});
  assert.equal(compensation.kind,'other');
  assert.equal(compensation.amount,500);
});

function dialogContext(rpc) {
  const elements = new Map();
  const dialogs = [];
  const document = {
    getElementById:id=>elements.get(id),
    createElement(tag) {
      const children = new Map();
      return {
        tag, listeners:{},
        querySelector(selector) {
          if (!children.has(selector)) children.set(selector, {listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
          return children.get(selector);
        },
        setAttribute(){},
        addEventListener(type,fn){this.listeners[type]=fn;},
        showModal(){this.open=true;}, close(){this.open=false;},
        remove(){if(elements.get(this.id)===this)elements.delete(this.id);}
      };
    },
    head:{appendChild(el){elements.set(el.id,el);}},
    body:{appendChild(el){elements.set(el.id,el);dialogs.push(el);}}
  };
  const ctx=vm.createContext({AUTH_USER:{id:'a'},document,supabaseRpc:rpc});
  vm.runInContext(source,ctx);
  return {ctx,dialogs};
}
test('confirmation acknowledges the specific campaign and then loads older pending notice', async()=>{
  const pending=[{id:'new',title:'补偿本金已到账',message:'500'},{id:'old',message:'300'}];
  const ack=[];
  const {ctx,dialogs}=dialogContext(async(name,args)=>{
    if(name==='tour_manager_get_principal_reward_notice')return pending[0]||null;
    assert.equal(name,'tour_manager_ack_principal_reward_notice');
    ack.push(args.p_notice_id);
    assert.equal(args.p_notice_id,pending.shift().id);
    return true;
  });
  await ctx.managerLoadPrincipalRewardNotice();
  assert.equal(dialogs[0].querySelector('#manager-principal-reward-title').textContent,'补偿本金已到账');
  await dialogs[0].querySelector('button').listeners.click();
  assert.equal(dialogs.length,2);
  assert.deepEqual(ack,['new']);
  await dialogs[1].querySelector('button').listeners.click();
  await ctx.managerLoadPrincipalRewardNotice();
  assert.deepEqual(ack,['new','old']);
  assert.equal(dialogs.length,2);
});
test('failed confirmation keeps dialog visible and allows retry',async()=>{
  let attempts=0, acknowledged=false;
  const {ctx,dialogs}=dialogContext(async(name)=>{
    if(name==='tour_manager_get_principal_reward_notice')return acknowledged?null:{id:'new',message:'500'};
    if(!attempts++)throw Error('network');
    acknowledged=true;
    return true;
  });
  await ctx.managerLoadPrincipalRewardNotice();
  const modal=dialogs[0],button=modal.querySelector('button');
  await button.listeners.click();
  assert.equal(modal.open,true);
  assert.equal(button.disabled,false);
  assert.equal(modal.querySelector('.reward-error').hidden,false);
  await button.listeners.click();
  assert.equal(modal.open,false);
});
test('account switch prevents confirmation of a stale dialog',async()=>{
  let calls=0;
  const {ctx,dialogs}=dialogContext(async()=>{calls++;return {id:'new',message:'500'};});
  await ctx.managerLoadPrincipalRewardNotice();
  ctx.managerResetPrincipalRewardNotice();
  ctx.AUTH_USER={id:'b'};
  await dialogs[0].querySelector('button').listeners.click();
  assert.equal(calls,1);
});
