import { normalizeAuthError } from './core.js';
import { authEmailRedirectTo } from './request.js';
import { errorResult, jsonResult } from './result.js';

export function createAuthHandlers({
  supabaseReady,
  supabaseClient,
  TABLES,
  SUPABASE_SERVICE_ROLE_KEY = '',
  fetchProfile,
}) {
  if (typeof supabaseReady !== 'function') {
    throw new TypeError('createAuthHandlers requires supabaseReady');
  }
  if (typeof supabaseClient !== 'function') {
    throw new TypeError('createAuthHandlers requires supabaseClient');
  }
  if (typeof fetchProfile !== 'function') {
    throw new TypeError('createAuthHandlers requires fetchProfile');
  }

  function requireSupabaseResult() {
    return supabaseReady() ? null : errorResult(500, 'supabase_not_configured');
  }

  async function register(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const role = req.body?.role === 'therapist' ? 'therapist' : 'patient';
    if (!email || !password || !name) return errorResult(400, 'required');

    try {
      let authUser = null;
      if (SUPABASE_SERVICE_ROLE_KEY) {
        const admin = supabaseClient({ admin: true });
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name, role },
        });
        if (created.error) return errorResult(400, normalizeAuthError(created.error), created.error.message);
        authUser = created.data.user;
        await admin.from(TABLES.profiles).upsert({ id: authUser.id, name, email, role }, { onConflict: 'id' });
      } else {
        const signed = await supabaseClient().auth.signUp({
          email,
          password,
          options: { data: { name, role }, emailRedirectTo: authEmailRedirectTo(req) },
        });
        if (signed.error) return errorResult(400, normalizeAuthError(signed.error), signed.error.message);
        authUser = signed.data.user;
        if (!signed.data.session?.access_token) {
          return errorResult(409, 'email_confirmation_required');
        }
      }

      const login = await supabaseClient().auth.signInWithPassword({ email, password });
      if (login.error || !login.data.session?.access_token) {
        return errorResult(401, normalizeAuthError(login.error), login.error?.message);
      }
      const user = await fetchProfile(login.data.user || authUser, login.data.session.access_token);
      return jsonResult({ token: login.data.session.access_token, user });
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
  }

  async function resendVerification(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return errorResult(400, 'required');

    try {
      const { error } = await supabaseClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: authEmailRedirectTo(req) },
      });
      if (error) return errorResult(400, normalizeAuthError(error), error.message);
      return jsonResult({ ok: true });
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
  }

  async function login(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return errorResult(400, 'required');

    try {
      const { data, error } = await supabaseClient().auth.signInWithPassword({ email, password });
      if (error || !data?.session?.access_token || !data?.user) {
        return errorResult(401, normalizeAuthError(error), error?.message);
      }
      const user = await fetchProfile(data.user, data.session.access_token);
      return jsonResult({ token: data.session.access_token, user });
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
  }

  function me(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    return jsonResult({ user: req.auth.user });
  }

  return {
    login,
    me,
    register,
    resendVerification,
  };
}

export default {
  createAuthHandlers,
};
