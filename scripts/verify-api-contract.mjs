import { API_ENDPOINTS, endpointKey } from '../shared/api/contracts.mjs';
import { NEXT_API_ROUTES } from '../shared/api/next-route-manifest.mjs';

const expectedKeys = API_ENDPOINTS.map(endpointKey);
const expected = new Set(expectedKeys);
const actualKeys = NEXT_API_ROUTES.map(endpointKey);
const actual = new Set(actualKeys);
const duplicateContractKeys = expectedKeys
  .filter((key, index) => expectedKeys.indexOf(key) !== index)
  .sort();
const duplicateNextKeys = actualKeys
  .filter((key, index) => actualKeys.indexOf(key) !== index)
  .sort();
const missing = [...expected].filter((key) => !actual.has(key)).sort();
const extra = [...actual].filter((key) => !expected.has(key)).sort();

if (duplicateContractKeys.length || duplicateNextKeys.length || missing.length || extra.length) {
  console.error(JSON.stringify({
    ok: false,
    duplicateContractKeys,
    duplicateNextKeys,
    missing,
    extra,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  endpointCount: expected.size,
  endpoints: [...expected].sort(),
}, null, 2));
