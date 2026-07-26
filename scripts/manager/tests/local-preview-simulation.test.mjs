import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');

test('all local previews use the isolated manager simulation path', () => {
  assert.match(
    html,
    /function managerLocalSimulationMode\(\)\{\s*return managerLocalPreviewEnabled\(\);\s*\}/,
  );
  assert.match(
    html,
    /function managerRemoteWritesEnabled\(\)\{\s*return managerSupabaseWriteMode\(\)&&!managerLocalSimulationMode\(\);\s*\}/,
  );
  assert.match(
    html,
    /function managerRequireLogin\(reason\)\{\s*if\(managerLocalSimulationMode\(\)\)return true;/,
  );
  assert.match(
    html,
    /async function managerLoadRemoteState\(opts\)\{\s*opts=opts\|\|\{\};\s*if\(managerLocalSimulationMode\(\)\)return null;/,
  );
});

test('lineup submission, withdrawal, and transfer use the guarded remote-write decision', () => {
  const guardedWrites = html.match(/if\(managerRemoteWritesEnabled\(\)\)\{/g) || [];
  assert.equal(guardedWrites.length, 3);
  assert.doesNotMatch(
    html.slice(html.indexOf('async function managerSubmitLineup('), html.indexOf('function managerMoneyAmount(')),
    /if\(managerSupabaseWriteMode\(\)\)\{/,
  );
  assert.doesNotMatch(
    html.slice(html.indexOf('async function managerTransferCommit('), html.indexOf('async function managerTransfer(')),
    /if\(managerSupabaseWriteMode\(\)\)\{/,
  );
});

test('local preview visibly explains that simulated roster actions never touch Supabase', () => {
  assert.match(html, /本地模拟提交模式：/);
  assert.match(html, /这些阵容操作只保存在当前浏览器，不会写入线上 Supabase/);
});
