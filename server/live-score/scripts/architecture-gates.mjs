import fs from 'node:fs';
import path from 'node:path';
import ts from '../v2/node_modules/typescript/lib/typescript.js';

export const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx'
]);

function scriptKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS;
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function parse(filePath, source) {
  return ts.createSourceFile(
    filePath || 'module.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath)
  );
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

function collectConstInitializers(sourceFile) {
  const candidates = new Map();
  const duplicates = new Set();
  visit(sourceFile, node => {
    if (!ts.isVariableDeclaration(node)
      || !ts.isIdentifier(node.name)
      || !node.initializer
      || !ts.isVariableDeclarationList(node.parent)
      || !(node.parent.flags & ts.NodeFlags.Const)) {
      return;
    }
    if (candidates.has(node.name.text)) duplicates.add(node.name.text);
    candidates.set(node.name.text, node.initializer);
  });
  for (const duplicate of duplicates) candidates.delete(duplicate);
  return candidates;
}

function constantString(node, constants = new Map(), seen = new Set()) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression, constants, seen);
  if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
    return constantString(
      constants.get(node.text),
      constants,
      new Set(seen).add(node.text)
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left, constants, seen);
    const right = constantString(node.right, constants, seen);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantString(span.expression, constants, seen);
      if (expression === undefined) return undefined;
      value += expression + span.literal.text;
    }
    return value;
  }
  return undefined;
}

function propertyName(node, constants = new Map()) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    return constantString(node.argumentExpression, constants);
  }
  return undefined;
}

function objectHasStatusProperty(node, constants = new Map()) {
  return ts.isObjectLiteralExpression(node)
    && node.properties.some(property => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return false;
      }
      if (ts.isComputedPropertyName(property.name)) {
        return constantString(property.name.expression, constants) === 'status';
      }
      return property.name.getText().replace(/^['"]|['"]$/g, '') === 'status';
    });
}

export function walkCodeFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkCodeFiles(absolute));
    if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push(absolute);
    }
  }
  return result.sort();
}

export function extractModuleSpecifiers(source, filePath = 'module.ts') {
  const specifiers = new Set();
  const sourceFile = parse(filePath, source);
  const constants = collectConstInitializers(sourceFile);
  visit(sourceFile, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const value = constantString(node.arguments[0], constants);
        if (value !== undefined) specifiers.add(value);
      }
    }
  });
  return [...specifiers];
}

function dynamicModuleLoadKind(node) {
  if (!ts.isCallExpression(node)) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic-import';
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return 'require';
  return undefined;
}

export function nonStaticModuleLoadViolations(files) {
  const violations = [];
  for (const file of files) {
    const sourceFile = parse(file.path, file.source);
    const constants = collectConstInitializers(sourceFile);
    visit(sourceFile, node => {
      if (ts.isIdentifier(node)
        && node.text === 'require'
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        violations.push({
          file: file.path,
          kind: 'require-reference',
          expression: node.getText()
        });
        return;
      }
      const kind = dynamicModuleLoadKind(node);
      if (!kind) return;
      if (node.arguments.length !== 1
        || constantString(node.arguments[0], constants) === undefined) {
        violations.push({
          file: file.path,
          kind,
          expression: node.getText()
        });
      }
    });
  }
  return violations;
}

const PROHIBITED_DOMAIN_SEGMENT =
  /(?:^|[/@._-])(?:adapters?|api|http|database|db|persistence|projections?|ui)(?:[/._-]|$)/i;
const PROHIBITED_DOMAIN_PACKAGES = new Set([
  'axios',
  'express',
  'fastify',
  'ioredis',
  'pg',
  'postgres',
  'redis',
  'undici',
  'node:http',
  'node:https',
  'node:net',
  'node:tls'
]);

function prohibitedSpecifier(specifier) {
  const normalized = specifier.toLowerCase().replaceAll('\\', '/');
  const packageRoot = normalized.startsWith('@')
    ? normalized.split('/').slice(0, 2).join('/')
    : normalized.split('/')[0];
  return PROHIBITED_DOMAIN_SEGMENT.test(normalized)
    || PROHIBITED_DOMAIN_PACKAGES.has(normalized)
    || PROHIBITED_DOMAIN_PACKAGES.has(packageRoot);
}

