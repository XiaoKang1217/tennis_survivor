import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const elite of [false,true]){
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:8092/?manager-view=market${elite?'&finals-tier=top8':''}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof managerBuildPool==='function'&&MANAGER_ACTIVE_EVENTS&&MANAGER_ACTIVE_EVENTS.station_key==='2026-w46-wta-finals'&&managerBuildPool().length===8);
  const result=await page.evaluate(async()=>{
   if(managerWallet()!==0)throw new Error('Preview must not invent a starting wallet: '+managerWallet());
   managerWallet=()=>3000; // Isolated test fixture, never shipped in application code.
   const ps=managerBuildPool().slice(0,2);MANAGER_LINEUP=ps.map(p=>p.id);MANAGER_PREDICTIONS={};
   MANAGER_PREDICTIONS[ps[0].id]='W2';MANAGER_PREDICTIONS[ps[1].id]='SF3';
   const c=managerCalc();
   MANAGER_VIEW='calculator';renderManagerDemo(true);
   return {cost:c.spent,gross:c.gross,bonus:c.bonus,legal:c.legal,oldPoints:managerRoundValue('W','1000','ATP',56),scores:managerBuildPool().map(p=>[p.base,p.surfaceScore,p.form,p.draw])};
  });
  assert.equal(result.cost,elite?0:2000);assert.equal(result.gross,elite?13250:9000);assert.equal(result.bonus,0);assert.ok(result.legal);assert.equal(result.oldPoints,1000);
  assert.ok(result.scores.every(row=>!row.every(n=>n===50)));
  await page.screenshot({path:`/tmp/finals-verified-${elite?'elite':'ordinary'}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`/tmp/finals-verified-mobile-${elite?'elite':'ordinary'}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflow');
  const submission=await page.evaluate(async()=>{
   await managerSubmitLineup(true);const submitted=!!managerSubmittedRecord();
   await managerWithdrawLineup(true);return {submitted,withdrawn:!managerSubmittedRecord()};
  });
  assert.deepEqual(submission,{submitted:true,withdrawn:true});
  assert.deepEqual(errors,[]);
  console.log(elite?'Elite':'Ordinary',result,submission);
  await page.close();
 }
}finally{await browser.close();}
