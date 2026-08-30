import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const textExtensions = new Set(['.js', '.json', '.wxml', '.wxss']);
const scanEntries = Object.freeze([
  'app.js',
  'app.json',
  'app.wxss',
  'components',
  'core',
  'pages',
  'packages',
  'services'
]);

function j(...parts) { return parts.join(''); }

const forbiddenCopy = Object.freeze([
  j('界面', '皮肤'),
  j('本地', '可信'),
  j('后台', '更新'),
  j('同步', '加载'),
  j('独立', '加载'),
  j('并行', '更新'),
  j('资料', '完整度'),
  j('资料', '可用性'),
  j('签表', '顶点'),
  j('会话', '续期中'),
  j('正在加载', '今日赛程'),
  j('该官方赛程日', '暂不可用'),
  j('这与当天没有比赛不同', '；请稍后重试或切换日期'),
  j('没有符合条件', '的比赛'),
  j('可以切换快捷筛选', '、搜索词或官方赛程日'),
  j('正在读取官方', '每轮奖金与积分'),
  j('官方尚未发布可核验的', '每轮奖金与积分'),
  j('当前签表暂无可展示的', '晋级路径'),
  j('该球员当前没有已连接的', '签表路径'),
  j('送花榜', '稍后接入'),
  j('按排名加载首批', '球员资料'),
  j('本周', '排名'),
  j('胜 /', ' 负'),
  j('可查看小程序管理后台配置的', '隐私指引'),
  j('选择', '过往签表'),
  j('按时间线定位', '赛事签表'),
  j('按周查看全球', '巡回赛'),
  j('本月暂无', '对应赛事'),
  j('可以切换月份或', '赛事类别'),
  j('冠军，还要', '赢三场'),
  j('冠军之路，已经来到', '最后八人'),
  j('LU', 'WANG')
]);

const files = [];
function walk(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name.startsWith('.')) continue;
      walk(join(path, name));
    }
  } else if (textExtensions.has(extname(path))) {
    files.push(path);
  }
}

for (const entry of scanEntries) walk(join(root, entry));

for (const file of files) {
  const label = relative(root, file);
  const text = readFileSync(file, 'utf8');
  for (const term of forbiddenCopy) {
    assert.equal(text.includes(term), false, `${label} contains retired R4 copy: ${term}`);
  }
  assert.doesNotMatch(text, /assets\/share\/[^'")\s]+\.jpe?g/i,
    `${label} references a retired share JPG fallback`);
  if (/\.(?:wxml)$/u.test(file) && /^(?:pages|packages|components)\//u.test(label)) {
    assert.equal(text.includes(j('is', 'Daylight')), false,
      `${label} contains a page-level daylight fork`);
  }
}

const shareDir = join(root, 'assets/share');
const shareFiles = existsSync(shareDir) ? readdirSync(shareDir) : [];
assert.deepEqual(shareFiles.filter(name => /\.jpe?g$/iu.test(name)), [],
  'share JPG fallbacks must stay out of the production package');

const participation = readFileSync(join(root, 'pages/participation/index.js'), 'utf8')
  + readFileSync(join(root, 'pages/participation/index.wxml'), 'utf8');
assert.doesNotMatch(participation, /M7-PARTICIPATION-DEFERRED-BY-OWNER/);
assert.match(participation, /services\.entries\.index\(\)/);
assert.match(participation, /按赛事/);
assert.match(participation, /按球员/);
assert.doesNotMatch(participation, /\/api\/v1\/bff\/participation/);
assert.doesNotMatch(participation, /normalizeKind|withdraw|retire|退赛.*正则/u);
assert.match(participation, /暂无参赛动态/);
assert.match(participation, /退赛、替补和名单变化会显示在这里/);

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
assert.ok(Array.isArray(app.subpackages) && app.subpackages.length >= 2,
  'app.json must use real subpackages');
assert.ok(app.preloadRule?.['pages/scores/index']?.packages?.includes('packages/player'));
assert.ok(app.preloadRule?.['pages/scores/index']?.packages?.includes('packages/tournament'));
assert.ok(app.pages.includes('pages/draws/index'));
assert.equal(app.pages.includes('pages/players/index'), false);
assert.equal(app.pages.includes('pages/player-detail/index'), false);
assert.equal(app.pages.includes('pages/tournament-detail/index'), false);
assert.equal(app.pages.includes('pages/draw-landscape/index'), false);
