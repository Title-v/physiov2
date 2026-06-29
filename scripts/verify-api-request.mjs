import request from '../shared/api/handlers/request.js';

const {
  authEmailRedirectTo,
  bearerToken,
  requestOrigin,
  targetPatientId,
} = request;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

check('bearer token extracts token', bearerToken({ headers: { authorization: 'Bearer abc.def' } }) === 'abc.def');
check('bearer token ignores missing', bearerToken({ headers: {} }) === null);
check('bearer token is case insensitive', bearerToken({ headers: { authorization: 'bearer token' } }) === 'token');

check('target patient query wins', targetPatientId({
  query: { patientId: 'query-p' },
  body: { patientId: 'body-p' },
  auth: { user: { id: 'auth-p' } },
}) === 'query-p');
check('target patient body fallback', targetPatientId({
  query: {},
  body: { patientId: 'body-p' },
  auth: { user: { id: 'auth-p' } },
}) === 'body-p');
check('target patient auth fallback', targetPatientId({
  query: {},
  body: {},
  auth: { user: { id: 'auth-p' } },
}) === 'auth-p');

check('origin header wins and trims slash', requestOrigin({
  headers: { origin: 'https://app.example.com/' },
}) === 'https://app.example.com');
check('forwarded origin fallback', requestOrigin({
  protocol: 'http',
  headers: {
    'x-forwarded-proto': 'https, http',
    'x-forwarded-host': 'api.example.com, proxy',
  },
}) === 'https://api.example.com');
check('host fallback', requestOrigin({
  protocol: 'http',
  headers: { host: 'localhost:3000' },
}) === 'http://localhost:3000');
check('auth redirect explicit wins', authEmailRedirectTo({}, 'https://override.example.com/callback') === 'https://override.example.com/callback');
check('auth redirect from origin', authEmailRedirectTo({
  headers: { origin: 'https://app.example.com' },
}) === 'https://app.example.com/therapist/capture');

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
