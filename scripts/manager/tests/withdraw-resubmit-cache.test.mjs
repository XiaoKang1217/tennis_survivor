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
  vm.runInContext(functionSource('managerRemoteLineupIsAuthoritative'), context);
  vm.runInContext(functionSource('managerRemoteContracts'), context);
  vm.runInContext(functionSource('managerLineupPlayers'), context);
  return [...context.managerLineupPlayers()].map((player) => player.id);
}

function applyRemoteState({ lineup, contracts, localIds, predictions }) {
  const context = {
    AUTH_USER: null,
    MANAGER_REMOTE_STATE: null,
    MANAGER_REMOTE_ALL_LEDGER: [],
    MANAGER_REMOTE_ALL_LEDGER_SYNC_KEY: '',
    MANAGER_REMOTE_SYNC_KEY: '',
    MANAGER_REMOTE_SYNC_AT: 0,
    MANAGER_LINEUP: [...localIds],
    MANAGER_PREDICTIONS: { ...predictions },
    MANAGER_SUNK_COST: 17,
    MANAGER_TRANSFER_COUNT: 0,
    MANAGER_BADGES: [],
    MANAGER_MY_BADGES: [],
    MANAGER_ACTIVE_BADGE: null,
    managerNormalizeIds: (ids, max) => [...new Set(ids)].slice(0, max),
    managerRules: () => ({ maxPlayers: 4 }),
    managerNormalizeBadge: (badge) => badge || null,
    managerSaveState: () => { context.saveCalls += 1; },
    updateAuthUi: () => {},
    saveCalls: 0,
  };
  vm.createContext(context);
  vm.runInContext(functionSource('managerRemoteLineupIsAuthoritative'), context);
  vm.runInContext(functionSource('managerApplyRemoteState'), context);
  context.managerApplyRemoteState({ lineup, contracts });
  return {
    lineup: [...context.MANAGER_LINEUP],
    predictions: { ...context.MANAGER_PREDICTIONS },
    sunkCost: context.MANAGER_SUNK_COST,
    transferCount: context.MANAGER_TRANSFER_COUNT,
    saveCalls: context.saveCalls,
    remoteContracts: context.MANAGER_REMOTE_STATE.contracts,
  };
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

test('an asynchronous empty remote state never clears an unsubmitted local draft', () => {
  const result = applyRemoteState({
    lineup: null,
    contracts: [],
    localIds: newPlayers.map((player) => player.id),
    predictions: { [newPlayers[0].id]: 'SF', [newPlayers[1].id]: 'QF' },
  });
  assert.deepEqual(result.lineup, newPlayers.map((player) => player.id));
  assert.deepEqual(result.predictions, { [newPlayers[0].id]: 'SF', [newPlayers[1].id]: 'QF' });
  assert.equal(result.sunkCost, 17);
  assert.equal(result.saveCalls, 0);
});

test('an asynchronous cancelled remote state never clears a withdrawn local draft', () => {
  const result = applyRemoteState({
    lineup: { status: 'cancelled', transfer_count: 0 },
    contracts: oldPlayers.map((player) => ({ player_key: player.id, name: player.name, is_active: true })),
    localIds: newPlayers.map((player) => player.id),
    predictions: { [newPlayers[0].id]: 'F', [newPlayers[1].id]: 'SF' },
  });
  assert.deepEqual(result.lineup, newPlayers.map((player) => player.id));
  assert.deepEqual(result.predictions, { [newPlayers[0].id]: 'F', [newPlayers[1].id]: 'SF' });
  assert.equal(result.sunkCost, 17);
  assert.equal(result.saveCalls, 0);
});

test('official transfer still refreshes and persists only the new active contract', () => {
  const result = applyRemoteState({
    lineup: { status: 'locked', transfer_count: 1 },
    contracts: [
      { player_key: oldPlayers[0].id, name: oldPlayers[0].name, is_active: false, predicted_round: 'QF' },
      { player_key: newPlayers[0].id, name: newPlayers[0].name, is_active: true, predicted_round: 'SF' },
    ],
    localIds: [oldPlayers[0].id],
    predictions: { [oldPlayers[0].id]: 'QF' },
  });
  assert.deepEqual(result.lineup, [newPlayers[0].id]);
  assert.deepEqual(result.predictions, { [newPlayers[0].id]: 'SF' });
  assert.equal(result.transferCount, 1);
  assert.equal(result.saveCalls, 1);
  assert.equal(result.remoteContracts.find((contract) => contract.player_key === oldPlayers[0].id).is_active, false);
});

test('remote submit persists the authoritative cache and render does not reload stale storage', () => {
  const applySource = functionSource('managerApplyRemoteState');
  const renderSource = functionSource('renderManagerDemo');
  assert.match(applySource, /if\(authoritative\)managerSaveState\(\)/);
  assert.doesNotMatch(renderSource, /managerLoadState\(\)/);
});