export function domainDependencyViolations(files) {
  const violations = nonStaticModuleLoadViolations(files).map(item => ({
    ...item,
    specifier: '<non-static-module-load>'
  }));
  for (const file of files) {
    for (const specifier of extractModuleSpecifiers(file.source, file.path)) {
      if (prohibitedSpecifier(specifier)) violations.push({ file: file.path, specifier });
    }
  }
  return violations;
}

function resolveLocalModule(importer, specifier, filesByPath) {
  if (!specifier.startsWith('.')) return undefined;
  const unresolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const extension = path.posix.extname(unresolved);
  const stem = extension ? unresolved.slice(0, -extension.length) : unresolved;
  const candidates = [
    unresolved,
    ...[...CODE_EXTENSIONS].map(candidateExtension => `${stem}${candidateExtension}`),
    ...[...CODE_EXTENSIONS].map(candidateExtension =>
      path.posix.join(unresolved, `index${candidateExtension}`))
  ];
  return candidates.find(candidate => filesByPath.has(candidate));
}

export function transitiveDomainDependencyViolations(files, pureBareSpecifierAllowlist = []) {
  const normalizedFiles = files.map(file => ({
    ...file,
    path: file.path.split(path.sep).join('/')
  }));
  const filesByPath = new Map(normalizedFiles.map(file => [file.path, file]));
  const importsByPath = new Map(normalizedFiles.map(file => [
    file.path,
    extractModuleSpecifiers(file.source, file.path)
  ]));
  const dynamicLoadsByPath = new Map(normalizedFiles.map(file => [
    file.path,
    nonStaticModuleLoadViolations([file])
  ]));
  const violations = [];
  const allowedBareSpecifiers = new Set(pureBareSpecifierAllowlist);

  function traverse(current, chain, visited) {
    if (visited.has(current)) return;
    const nextVisited = new Set(visited).add(current);
    for (const dynamicLoad of dynamicLoadsByPath.get(current) || []) {
      violations.push({
        file: chain[0],
        chain: [...chain, `<${dynamicLoad.kind}:non-static>`]
      });
    }
    for (const specifier of importsByPath.get(current) || []) {
      const target = resolveLocalModule(current, specifier, filesByPath);
      if (!target) {
        if (prohibitedSpecifier(specifier)
          || (!specifier.startsWith('.') && !allowedBareSpecifiers.has(specifier))) {
          violations.push({ file: chain[0], chain: [...chain, specifier] });
        }
        continue;
      }
      const nextChain = [...chain, target];
      if (PROHIBITED_DOMAIN_SEGMENT.test(target)) {
        violations.push({ file: chain[0], chain: nextChain });
        continue;
      }
      traverse(target, nextChain, nextVisited);
    }
  }

  for (const file of normalizedFiles.filter(item => item.path.startsWith('domain/'))) {
    traverse(file.path, [file.path], new Set());
  }
  return violations;
}

function protectedAstViolations(file) {
  const violations = [];
  const kinds = new Set();
  visit(parse(file.path, file.source), node => {
    if (ts.isIdentifier(node)) {
      if (node.text === 'eval') kinds.add('eval');
      if (node.text === 'Function') kinds.add('Function-constructor');
      if (node.text === 'Proxy') kinds.add('Proxy');
    }
  });
  for (const kind of kinds) violations.push({ file: file.path, kind });
  return violations;
}

function sourceFieldCandidates(file) {
  const candidates = new Set();
  const sourceFile = parse(file.path, file.source);
  const constants = collectConstInitializers(sourceFile);
  visit(sourceFile, node => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) candidates.add(node.text);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = propertyName(node, constants);
      if (name !== undefined) candidates.add(name);
    }
    if (ts.isBinaryExpression(node)) {
      const value = constantString(node, constants);
      if (value !== undefined) candidates.add(value);
    }
    if (ts.isComputedPropertyName(node)) {
      const value = constantString(node.expression, constants);
      if (value !== undefined) candidates.add(value);
    }
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Reflect'
      && node.arguments.length >= 2) {
      const value = constantString(node.arguments[1], constants);
      if (value !== undefined) candidates.add(value);
    }
  });
  return candidates;
}

export function providerFieldViolations(files, registry) {
  const violations = files.flatMap(protectedAstViolations);
  for (const file of files) {
    const candidates = sourceFieldCandidates(file);
    for (const [provider, contract] of Object.entries(registry.providers || {})) {
      for (const token of contract.tokens || []) {
        if (candidates.has(token)
          || new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
            .test(file.source)) {
          violations.push({ file: file.path, provider, match: token, kind: 'token' });
        }
      }
      for (const expression of contract.patterns || []) {
        if (new RegExp(expression, 'i').test(file.source)) {
          violations.push({ file: file.path, provider, match: expression, kind: 'pattern' });
        }
      }
    }
  }
  return violations;
}

