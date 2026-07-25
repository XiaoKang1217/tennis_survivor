import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '../../..');
const ALLOWED_METHODS = new Set(['get_fixtures', 'get_livescore']);

function fail(message) {
  process.stderr.write(`API Tennis capture refused: ${message}\n`);
  process.exit(1);
}

function argumentsByName(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      fail(`invalid argument near ${name || '(end)'}`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

const args = argumentsByName(process.argv.slice(2));
for (const name of ['method', 'output']) {
  if (!args[name]) fail(`--${name} is required`);
}
if (!ALLOWED_METHODS.has(args.method)) {
  fail(`--method must be one of: ${[...ALLOWED_METHODS].join(', ')}`);
}
if (!process.env.API_TENNIS_KEY) fail('API_TENNIS_KEY is not set');
if (args.method === 'get_fixtures' && (!args['date-start'] || !args['date-stop'])) {
  fail('get_fixtures requires --date-start and --date-stop');
}
for (const key of Object.keys(args)) {
  if (!['method', 'output', 'date-start', 'date-stop', 'timezone'].includes(key)) {
    fail(`unsupported argument --${key}`);
  }
}
for (const name of ['date-start', 'date-stop']) {
  if (args[name] && !/^\d{4}-\d{2}-\d{2}$/.test(args[name])) {
    fail(`--${name} must use YYYY-MM-DD`);
  }
}
if (args.timezone && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(args.timezone)) {
  fail('--timezone is invalid');
}

const output = path.resolve(args.output);
if (!path.isAbsolute(args.output)) fail('--output must be absolute');
if (output === repositoryRoot || output.startsWith(`${repositoryRoot}${path.sep}`)) {
  fail('--output must be outside the repository');
}
if (fs.existsSync(output)) fail('--output already exists');
if (!fs.existsSync(path.dirname(output))) fail('--output parent directory does not exist');

const base = process.env.API_TENNIS_BASE || 'https://api.api-tennis.com/tennis/';
let endpoint;
try {
  endpoint = new URL(base);
} catch {
  fail('API_TENNIS_BASE is invalid');
}
if (endpoint.protocol !== 'https:') fail('API_TENNIS_BASE must use HTTPS');
if (endpoint.hostname !== 'api.api-tennis.com'
  || endpoint.port
  || endpoint.username
  || endpoint.password) {
  fail('API_TENNIS_BASE host must be exactly api.api-tennis.com with no credentials or custom port');
}
endpoint.searchParams.set('method', args.method);
endpoint.searchParams.set('APIkey', process.env.API_TENNIS_KEY);
if (args['date-start']) endpoint.searchParams.set('date_start', args['date-start']);
if (args['date-stop']) endpoint.searchParams.set('date_stop', args['date-stop']);
if (args.timezone) endpoint.searchParams.set('timezone', args.timezone);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
let response;
try {
  response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: controller.signal
  });
} catch {
  clearTimeout(timeout);
  fail(`request failed for allowlisted method ${args.method}`);
}
clearTimeout(timeout);

const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length === 0) fail(`provider returned an empty body with HTTP ${response.status}`);
try {
  JSON.parse(bytes.toString('utf8'));
} catch {
  fail(`provider returned non-JSON content with HTTP ${response.status}`);
}
if (bytes.includes(Buffer.from(process.env.API_TENNIS_KEY))) {
  fail('response unexpectedly contains the API key');
}

fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
process.stdout.write(
  `Captured API Tennis method ${args.method} with HTTP ${response.status} to ${output}; no URL or credentials were logged.\n`
);
