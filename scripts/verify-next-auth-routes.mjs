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

try {
  const register = await import('../src/app/auth/register/route.js');
  const resend = await import('../src/app/auth/resend-verification/route.js');
  const login = await import('../src/app/auth/login/route.js');
  const me = await import('../src/app/auth/me/route.js');

  const registerResult = await readJson(await register.POST(new Request('http://localhost/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Patient', email: 'p@example.com', password: 'pw' }),
  })));
  check('register route handles missing supabase env', registerResult.status === 500 && registerResult.body.error === 'supabase_not_configured');

  const resendResult = await readJson(await resend.POST(new Request('http://localhost/auth/resend-verification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'p@example.com' }),
  })));
  check('resend route handles missing supabase env', resendResult.status === 500 && resendResult.body.error === 'supabase_not_configured');

  const loginResult = await readJson(await login.POST(new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'p@example.com', password: 'pw' }),
  })));
  check('login route handles missing supabase env', loginResult.status === 500 && loginResult.body.error === 'supabase_not_configured');

  const meResult = await readJson(await me.GET(new Request('http://localhost/auth/me', {
    method: 'GET',
    headers: { authorization: 'Bearer token' },
  })));
  check('me route handles missing supabase env', meResult.status === 500 && meResult.body.error === 'supabase_not_configured');
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
