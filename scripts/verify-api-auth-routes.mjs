import authRoutes from '../shared/api/handlers/auth-routes.js';

const { createAuthHandlers } = authRoutes;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

function createHandlers({
  ready = true,
  serviceRole = '',
  allowTherapistRegistration = false,
  signInResult,
  signUpResult,
  createUserResult,
  resendResult,
  profile = { id: 'u1', name: 'Patient', email: 'p@example.com', role: 'patient' },
} = {}) {
  const calls = [];
  const supabaseClient = (options = {}) => {
    calls.push(options);
    return {
      auth: {
        admin: {
          createUser: async (payload) => {
            calls.push({ createUser: payload });
            return createUserResult || { data: { user: { id: 'u1', email: payload.email } } };
          },
        },
        signInWithPassword: async (payload) => {
          calls.push({ signInWithPassword: payload });
          return signInResult || {
            data: {
              user: { id: 'u1', email: payload.email },
              session: { access_token: 'token-1' },
            },
          };
        },
        signUp: async (payload) => {
          calls.push({ signUp: payload });
          return signUpResult || {
            data: {
              user: { id: 'u1', email: payload.email },
              session: { access_token: 'token-1' },
            },
          };
        },
        resend: async (payload) => {
          calls.push({ resend: payload });
          return resendResult || {};
        },
      },
      from: (table) => ({
        upsert: async (payload, options) => {
          calls.push({ table, upsert: payload, options });
          return {};
        },
      }),
    };
  };

  return {
    calls,
    handlers: createAuthHandlers({
      supabaseReady: () => ready,
      supabaseClient,
      TABLES: { profiles: 'profiles' },
      SUPABASE_SERVICE_ROLE_KEY: serviceRole,
      ALLOW_THERAPIST_REGISTRATION: allowTherapistRegistration,
      fetchProfile: async () => profile,
    }),
  };
}

{
  const { handlers } = createHandlers({ ready: false });
  const result = await handlers.login({ body: { email: 'p@example.com', password: 'pw' }, headers: {} });
  check('login rejects when supabase missing', result.status === 500 && result.body.error === 'supabase_not_configured');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.login({ body: {}, headers: {} });
  check('login validates required fields', result.status === 400 && result.body.error === 'required');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.login({ body: { email: 'P@Example.com', password: 'pw' }, headers: {} });
  check('login returns token and user', result.status === 200 && result.body.token === 'token-1' && result.body.user.role === 'patient');
}

{
  const { handlers } = createHandlers({
    signInResult: { error: new Error('Invalid login credentials') },
  });
  const result = await handlers.login({ body: { email: 'p@example.com', password: 'bad' }, headers: {} });
  check('login normalizes invalid credentials', result.status === 401 && result.body.error === 'invalid');
}

{
  const { handlers, calls } = createHandlers();
  const result = await handlers.register({
    body: { name: 'Patient', email: 'p@example.com', password: 'pw', role: 'patient' },
    headers: { origin: 'https://app.example.com' },
  });
  const signUp = calls.find((call) => call.signUp);
  check('register without service role signs up and logs in', result.status === 200 && result.body.token === 'token-1');
  check('register sign-up metadata does not include role', signUp?.signUp?.options?.data?.name === 'Patient' && !('role' in signUp.signUp.options.data));
}

{
  const { handlers } = createHandlers({
    signUpResult: { data: { user: { id: 'u1', email: 'p@example.com' }, session: null } },
  });
  const result = await handlers.register({
    body: { name: 'Patient', email: 'p@example.com', password: 'pw' },
    headers: { origin: 'https://app.example.com' },
  });
  check('register reports email confirmation when no session', result.status === 409 && result.body.error === 'email_confirmation_required');
}

{
  const { handlers, calls } = createHandlers({ serviceRole: 'service-key' });
  const result = await handlers.register({
    body: { name: 'Therapist', email: 't@example.com', password: 'pw', role: 'therapist' },
    headers: {},
  });
  check('therapist self-register is disabled by default', result.status === 403 && result.body.error === 'forbidden' && !calls.some((call) => call.createUser));
}

{
  const { handlers, calls } = createHandlers({ serviceRole: 'service-key', allowTherapistRegistration: true });
  const result = await handlers.register({
    body: { name: 'Therapist', email: 't@example.com', password: 'pw', role: 'therapist' },
    headers: {},
  });
  check('therapist register requires explicit enablement', result.status === 200 && calls.some((call) => call.createUser?.email_confirm === true));
  check('therapist role is written only to profile row', calls.some((call) => call.upsert?.role === 'therapist') && calls.every((call) => !call.createUser?.user_metadata?.role));
}

{
  const { handlers } = createHandlers();
  const result = await handlers.resendVerification({
    body: { email: 'p@example.com' },
    headers: { origin: 'https://app.example.com' },
  });
  check('resend verification succeeds', result.status === 200 && result.body.ok === true);
}

{
  const { handlers } = createHandlers();
  const result = handlers.me({ auth: { user: { id: 'u1' } } });
  check('me returns auth user', result.status === 200 && result.body.user.id === 'u1');
}

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
