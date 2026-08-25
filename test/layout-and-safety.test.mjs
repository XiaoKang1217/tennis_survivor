import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '../miniprogram');
const read = path => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);

test('native score UI keeps safe-area, readable touch targets and extreme-score overflow protections', () => {
  const globalCss = read('app.wxss');
  const scoreCss = read('pages/scores/index.wxss');
  const detailCss = read('pages/match-detail/index.wxss');
  const cardCss = read('components/match-card/index.wxss');
  assert.match(globalCss, /env\(safe-area-inset-bottom\)/);
  assert.match(globalCss, /min-height:\s*100vh/);
  assert.match(globalCss, /button\s*\{\s*min-height:\s*88rpx/);
  assert.match(scoreCss, /min-width:\s*0/);
  assert.match(detailCss, /overflow-wrap:\s*anywhere/);
  assert.match(detailCss, /overflow-x:\s*auto/);
  assert.match(cardCss, /text-overflow:\s*ellipsis/);
  assert.match(cardCss, /overflow-x:\s*auto/);
  assert.match(detailCss, /@media\s*\(max-width:340px\)/);
});

test('scores page follows the visual hierarchy and keeps the four product filters visible', () => {
  const markup = read('pages/scores/index.wxml');
  const css = read('pages/scores/index.wxss');
  const order = [
    'class="title-row"',
    'class="module-nav"',
    'class="search-row"',
    'class="date-switcher"',
    'class="quick-filters"',
    'class="data-notice-wrap"',
    'class="score-list"'
  ].map(needle => markup.indexOf(needle));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(css, /\.module-nav[^}]*display:flex/);
  assert.match(css, /\.module[^}]*flex:1 1 25%/);
  assert.match(css, /\.quick-filters[^}]*display:flex/);
  assert.match(css, /\.quick-filter[^}]*flex:1 1 25%/);
  assert.match(css, /\.scores-page[^}]*overflow-x:hidden/);
  assert.doesNotMatch(markup, /<scroll-view[^>]*quick-filters/);
  assert.doesNotMatch(markup, /<button[^>]*class="(?:tournament-head|court-head|quick-filter|filter-action)/);
  assert.match(markup, /实时比分/);
  assert.match(markup, /赛事签表/);
  assert.match(markup, /巡回赛历/);
  assert.match(markup, /参赛动态/);
  assert.match(markup, /<product-tabbar active="matches"/);
});

