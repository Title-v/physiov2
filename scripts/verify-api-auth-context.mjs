import authContext from '../shared/api/handlers/auth-context.js';

const { createRequireAuth, requireRole } = authContext;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function apiErrorImpl(res, status, error, detail) {
  return res.status(status).json(detail ? { error, detail } : { error });
}

{
  const req = { headers: {} };
  const res = createRes();
  let nextCalled = false;
  const requireAuth = createRequireAuth({
    supabaseClient: () => ({ auth: { getUser: async () => ({ data: {} }) } }),
    fetchProfile: async () => ({}),
    apiErrorImpl,
  });

  await requireAuth(req, res, () => { nextCalled = true; });
  check('missing bearer is unauthorized', res.statusCode === 401 && res.body.error === 'unauthorized' && !nextCalled);
}

{
  const req = { headers: { authorization: 'Bearer bad-token' } };
  const res = createRes();
  let nextCalled = false;
  const requireAuth = createRequireAuth({
    supabaseClient: () => ({ auth: { getUser: async () => ({ error: new Error('invalid') }) } }),
    fetchProfile: async () => ({}),
    apiErrorImpl,
  });

  await requireAuth(req, res, () => { nextCalled = true; });
  check('supabase auth error is unauthorized', res.statusCode === 401 && res.body.error === 'unauthorized' && !nextCalled);
}

{
  const clients = [];
  const req = { headers: { authorization: 'Bearer good-token' } };
  const res = createRes();
  let nextCalled = false;
  const requireAuth = createRequireAuth({
    supabaseClient: (options = {}) => {
      clients.push(options);
      return { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@example.com' } } }) } };
    },
    fetchProfile: async (authUser, token) => ({ id: authUser.id, role: token === 'good-token' ? 'therapist' : 'patient' }),
    serviceRoleAvailable: true,
    apiErrorImpl,
  });

  await requireAuth(req, res, () => { nextCalled = true; });
  check(
    'valid token sets auth context',
    nextCalled &&
      req.auth.token === 'good-token' &&
      req.auth.authUser.id === 'u1' &&
      req.auth.user.role === 'therapist' &&
      req.auth.db &&
      clients.length === 2 &&
      clients[1].admin === true &&
      clients[1].token === 'good-token',
  );
}

{
  const req = { headers: { authorization: 'Bearer throws' } };
  const res = createRes();
  let nextCalled = false;
  const requireAuth = createRequireAuth({
    supabaseClient: () => ({ auth: { getUser: async () => { throw new Error('network down'); } } }),
    fetchProfile: async () => ({}),
    apiErrorImpl,
  });

  await requireAuth(req, res, () => { nextCalled = true; });
  check('thrown auth error becomes supabase error', res.statusCode === 500 && res.body.error === 'supabase_error' && res.body.detail === 'network down' && !nextCalled);
}

{
  const req = { auth: { user: { role: 'patient' } } };
  const res = createRes();
  let nextCalled = false;
  requireRole('therapist', apiErrorImpl)(req, res, () => { nextCalled = true; });
  check('role mismatch is forbidden', res.statusCode === 403 && res.body.error === 'forbidden' && !nextCalled);
}

{
  const req = { auth: { user: { role: 'therapist' } } };
  const res = createRes();
  let nextCalled = false;
  requireRole('therapist', apiErrorImpl)(req, res, () => { nextCalled = true; });
  check('role match calls next', nextCalled && res.statusCode == null);
}

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
