import fs from 'node:fs';
import path from 'node:path';
import { API_ENDPOINTS, endpointKey } from '../shared/api/contracts.mjs';
import { NEXT_API_ROUTES } from '../shared/api/next-route-manifest.mjs';

const repoRoot = process.cwd();
const contractKeys = new Set(API_ENDPOINTS.map(endpointKey));
const methodExport = {
  DELETE: 'DELETE',
  GET: 'GET',
  PATCH: 'PATCH',
  POST: 'POST',
  PUT: 'PUT',
};

const checks = [];
function check(name, pass, detail = undefined) {
  checks.push({ name, pass: !!pass, detail });
}

for (const route of NEXT_API_ROUTES) {
  const key = endpointKey(route);
  const routePath = path.join(repoRoot, route.file);
  const source = fs.existsSync(routePath) ? fs.readFileSync(routePath, 'utf8') : '';
  check(`contract contains ${key}`, contractKeys.has(key), route);
  check(`route file exists for ${key}`, fs.existsSync(routePath), route.file);
  check(
    `route exports ${route.method} for ${key}`,
    new RegExp(`export\\s+async\\s+function\\s+${methodExport[route.method] || route.method}\\b`).test(source),
    route.file,
  );
}

check('at least one Next route is tracked', NEXT_API_ROUTES.length > 0);

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  routeCount: NEXT_API_ROUTES.length,
  routes: NEXT_API_ROUTES.map(endpointKey),
}, null, 2));
