import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_EXTENSIONS,
  compilerSuppressionViolations,
  domainDependencyViolations,
  extractModuleSpecifiers,
  matchStateMutationViolations,
  matchStatusAssertionViolations,
  nonStaticModuleLoadViolations,
  providerFieldViolations,
  readCodeFiles,
  transitiveDomainDependencyViolations,
  typeAwareSafetyViolations,
  walkCodeFiles
} from '../scripts/architecture-gates.mjs';

const serviceRoot = fileURLToPath(new URL('..', import.meta.url));
const providerRegistry = JSON.parse(fs.readFileSync(
  path.join(serviceRoot, 'test/architecture/provider-field-registry.json'),
  'utf8'
));
const stateMutationAllowlist = JSON.parse(fs.readFileSync(
  path.join(serviceRoot, 'test/architecture/state-mutation-allowlist.json'),
  'utf8'
));

test('architecture scanner recursively covers JS and TypeScript module extensions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-score-architecture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nested = path.join(root, 'nested/deeper');
  fs.mkdirSync(nested, { recursive: true });
  for (const extension of CODE_EXTENSIONS) {
    fs.writeFileSync(path.join(nested, `module${extension}`), 'export {};\n');
  }
  fs.writeFileSync(path.join(nested, 'ignored.json'), '{}\n');
  assert.equal(walkCodeFiles(root).length, CODE_EXTENSIONS.size);
});

test('architecture scanner detects static, exported, require and dynamic imports', () => {
  const source = `
    import adapter from '../adapters/api-tennis/client.js';
    export { handler } from '../../api/http/handler.ts';
    const postgres = require('pg');
    const transport = import("node:http");
  `;
  assert.deepEqual(extractModuleSpecifiers(source).sort(), [
    '../../api/http/handler.ts',
    '../adapters/api-tennis/client.js',
    'node:http',
    'pg'
  ]);
  const violations = domainDependencyViolations([{ path: 'nested/model.mts', source }]);
  assert.equal(violations.length, 4, 'negative dependency fixture must be rejected');
});

test('domain gate rejects every import() and require() whose target is not statically resolvable', () => {
  const files = [{
    path: 'domain/dynamic.ts',
    source: `
      const first = require(moduleName);
      const second = import(prefix + suffix);
      const third = require();
      const hidden = require;
    `
  }];
  assert.deepEqual(nonStaticModuleLoadViolations(files).map(item => item.kind), [
    'require',
    'dynamic-import',
    'require',
    'require-reference'
  ]);
  assert.equal(domainDependencyViolations(files).length, 4);
  assert.equal(transitiveDomainDependencyViolations(files).length, 4);
});

test('transitive domain graph rejects a dynamic module load hidden in shared code', () => {
  const violations = transitiveDomainDependencyViolations([
    {
      path: 'domain/model.ts',
      source: "export { load } from '../shared/load.js';"
    },
    {
      path: 'shared/load.ts',
      source: 'export const load = name => import(name);'
    }
  ]);
  assert.deepEqual(violations[0].chain, [
    'domain/model.ts',
    'shared/load.ts',
    '<dynamic-import:non-static>'
  ]);
});

test('domain recursively imports no adapter, HTTP, database, projection, API or UI module', () => {
  const v2Root = path.join(serviceRoot, 'v2/src');
  const allFiles = readCodeFiles(v2Root);
  const domainFiles = allFiles.filter(file => file.path.startsWith('domain/'));
  assert.deepEqual(domainDependencyViolations(domainFiles), []);
  assert.deepEqual(transitiveDomainDependencyViolations(allFiles), []);
});

test('transitive graph rejects domain through a shared module into persistence', () => {
  const files = [
    {
      path: 'domain/model.ts',
      source: "export { shared } from '../shared/helper.js';"
    },
    {
      path: 'shared/helper.ts',
      source: "export { store as shared } from '../persistence/store.js';"
    },
    {
      path: 'persistence/store.ts',
      source: 'export const store = true;'
    }
  ];
  const violations = transitiveDomainDependencyViolations(files);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].chain, [
    'domain/model.ts',
    'shared/helper.ts',
    'persistence/store.ts'
  ]);
});

test('transitive graph rejects unresolved bare aliases unless explicitly pure-allowlisted', () => {
  const files = [{
    path: 'domain/model.ts',
    source: "export { client } from '@shared/client';"
  }];
  assert.deepEqual(transitiveDomainDependencyViolations(files)[0].chain, [
    'domain/model.ts',
    '@shared/client'
  ]);
  assert.deepEqual(
    transitiveDomainDependencyViolations(files, ['@shared/client']),
    []
  );
});

