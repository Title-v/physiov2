const savedEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  REACT_APP_SUPABASE_URL: process.env.REACT_APP_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  REACT_APP_SUPABASE_PUBLISHABLE_KEY: process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY,
  PHYSIOAI_SKIP_DOTENV: process.env.PHYSIOAI_SKIP_DOTENV,
};

for (const key of Object.keys(savedEnv)) delete process.env[key];
process.env.PHYSIOAI_SKIP_DOTENV = '1';

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

async function readJson(response) {
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function expectNotConfigured(name, responsePromise) {
  const result = await readJson(await responsePromise);
  check(name, result.status === 500 && result.body.error === 'supabase_not_configured');
}

try {
  const patients = await import('../src/app/patients/route.js');
  const patientsLink = await import('../src/app/patients/link/route.js');
  const plans = await import('../src/app/plans/route.js');
  const references = await import('../src/app/references/route.js');
  const sessions = await import('../src/app/sessions/route.js');

  const authHeaders = { authorization: 'Bearer token', 'content-type': 'application/json' };
  await expectNotConfigured('patients GET handles missing env', patients.GET(new Request('http://localhost/patients', { headers: authHeaders })));
  await expectNotConfigured('patients POST handles missing env', patients.POST(new Request('http://localhost/patients', { method: 'POST', headers: authHeaders, body: '{}' })));
  await expectNotConfigured('patients link POST handles missing env', patientsLink.POST(new Request('http://localhost/patients/link', { method: 'POST', headers: authHeaders, body: '{}' })));
  await expectNotConfigured('plans GET handles missing env', plans.GET(new Request('http://localhost/plans', { headers: authHeaders })));
  await expectNotConfigured('plans PUT handles missing env', plans.PUT(new Request('http://localhost/plans', { method: 'PUT', headers: authHeaders, body: '{}' })));
  await expectNotConfigured('references GET handles missing env', references.GET(new Request('http://localhost/references', { headers: authHeaders })));
  await expectNotConfigured('references POST handles missing env', references.POST(new Request('http://localhost/references', { method: 'POST', headers: authHeaders, body: '{}' })));
  await expectNotConfigured('references DELETE handles missing env', references.DELETE(new Request('http://localhost/references?exerciseId=shoulder', { method: 'DELETE', headers: authHeaders })));
  await expectNotConfigured('sessions GET handles missing env', sessions.GET(new Request('http://localhost/sessions', { headers: authHeaders })));
  await expectNotConfigured('sessions POST handles missing env', sessions.POST(new Request('http://localhost/sessions', { method: 'POST', headers: authHeaders, body: '{}' })));
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
