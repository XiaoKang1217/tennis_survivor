import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../../../assets/manager/badges/ui-v18/badge-ui-v18.css', import.meta.url), 'utf8');

const headerRule = css.match(/#hdr\.badge-login-header \.badge-identity--login\[data-badge="alcaraz_bee_duck"\]\{([^}]+)\}/);
assert.ok(headerRule, 'live bee-duck header must have a context-specific calibration');
assert.match(headerRule[1], /--badge-icon-size:54px/);
assert.match(headerRule[1], /--badge-plate-width:175px/);
assert.match(headerRule[1], /--badge-plate-height:66px/);

const leaderboardRule = css.match(/body \.manager-boards-page \.badge-identity--row\[data-badge="alcaraz_bee_duck"\],[\s\S]*?\{([^}]+)\}/);
assert.ok(leaderboardRule, 'live bee-duck leaderboard must preserve the plaque aspect ratio');
assert.match(leaderboardRule[1], /--badge-plate-width:166px/);
assert.match(leaderboardRule[1], /--badge-plate-height:63px/);

const nameRules = css.match(/body \.manager-boards-page \.badge-identity--row\[data-badge="alcaraz_bee_duck"\] \.badge-identity__name,[\s\S]*?\{([^}]+)\}/);
assert.ok(nameRules, 'bee-duck leaderboard copy must have explicit alignment');
assert.match(nameRules[1], /align-items:center/);
assert.match(nameRules[1], /justify-content:center/);
assert.match(nameRules[1], /font-size:12px/);

console.log('bee-duck live lockup regression checks passed');