export function matchStateMutationViolations(files, allowedFiles = []) {
  const allowed = new Set(allowedFiles);
  const violations = [];
  for (const file of files) {
    const normalizedPath = file.path.split(path.sep).join('/');
    if (allowed.has(normalizedPath)) continue;
    const kinds = new Set();
    const sourceFile = parse(file.path, file.source);
    const constants = collectConstInitializers(sourceFile);
    visit(sourceFile, node => {
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
        const name = propertyName(node.left, constants);
        if (name === 'status') kinds.add('property-assignment');
      }
      if (ts.isObjectLiteralExpression(node)
        && node.properties.some(property => ts.isSpreadAssignment(property))
        && objectHasStatusProperty(node, constants)) {
        kinds.add('spread-status-overwrite');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Object'
        && node.expression.name.text === 'assign'
        && node.arguments.some((argument, index) =>
          index > 0 && objectHasStatusProperty(argument, constants))) {
        kinds.add('object-assign-status');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Reflect'
        && node.expression.name.text === 'set'
        && constantString(node.arguments[1], constants) === 'status') {
        kinds.add('reflect-set');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Object'
        && node.expression.name.text === 'defineProperty'
        && constantString(node.arguments[1], constants) === 'status') {
        kinds.add('object-define-property-status');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Object'
        && node.expression.name.text === 'defineProperties'
        && objectHasStatusProperty(node.arguments[1], constants)) {
        kinds.add('object-define-properties-status');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Reflect'
        && node.expression.name.text === 'defineProperty'
        && constantString(node.arguments[1], constants) === 'status') {
        kinds.add('reflect-define-property-status');
      }
      if (ts.isDeleteExpression(node)
        && (ts.isPropertyAccessExpression(node.expression)
          || ts.isElementAccessExpression(node.expression))
        && propertyName(node.expression, constants) === 'status') {
        kinds.add('delete-status');
      }
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Reflect'
        && node.expression.name.text === 'deleteProperty'
        && constantString(node.arguments[1], constants) === 'status') {
        kinds.add('reflect-delete-property-status');
      }
    });
    for (const kind of kinds) violations.push({ file: normalizedPath, kind });
  }
  return violations;
}

function isStatusBrandAssertion(node) {
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return false;
  const target = node.type.getText().replace(/\s+/g, '');
  if (target === 'any') return true;
  return target.includes('ReducedMatchStatus')
    || target.includes("CanonicalMatch['status']")
    || target.includes('CanonicalMatch["status"]')
    || target === 'CanonicalMatch'
    || target.endsWith('.CanonicalMatch');
}

export function matchStatusAssertionViolations(files, allowedFiles = []) {
  const allowed = new Set(allowedFiles);
  const violations = [];
  for (const file of files) {
    const normalizedPath = file.path.split(path.sep).join('/');
    if (allowed.has(normalizedPath)) continue;
    visit(parse(file.path, file.source), node => {
      if (isStatusBrandAssertion(node)) {
        violations.push({
          file: normalizedPath,
          kind: 'status-type-assertion',
          expression: node.getText()
        });
      }
    });
  }
  return violations;
}

export function compilerSuppressionViolations(files) {
  const violations = [];
  const suppression = /^\s*(?:\/\/|\/\*+|\*)[^\r\n]*@ts-(ignore|nocheck|expect-error)\b/gim;
  for (const file of files) {
    for (const match of file.source.matchAll(suppression)) {
      const line = file.source.slice(0, match.index).split(/\r?\n/).length;
      violations.push({
        file: file.path.split(path.sep).join('/'),
        line,
        kind: `ts-${match[1]}`
      });
    }
  }
  return violations;
}

function isAnyType(type) {
  return Boolean(type.flags & ts.TypeFlags.Any);
}

function isUnknownType(type) {
  return Boolean(type?.flags & ts.TypeFlags.Unknown);
}

/**
 * Type-aware safety gate equivalent to the no-explicit-any and no-unsafe-*
 * TypeScript ESLint family, without adding a second parser/toolchain to Phase 0.
 */
