import authContext from '../../shared/api/handlers/auth-context.js';
import dataRoutes from '../../shared/api/handlers/data-routes.js';
import profiles from '../../shared/api/handlers/profiles.js';
import results from '../../shared/api/handlers/result.js';
import nextAdapter from '../../shared/api/next-adapter.js';
import nextRuntime from '../../shared/api/runtime/next.js';

const { resolveAuthContext } = authContext;
const { createDataHandlers } = dataRoutes;
const { createFetchProfile } = profiles;
const { errorResult } = results;
const { nextRequestToApiRequest, resultToNextResponse } = nextAdapter;
const { createSupabaseRuntimeFromEnv } = nextRuntime;

function createApiDeps() {
  const runtime = createSupabaseRuntimeFromEnv();
  const fetchProfile = createFetchProfile({
    supabaseClient: runtime.supabaseClient,
    TABLES: runtime.TABLES,
    serviceRoleAvailable: !!runtime.SUPABASE_SERVICE_ROLE_KEY,
  });
  return { fetchProfile, runtime };
}

export async function runAuthenticatedDataHandler(request, handlerName) {
  const req = await nextRequestToApiRequest(request);
  const { fetchProfile, runtime } = createApiDeps();
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
  const handlers = createDataHandlers(runtime);
  return resultToNextResponse(await handlers[handlerName](req));
}
