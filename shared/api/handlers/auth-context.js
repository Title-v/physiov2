import { apiError } from './core.js';
import { bearerToken } from './request.js';
import { errorResult } from './result.js';

export function validateAuthContextDeps({ supabaseClient, fetchProfile }) {
  if (typeof supabaseClient !== 'function') {
    throw new TypeError('auth context requires supabaseClient');
  }
  if (typeof fetchProfile !== 'function') {
    throw new TypeError('auth context requires fetchProfile');
  }
}

export async function resolveAuthContext(req, {
  supabaseClient,
  fetchProfile,
  serviceRoleAvailable = false,
}) {
  validateAuthContextDeps({ supabaseClient, fetchProfile });

  try {
    const token = bearerToken(req);
    if (!token) return { ok: false, result: errorResult(401, 'unauthorized') };

    const { data, error } = await supabaseClient().auth.getUser(token);
    if (error || !data?.user) return { ok: false, result: errorResult(401, 'unauthorized') };

    return {
      ok: true,
      auth: {
        token,
        authUser: data.user,
        user: await fetchProfile(data.user, token),
        db: supabaseClient({ token, admin: !!serviceRoleAvailable }),
      },
    };
  } catch (error) {
    return { ok: false, result: errorResult(500, 'supabase_error', error.message) };
  }
}

export function createRequireAuth({
  supabaseClient,
  fetchProfile,
  serviceRoleAvailable = false,
  apiErrorImpl = apiError,
}) {
  validateAuthContextDeps({ supabaseClient, fetchProfile });
  return async function requireAuth(req, res, next) {
    const context = await resolveAuthContext(req, {
      supabaseClient,
      fetchProfile,
      serviceRoleAvailable,
    });
    if (!context.ok) {
      return apiErrorImpl(res, context.result.status, context.result.body.error, context.result.body.detail);
    }
    req.auth = context.auth;
    next();
  };
}

export function requireRole(role, apiErrorImpl = apiError) {
  return (req, res, next) => {
    if (req.auth?.user?.role !== role) return apiErrorImpl(res, 403, 'forbidden');
    next();
  };
}

export default {
  createRequireAuth,
  requireRole,
  resolveAuthContext,
};
