import authContext from '../../../shared/api/handlers/auth-context.js';
import authRoutes from '../../../shared/api/handlers/auth-routes.js';
import profiles from '../../../shared/api/handlers/profiles.js';
import results from '../../../shared/api/handlers/result.js';
import nextAdapter from '../../../shared/api/next-adapter.js';
import nextRuntime from '../../../shared/api/runtime/next.js';

const { resolveAuthContext } = authContext;
const { createAuthHandlers } = authRoutes;
const { createFetchProfile } = profiles;
const { errorResult } = results;
const { nextRequestToApiRequest, resultToNextResponse } = nextAdapter;
const { createSupabaseRuntimeFromEnv } = nextRuntime;

function createAuthDeps() {
  const runtime = createSupabaseRuntimeFromEnv();
  const fetchProfile = createFetchProfile({
    supabaseClient: runtime.supabaseClient,
    TABLES: runtime.TABLES,
    serviceRoleAvailable: !!runtime.SUPABASE_SERVICE_ROLE_KEY,
  });
  const authHandlers = createAuthHandlers({
    ...runtime,
    ALLOW_THERAPIST_REGISTRATION: ['1', 'true', 'yes', 'on'].includes(String(process.env.PHYSIOAI_ALLOW_THERAPIST_REGISTRATION || '').toLowerCase()),
    fetchProfile,
  });
  return { authHandlers, fetchProfile, runtime };
}

export async function runPublicAuthHandler(request, handlerName) {
  const req = await nextRequestToApiRequest(request);
  const { authHandlers } = createAuthDeps();
  return resultToNextResponse(await authHandlers[handlerName](req));
}

export async function runAuthMeHandler(request) {
  const req = await nextRequestToApiRequest(request);
  const { authHandlers, fetchProfile, runtime } = createAuthDeps();
  if (!runtime.supabaseReady()) {
    return resultToNextResponse(errorResult(500, 'supabase_not_configured'));
  }

  const context = await resolveAuthContext(req, {
    supabaseClient: runtime.supabaseClient,
    fetchProfile,
    serviceRoleAvailable: !!runtime.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!context.ok) return resultToNextResponse(context.result);
  req.auth = context.auth;
  return resultToNextResponse(authHandlers.me(req));
}
