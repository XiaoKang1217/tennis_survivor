export const FINALS_CUTOFF = '2026-11-09T04:00:00+08:00';
export const FINALS_RATES = Object.freeze({
  ordinary: Object.freeze({price:1000, RR:200, SF:1000, F:2000, W:4000}),
  top8: Object.freeze({price:0, RR:250, SF:1500, F:3000, W:6000})
});

export function finalsQuote({wins=0, stage='RR', top8=false}={}) {
  if (!Number.isInteger(wins) || wins < 0 || wins > 3) throw new Error('Invalid round-robin win count');
  const stages=['RR','SF','F','W'];
  const index=stages.indexOf(stage);
  if(index<0) throw new Error('Invalid finals stage');
  const rate=top8 ? FINALS_RATES.top8 : FINALS_RATES.ordinary;
  const components={round_robin:wins*rate.RR,semifinal:index>=1?rate.SF:0,final:index>=2?rate.F:0,champion:index>=3?rate.W:0};
  const gross=Object.values(components).reduce((a,b)=>a+b,0);
  return {cost:rate.price,components,gross,net:gross-rate.price};
}

// Qualification is explicit source evidence, never inferred from one win or loss.
export function finalsProgress({matches=[], playerId, qualifiedSF=false, qualifiedF=false, champion=false, groupComplete=false}) {
  const seen=new Map();
  for(const match of matches) {
    if(match.phase!=='RR' || !match.completed || !match.winnerId) continue;
    if(!match.id) throw new Error('Completed match requires stable source id');
    const previous=seen.get(match.id);
    if(previous && previous.winnerId!==match.winnerId) throw new Error('Conflicting source match results');
    seen.set(match.id,match);
  }
  const wins=[...seen.values()].filter(m=>m.winnerId===playerId).length;
  if(wins>3) throw new Error('More than three round-robin wins');
  const stage=champion?'W':qualifiedF?'F':qualifiedSF?'SF':'RR';
  return {wins,stage,groupEliminated:groupComplete && stage==='RR'};
}

export function finalsSettlementDelta(quote, alreadyPaid) {
  if(!Number.isInteger(alreadyPaid)||alreadyPaid<0) throw new Error('Invalid paid total');
  if(quote.gross<alreadyPaid) throw new Error('Source correction needs review; do not silently claw back');
  return quote.gross-alreadyPaid;
}
