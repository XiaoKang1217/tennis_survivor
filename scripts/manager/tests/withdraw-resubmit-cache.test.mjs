import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function lineupPlayers({ status, localIds, contracts, pool }) {
  const context = {
    MANAGER_REMOTE_STATE: { lineup: { status }, contracts },
    MANAGER_LINEUP: localIds,
    managerBuildPool: () => pool,
    managerPlayerFromContract: (contract) => ({
      id: contract.player_key,
      sourcePlayerKey: contract.player_key,
      name: contract.name,
    }),
  };
  vm.createContext(context);
  vm.runInContext(functionSource('managerRemoteContracts'), context);
  vm.runInContext(functionSource('managerLineupPlayers'), context);
  return [...context.managerLineupPlayers()].map((player) => player.id);
}

const oldPlayers = [
  { id: 'ATP|alexander-blockx', sourcePlayerKey: 'ATP|alexander-blockx', name: '布洛克斯' },
  { id: 'WTA|nikola-bartunkova', sourcePlayerKey: 'WTA|nikola-bartunkova', name: '巴尔通科娃' },
];
const newPlayers = [
  { id: 'ATP|luciano-darderi', sourcePlayerKey: 'ATP|luciano-darderi', name: '达尔德里' },
  { id: 'WTA|barbora-krejcikova', sourcePlayerKey: 'WTA|barbora-krejcikova', name: '克赖奇科娃' },
];
const newContracts = newPlayers.map((player) => ({
  player_key: player.id,
  name: player.name,
  is_active: true,
}));

test('resubmitted lineup renders only authoritative active contracts, not stale local picks', () => {
  assert.deepEqual(
    lineupPlayers({
      status: 'submitted',
      localIds: [...oldPlayers, ...newPlayers].map((player) => player.id),
      contracts: newContracts,
      pool: [...oldPlayers, ...newPlayers],
    }),
    newPlayers.map((player) => player.id),
  );
});

test('withdrawn lineup keeps the editable local draft without merging cancelled remote contracts', () => {
  assert.deepEqual(
    lineupPlayers({
      status: 'cancelled',
      localIds: newPlayers.map((player) => player.id),
      contracts: oldPlayers.map((player) => ({ player_key: player.id, name: player.name, is_active: true })),
      pool: [...oldPlayers, ...newPlayers],
    }),
    newPlayers.map((player) => player.id),
  );
});

test('remote submit persists the authoritative cache and render does not reload stale storage', () => {
  const applySource = functionSource('managerApplyRemoteState');
  const renderSource = functionSource('renderManagerDemo');
  assert.match(applySource, /state\.lineup&&state\.lineup\.status!=='cancelled'\)managerSaveState\(\)/);
  assert.doesNotMatch(renderSource, /managerLoadState\(\)/);
});