export function typeAwareSafetyViolations(tsconfigPath, extraRootNames = []) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return [{ file: tsconfigPath, kind: 'invalid-tsconfig', expression: '' }];
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath
  );
  const rootNames = [...new Set([
    ...parsed.fileNames,
    ...extraRootNames.map(file => path.resolve(file))
  ])];
  const program = ts.createProgram({ rootNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const roots = new Set(rootNames.map(file => path.resolve(file)));
  const violations = [];

  function add(sourceFile, node, kind) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      file: path.relative(path.dirname(tsconfigPath), sourceFile.fileName)
        .split(path.sep)
        .join('/'),
      line: position.line + 1,
      kind,
      expression: node.getText(sourceFile)
    });
  }

  function unsafeExpression(sourceFile, node, kind, targetType) {
    if (node
      && isAnyType(checker.getTypeAtLocation(node))
      && !isUnknownType(targetType)) {
      add(sourceFile, node, kind);
    }
  }

  function enclosingFunction(node) {
    let current = node.parent;
    while (current) {
      if (ts.isFunctionLike(current)) return current;
      current = current.parent;
    }
    return undefined;
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (!roots.has(path.resolve(sourceFile.fileName)) || sourceFile.isDeclarationFile) continue;
    visit(sourceFile, node => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        add(sourceFile, node, 'explicit-any');
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const sourceType = checker.getTypeAtLocation(node.expression);
        const targetType = checker.getTypeFromTypeNode(node.type);
        if ((isUnknownType(sourceType) || isAnyType(sourceType))
          && !isUnknownType(targetType)
          && !(targetType.flags & ts.TypeFlags.Never)) {
          add(
            sourceFile,
            node,
            isAnyType(sourceType) ? 'unsafe-any-assertion' : 'unsafe-unknown-assertion'
          );
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const targetType = node.type
          ? checker.getTypeFromTypeNode(node.type)
          : checker.getTypeAtLocation(node.name);
        unsafeExpression(sourceFile, node.initializer, 'unsafe-assignment', targetType);
      }
      if (ts.isPropertyAssignment(node)) {
        unsafeExpression(
          sourceFile,
          node.initializer,
          'unsafe-assignment',
          checker.getContextualType(node.initializer)
        );
      }
      if (ts.isBinaryExpression(node)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        unsafeExpression(
          sourceFile,
          node.right,
          'unsafe-assignment',
          checker.getTypeAtLocation(node.left)
        );
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        unsafeExpression(sourceFile, node.expression, 'unsafe-member-access');
      }
      if (ts.isCallExpression(node)) {
        unsafeExpression(sourceFile, node.expression, 'unsafe-call');
        const signature = checker.getResolvedSignature(node);
        for (const [index, argument] of node.arguments.entries()) {
          const parameter = signature?.parameters[
            Math.min(index, Math.max(0, signature.parameters.length - 1))
          ];
          const targetType = parameter
            ? checker.getTypeOfSymbolAtLocation(parameter, node)
            : undefined;
          unsafeExpression(sourceFile, argument, 'unsafe-argument', targetType);
        }
      }
      if (ts.isNewExpression(node)) {
        unsafeExpression(sourceFile, node.expression, 'unsafe-construction');
        const signature = checker.getResolvedSignature(node);
        for (const [index, argument] of (node.arguments || []).entries()) {
          const parameter = signature?.parameters[
            Math.min(index, Math.max(0, signature.parameters.length - 1))
          ];
          const targetType = parameter
            ? checker.getTypeOfSymbolAtLocation(parameter, node)
            : undefined;
          unsafeExpression(sourceFile, argument, 'unsafe-argument', targetType);
        }
      }
      if (ts.isReturnStatement(node) && node.expression) {
        const declaration = enclosingFunction(node);
        const signature = declaration
          ? checker.getSignatureFromDeclaration(declaration)
          : undefined;
        unsafeExpression(
          sourceFile,
          node.expression,
          'unsafe-return',
          signature ? checker.getReturnTypeOfSignature(signature) : undefined
        );
      }
      if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
        unsafeExpression(sourceFile, node.expression, 'unsafe-spread');
      }
    });
  }
  return violations;
}

export function readCodeFiles(root) {
  return walkCodeFiles(root).map(file => ({
    path: path.relative(root, file).split(path.sep).join('/'),
    source: fs.readFileSync(file, 'utf8')
  }));
}