test('provider field gate rejects API Tennis and Goalserve leakage in protected layers', () => {
  const violations = providerFieldViolations([{
    path: 'domain/match.ts',
    source: `
      export const leaked = raw.event_final_result;
      const prefix = 'event_';
      const suffix = 'status';
      export const propagated = raw[prefix + suffix];
      export const supplier = "Goalserve";
    `
  }], providerRegistry);
  assert.equal(violations.some(item =>
    item.provider === 'api-tennis' && item.match === 'event_final_result'), true);
  assert.equal(violations.some(item =>
    item.provider === 'api-tennis' && item.match === 'event_status'), true);
  assert.equal(violations.filter(item =>
    item.provider === 'api-tennis' && item.match === 'event_status').length >= 1, true);
  assert.equal(violations.some(item => item.provider === 'goalserve'), true);
});

test('protected layers reject code-generation escape hatches without blanket reflection bans', () => {
  const violations = providerFieldViolations([{
    path: 'domain/escape.ts',
    source: `
      const dynamic = raw[fieldName];
      const reflected = Reflect.get(raw, fieldName);
      const evaluated = eval(source);
      const generated = Function(source);
      const proxied = new Proxy(raw, {});
    `
  }], providerRegistry);
  const kinds = new Set(violations.map(item => item.kind));
  for (const kind of [
    'eval',
    'Function-constructor',
    'Proxy'
  ]) {
    assert.equal(kinds.has(kind), true, `${kind} must be rejected`);
  }
});

test('protected gates allow normal dynamic DTO, entries, map and Reflect reads', () => {
  const files = [{
    path: 'projections/read.ts',
    source: `
      export const read = (dto, entries, index, map, field) => ({
        status: dto.status,
        explicitStatus: dto['status'],
        entry: entries[index],
        mapped: map[field],
        reflected: Reflect.get(map, field)
      });
    `
  }];
  assert.deepEqual(providerFieldViolations(files, providerRegistry), []);
  assert.deepEqual(matchStateMutationViolations(files), []);
});

test('provider raw fields do not appear in domain, projections or API', () => {
  const files = providerRegistry.protectedLayers.flatMap(relative =>
    readCodeFiles(path.join(serviceRoot, relative))
      .map(file => ({ ...file, path: `${relative}/${file.path}` })));
  assert.deepEqual(providerFieldViolations(files, providerRegistry), []);
});

test('Goalserve field registry remains explicitly blocked until a real schema sample exists', () => {
  const contract = providerRegistry.providers.goalserve;
  assert.equal(contract.schemaStatus, 'pending-real-sample');
  assert.equal(contract.tokens.length, 0);
  assert.match(contract.blocker, /No legally obtained real Goalserve sample/);
});

test('match state mutation gate rejects direct and constant-propagated status writes', () => {
  const violations = matchStateMutationViolations([
    {
      path: 'v2/src/projections/direct.ts',
      source: "state.status = 'finished';"
    },
    {
      path: 'v2/src/api/spread.ts',
      source: "const changed = { ...snapshot, score: {}, status: 'live' };"
    },
    {
      path: 'v2/src/reconciliation/assign.ts',
      source: "Object.assign(value, { status: 'cancelled' });"
    },
    {
      path: 'v2/src/reconciliation/computed.ts',
      source: `
        const first = 'sta';
        const second = 'tus';
        state[first + second] = 'finished';
      `
    },
    {
      path: 'v2/src/reconciliation/reflect.ts',
      source: `
        const key = 'sta' + 'tus';
        Reflect.set(state, key, 'live');
      `
    },
    {
      path: 'v2/src/reconciliation/define.ts',
      source: `
        const key = 'sta' + 'tus';
        Object.defineProperty(state, key, { value: 'live' });
      `
    },
    {
      path: 'v2/src/reconciliation/defines.ts',
      source: `
        const key = 'status';
        Object.defineProperties(state, {
          [key]: { value: 'live' }
        });
      `
    },
    {
      path: 'v2/src/reconciliation/reflect-define.ts',
      source: `
        const key = 'sta' + 'tus';
        Reflect.defineProperty(state, key, { value: 'live' });
      `
    },
    {
      path: 'v2/src/reconciliation/delete.ts',
      source: `
        const key = 'status';
        delete state[key];
        Reflect.deleteProperty(otherState, key);
      `
    }
  ], stateMutationAllowlist.allowedFiles);
  assert.deepEqual(violations.map(item => item.kind).sort(), [
    'delete-status',
    'object-assign-status',
    'object-define-properties-status',
    'object-define-property-status',
    'property-assignment',
    'property-assignment',
    'reflect-define-property-status',
    'reflect-delete-property-status',
    'reflect-set',
    'spread-status-overwrite'
  ]);
});