test('white-blue visual language preserves tournament, court, match and detail hierarchy', () => {
  const globalCss = read('app.wxss');
  const scoreMarkup = read('pages/scores/index.wxml');
  const scoreCss = read('pages/scores/index.wxss');
  const cardMarkup = read('components/match-card/index.wxml');
  const cardCss = read('components/match-card/index.wxss');
  const detailMarkup = read('pages/match-detail/index.wxml');
  const detailCss = read('pages/match-detail/index.wxss');
  assert.match(globalCss, /--brand:\s*#1769df/);
  assert.match(globalCss, /--canvas:\s*#f1f6fd/);
  assert.match(globalCss, /--brand:\s*#187a59/);
  assert.match(globalCss, /--canvas:\s*#0d1522/);
  assert.match(scoreMarkup, /tournament-mark/);
  assert.match(scoreMarkup, /court-head/);
  assert.match(scoreCss, /surface-hard[\s\S]*var\(--brand-soft\)/);
  assert.match(scoreCss, /surface-clay[\s\S]*rgba\(217,45,32,.10\)/);
  assert.match(scoreCss, /surface-grass[\s\S]*rgba\(32,166,106,.10\)/);
  assert.match(scoreCss, /surface-neutral[\s\S]*var\(--surface-subtle\)/);
  assert.match(cardMarkup, /class="card-head"/);
  assert.match(cardMarkup, /class="score-grid"/);
  assert.match(cardMarkup, /class="card-foot"/);
  assert.match(cardMarkup, /currentPointHighlighted/);
  assert.match(cardCss, /\.game-point\.last-point[^}]*background:var\(--brand\)/);
  assert.match(detailMarkup, /class="score-hero"/);
  assert.match(detailMarkup, /class="module-tabs"/);
  assert.match(detailCss, /\.module-tabs[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('production views contain no special-result state machine or local business fallbacks', () => {
  const viewModel = read('core/view-model.js');
  const detailModules = read('core/detail-modules.js');
  const cardMarkup = read('components/match-card/index.wxml');
  const detailMarkup = read('pages/match-detail/index.wxml');
  const dataNotice = read('components/data-notice/index.wxml');
  for (const source of [viewModel, cardMarkup, detailMarkup]) {
    assert.doesNotMatch(source, /status(?:\.code)?\s*={2,3}\s*['"]walkover['"]/);
    assert.doesNotMatch(source, /['"](?:WO|RET)['"]/);
    assert.doesNotMatch(source, /scoreKindNotice/);
  }
  assert.doesNotMatch(detailModules, /加载|暂无|延迟|失败|稍后|重试/);
  assert.doesNotMatch(dataNotice, /\?\?\s*['"]/);
  assert.match(detailModules, /label:\s*module\.label/);
  assert.match(detailModules, /message:\s*module\.message/);
});

test('client transport and BFF delivery are rendered as independent dimensions', () => {
  const scorePage = read('pages/scores/index.js');
  const scoreMarkup = read('pages/scores/index.wxml');
  const detailPage = read('pages/match-detail/index.js');
  const detailMarkup = read('pages/match-detail/index.wxml');
  assert.match(scorePage, /clientTransportState/);
  assert.match(scorePage, /dataDeliveryState/);
  assert.match(scoreMarkup, /state-\{\{clientTransportState\}\}/);
  assert.match(scoreMarkup, /state="\{\{dataDeliveryState\}\}"/);
  assert.match(detailPage, /statisticsTransportState/);
  assert.match(detailMarkup, /state-\{\{statisticsTransportState\}\}/);
  assert.match(detailMarkup, /state="\{\{match\.dataDeliveryState\}\}"/);
  assert.doesNotMatch(scorePage, /setData\(\{[^}]*dataDeliveryState:\s*['"](?:stale|unavailable)['"]/s);
  assert.match(
    scorePage,
    /dataUpdatedTime:\s*updateClock\(\s*projection\.projectionGeneratedAt\s*\|\|\s*projection\.dataAsOf\s*\)/s
  );
});

test('match detail module tabs tolerate lightweight list projections', () => {
  const { modulesView } = require('../miniprogram/core/detail-modules');
  const tabs = modulesView(undefined);
  assert.deepEqual(tabs.map(tab => tab.id), [
    'statistics',
    'point_by_point',
    'h2h',
    'progression_path'
  ]);
  assert.equal(tabs[0].state, 'loading');
  assert.equal(tabs[0].label, '比赛统计');
});

test('match detail uses the live statistics contract without polling completion archives', () => {
  const detailPage = read('pages/match-detail/index.js');
  assert.match(detailPage, /StatisticsStore/);
  assert.match(detailPage, /StatisticsClient/);
  assert.doesNotMatch(detailPage, /CompletionStatistics(?:Store|Client)/);
  assert.doesNotMatch(detailPage, /completion\/realtime/);
});

test('match detail renders production DTOs without rebuilding score, odds or H2H locally', () => {
  const detailPage = read('pages/match-detail/index.js');
  const detailMarkup = read('pages/match-detail/index.wxml');
  const detailCss = read('pages/match-detail/index.wxss');
  const viewModel = read('core/view-model.js');
  assert.match(viewModel, /contextualStatusText/);
  assert.match(detailPage, /displayDateTime/);
  assert.match(detailMarkup, /class="center-score-panel"/);
  assert.match(detailMarkup, /member\.portraitUrl/);
  assert.match(detailMarkup, /class="hero-odds-lines"/);
  assert.match(detailMarkup, /class="point-set-tabs"/);
  assert.match(detailMarkup, /data-set="\{\{item\.setNumber\}\}"/);
  assert.match(detailMarkup, /class="h2h-match-meta"/);
  assert.match(detailMarkup, /class="h2h-winner"/);
  assert.match(detailMarkup, /item\.tournament/);
  assert.match(detailMarkup, /item\.level/);
  assert.match(detailMarkup, /item\.round/);
  assert.match(detailMarkup, /item\.result/);
  assert.match(detailMarkup, /item\.winner/);
  assert.match(detailCss, /\.center-score-panel/);
  assert.match(detailCss, /\.point-set-tabs[^}]*border/);
  assert.match(detailCss, /\.h2h-winner/);
  assert.doesNotMatch(detailMarkup, /odds-card|odds-panel|赔率框/);
});

test('M4 match detail retries stay on trusted match-scoped module results', () => {
  const detailPage = read('pages/match-detail/index.js');
  assert.match(detailPage, /\/api\/v1\/bff\/matches\/\$\{encodeURIComponent\(match\.id\)\}\/h2h/u);
  assert.doesNotMatch(detailPage, /\/api\/v1\/bff\/h2h\/\$\{/u);
  assert.doesNotMatch(detailPage, /h2hPlayerIds|scheduleH2hRetry|h2hRetryTimer/u);
  assert.doesNotMatch(detailPage, /\/api\/v1\/bff\/draws\?tournamentEditionId=/u);
  assert.doesNotMatch(detailPage, /for\s*\(\s*const\s+candidate\s+of\s+candidates/u);
  assert.match(detailPage, /loadMatch\(\{\s*force:\s*true,\s*showLoading:\s*false\s*\}/u);
});

test('match card styles use mini-program-compatible class selectors', () => {
  const cardMarkup = read('components/match-card/index.wxml');
  const cardCss = read('components/match-card/index.wxss');
  assert.match(cardMarkup, /class="set-score\s/);
  assert.match(cardCss, /\.set-score\s*\{/);
  assert.doesNotMatch(cardCss, />\s*text/);
});

test('match card keeps a stable skeleton across states and the required player identity order', () => {
  const cardMarkup = read('components/match-card/index.wxml');
  const cardCss = read('components/match-card/index.wxss');
  const identityOrder = ['class="seed"', 'class="country-stack"', 'class="name-wrap"']
    .map(needle => cardMarkup.indexOf(needle));
  assert.ok(identityOrder.every(index => index >= 0));
  assert.deepEqual([...identityOrder].sort((a, b) => a - b), identityOrder);
  assert.match(cardMarkup, /class="country-code"/);
  assert.match(cardMarkup, /template-\{\{match\.template\}\}/);
  assert.match(cardCss, /\.template-live[^}]*border-left-color:var\(--live\)/);
  assert.match(cardCss, /\.template-finished[^}]*border-left-color:var\(--success\)/);
  assert.match(cardCss, /\.template-delayed_or_postponed,\.template-interrupted_or_suspended/);
  assert.match(cardCss, /\.template-special_result[^}]*border-left-color:var\(--special\)/);
});

test('production package has no credential or identity logging surface', () => {
  const app = read('app.js');
  const auth = read('services/auth-session.js');
  const safeEvents = read('core/safe-events.js');
  for (const source of [app, auth, safeEvents]) {
    assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
    assert.doesNotMatch(source, /AppSecret|session_key|OPENID|openid/);
  }
  assert.doesNotMatch(safeEvents, /payload|metadata|context/);
});

test('profile gate uses valid WeChat open-ability entries for identity collection', () => {
  const markup = read('components/profile-gate/index.wxml');
  assert.match(markup, /open-type="agreePrivacyAuthorization"/);
  assert.match(markup, /open-type="chooseAvatar"/);
  assert.match(markup, /type="nickname"/);
  assert.match(markup, /bindtap="onSubmitProfile"/);
  assert.match(markup, /bindagreeprivacyauthorization="onAgreePrivacyAuthorization"/);
  assert.match(markup, /bindchooseavatar="onChooseAvatar"/);
  assert.doesNotMatch(markup, /getPhoneNumber|bindgetphonenumber|phoneAuthDetail|手机号/);
  const script = read('components/profile-gate/index.js');
  assert.match(script, /openPrivacyContract/);
  assert.match(script, /onSubmitProfile/);
  assert.doesNotMatch(script, /onGetPhoneNumber|phoneAuth|phoneCode|profile_phone/);
  const account = read('services/account-service.js');
  assert.match(account, /getFileSystemManager/);
  assert.match(account, /contentBase64/);
  assert.doesNotMatch(account, /uploadFile|getPhoneNumber|phoneCode|profile_phone_required/);
});