test('match state gate allows ordinary dynamic map writes and non-status meta operations', () => {
  const files = [{
    path: 'v2/src/projections/map.ts',
    source: `
      out[key] = value;
      Reflect.set(out, key, value);
      Reflect.set(out, 'label', value);
      Object.defineProperty(out, 'label', { value });
      Object.defineProperties(out, { label: { value } });
      Reflect.defineProperty(out, 'label', { value });
      delete out.label;
      Reflect.deleteProperty(out, 'label');
    `
  }];
  assert.deepEqual(matchStateMutationViolations(files), []);
});

test('status brand type assertions are rejected outside the pure reducer allowlist', () => {
  const files = [
    {
      path: 'v2/src/adapters/shortcut.ts',
      source: "const status = raw as ReducedMatchStatus;"
    },
    {
      path: 'v2/src/projections/shortcut.ts',
      source: "const match = raw as CanonicalMatch;"
    },
    {
      path: 'v2/src/api/any-shortcut.ts',
      source: "const match: CanonicalMatch = { ...rest, status: 'live' as any };"
    }
  ];
  assert.equal(
    matchStatusAssertionViolations(files, stateMutationAllowlist.allowedFiles).length,
    3
  );
  assert.deepEqual(matchStatusAssertionViolations([{
    path: 'v2/src/domain/reduce-match.ts',
    source: "const status = value as ReducedMatchStatus;"
  }], stateMutationAllowlist.allowedFiles), []);
  assert.deepEqual(matchStatusAssertionViolations([{
    path: 'v2/src/domain/legitimate.ts',
    source: `
      const checked = value as unknown;
      const exhaustive = value as never;
    `
  }], stateMutationAllowlist.allowedFiles), []);
});

test('only the allowlisted pure reducer may construct a changed canonical match status', () => {
  const v2Root = path.join(serviceRoot, 'v2/src');
  const files = readCodeFiles(v2Root).map(file => ({
    ...file,
    path: `v2/src/${file.path}`
  }));
  assert.deepEqual(
    matchStateMutationViolations(files, stateMutationAllowlist.allowedFiles),
    []
  );
  assert.deepEqual(
    matchStatusAssertionViolations(files, stateMutationAllowlist.allowedFiles),
    []
  );
});

test('TypeScript rejects a plain canonical status while allowing ordinary DTO status reads', t => {
  const v2Root = path.join(serviceRoot, 'v2');
  const temporary = fs.mkdtempSync(path.join(v2Root, '.negative-type-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temporary, 'plain-status.mts'), `
    import type { CanonicalMatch } from '../src/domain/canonical.js';
    declare const rest: Omit<CanonicalMatch, 'status'>;
    const invalid: CanonicalMatch = { ...rest, status: 'live' };
    void invalid;
  `);
  const compiler = path.join(v2Root, 'node_modules/.bin/tsc');
  const result = spawnSync(compiler, [
    '--noEmit',
    '--strict',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    path.join(temporary, 'plain-status.mts')
  ], {
    cwd: v2Root,
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0, 'plain string status unexpectedly compiled');
  assert.match(`${result.stdout}${result.stderr}`, /ReducedMatchStatus/);

  fs.writeFileSync(path.join(temporary, 'dto-read.mts'), `
    import type { MatchStatus } from '../src/domain/canonical.js';
    import type { MatchCardDTO } from '../src/projections/read-models.js';
    export const readStatus = (dto: MatchCardDTO): MatchStatus => dto.status;
    export const readExplicitStatus = (dto: MatchCardDTO): MatchStatus => dto['status'];
  `);
  const dtoResult = spawnSync(compiler, [
    '--noEmit',
    '--strict',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    path.join(temporary, 'dto-read.mts')
  ], {
    cwd: v2Root,
    encoding: 'utf8'
  });
  assert.equal(dtoResult.status, 0, `${dtoResult.stdout}${dtoResult.stderr}`);
});

test('type-aware V2 gate rejects implicit JSON.parse any and explicit any', t => {
  const v2Root = path.join(serviceRoot, 'v2');
  const temporary = fs.mkdtempSync(path.join(v2Root, '.unsafe-type-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const unsafeFile = path.join(temporary, 'unsafe.mts');
  fs.writeFileSync(unsafeFile, `
    import type { CanonicalMatch } from '../src/domain/canonical.js';
    const changed: CanonicalMatch = JSON.parse('{}');
    const explicit: any = changed;
    export { changed, explicit };
  `);
  const violations = typeAwareSafetyViolations(
    path.join(v2Root, 'tsconfig.json'),
    [unsafeFile]
  );
  assert.equal(violations.some(item => item.kind === 'unsafe-assignment'
    && item.expression.includes('JSON.parse')), true);
  assert.equal(violations.some(item => item.kind === 'explicit-any'), true);
});

test('type-aware V2 gate rejects generic unknown assertions that forge CanonicalMatch', t => {
  const v2Root = path.join(serviceRoot, 'v2');
  const temporary = fs.mkdtempSync(path.join(v2Root, '.generic-cast-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const unsafeFile = path.join(temporary, 'generic-cast.mts');
  fs.writeFileSync(unsafeFile, `
    import type { CanonicalMatch } from '../src/domain/canonical.js';
    function unchecked<T>(value: unknown): T {
      return value as T;
    }
    function uncheckedJson<T>(): T {
      return JSON.parse('{}') as T;
    }
    const changed: CanonicalMatch = unchecked(JSON.parse('{}'));
    const changedAgain: CanonicalMatch = uncheckedJson();
    Object.defineProperty(changed, 'status', { value: 'live' });
    export { changed, changedAgain };
  `);
  const typeViolations = typeAwareSafetyViolations(
    path.join(v2Root, 'tsconfig.json'),
    [unsafeFile]
  );
  assert.equal(typeViolations.some(item =>
    item.kind === 'unsafe-unknown-assertion'
      && item.expression === 'value as T'), true);
  assert.equal(typeViolations.some(item =>
    item.kind === 'unsafe-any-assertion'
      && item.expression.includes("JSON.parse('{}') as T")), true);
  const source = fs.readFileSync(unsafeFile, 'utf8');
  assert.equal(matchStateMutationViolations([{
    path: 'v2/src/api/generic-cast.mts',
    source
  }]).some(item => item.kind === 'object-define-property-status'), true);
});

test('type-aware V2 gate allows unknown through a typed Zod-style parser and exhaustive never', t => {
  const v2Root = path.join(serviceRoot, 'v2');
  const temporary = fs.mkdtempSync(path.join(v2Root, '.safe-type-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const externalTypes = path.join(temporary, 'external.d.ts');
  fs.writeFileSync(externalTypes, `
    interface ExternalResponse {
      json(): Promise<any>;
    }
    declare const response: ExternalResponse;
  `);
  const safeFile = path.join(temporary, 'safe.mts');
  fs.writeFileSync(safeFile, `
    import type { CanonicalMatch } from '../src/domain/canonical.js';
    interface ZodStyleSchema<Output> {
      parse(input: unknown): Output;
    }
    declare const schema: ZodStyleSchema<CanonicalMatch>;
    const raw: unknown = JSON.parse('{}');
    export const parsed: CanonicalMatch = schema.parse(raw);
    export const directToUnknownParameter: CanonicalMatch =
      schema.parse(JSON.parse('{}'));
    export const preserved = raw as unknown;
    export const exhaustive = (value: never): never => value as never;
    export const parseResponse = async (): Promise<CanonicalMatch> => {
      const responseRaw: unknown = await response.json();
      return schema.parse(responseRaw);
    };
  `);
  assert.deepEqual(
    typeAwareSafetyViolations(
      path.join(v2Root, 'tsconfig.json'),
      [externalTypes, safeFile]
    ),
    []
  );
});

test('checked-in V2 contracts contain no explicit or implicit unsafe any flow', () => {
  assert.deepEqual(
    typeAwareSafetyViolations(path.join(serviceRoot, 'v2/tsconfig.json')),
    []
  );
});

test('V2 forbids TypeScript error-suppression directives', () => {
  const negative = compilerSuppressionViolations([{
    path: 'v2/src/api/bypass.ts',
    source: `
      // @ts-ignore
      const first = unsafe;
      /* @ts-expect-error */
      const second = unsafe;
      // @ts-nocheck
    `
  }]);
  assert.deepEqual(negative.map(item => item.kind).sort(), [
    'ts-expect-error',
    'ts-ignore',
    'ts-nocheck'
  ]);
  assert.deepEqual(compilerSuppressionViolations([{
    path: 'v2/src/domain/documented.ts',
    source: `
      // @ts-check is not a suppression.
      const value = input as unknown;
      const exhaustive = input as never;
    `
  }]), []);
  const v2Files = readCodeFiles(path.join(serviceRoot, 'v2/src')).map(file => ({
    ...file,
    path: `v2/src/${file.path}`
  }));
  assert.deepEqual(compilerSuppressionViolations(v2Files), []);
});
