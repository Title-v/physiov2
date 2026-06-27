// PhysioAI · Therapist frontend + Supabase-backed API server.
//
// The browser app still needs a WASM-friendly CSP for MediaPipe. The same
// Express server now also exposes the old PhysioAI API contract, backed by
// Supabase Auth + Postgres tables.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

loadDotEnvLocal();

const app = express();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const TABLES = {
  profiles: process.env.SUPABASE_PROFILES_TABLE || 'profiles',
  therapistPatients: process.env.SUPABASE_THERAPIST_PATIENTS_TABLE || 'therapist_patients',
  plans: process.env.SUPABASE_PLANS_TABLE || 'plans',
  references: process.env.SUPABASE_REFERENCES_TABLE || 'references',
  sessions: process.env.SUPABASE_SESSIONS_TABLE || 'sessions',
};

function loadDotEnvLocal() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function supabaseReady() {
  return !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;
}

function supabaseClient({ token, admin = false } = {}) {
  const key = admin && SUPABASE_SERVICE_ROLE_KEY
    ? SUPABASE_SERVICE_ROLE_KEY
    : SUPABASE_PUBLISHABLE_KEY;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return createClient(SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers },
  });
}

function requireSupabase(_req, res, next) {
  if (!supabaseReady()) return apiError(res, 500, 'supabase_not_configured');
  next();
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function apiError(res, status, error, detail) {
  const body = { error };
  if (detail && process.env.NODE_ENV !== 'production') body.detail = detail;
  return res.status(status).json(body);
}

function normalizeAuthError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) return 'exists';
  if (msg.includes('invalid') || msg.includes('credentials') || msg.includes('password')) return 'invalid';
  if (msg.includes('confirm')) return 'email_confirmation_required';
  return 'supabase_error';
}

function publicUser(authUser, profile) {
  const meta = authUser?.user_metadata || {};
  return {
    id: profile?.id || authUser?.id,
    name: profile?.name || meta.name || authUser?.email?.split('@')[0] || 'User',
    email: profile?.email || authUser?.email || '',
    role: profile?.role || meta.role || 'patient',
  };
}

async function fetchProfile(authUser, token) {
  const db = supabaseClient({ token, admin: !!SUPABASE_SERVICE_ROLE_KEY });
  const { data, error } = await db
    .from(TABLES.profiles)
    .select('id,name,email,role')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (data) return publicUser(authUser, data);

  const fallback = publicUser(authUser, null);
  if (SUPABASE_SERVICE_ROLE_KEY) {
    await supabaseClient({ admin: true })
      .from(TABLES.profiles)
      .upsert(fallback, { onConflict: 'id' });
  }
  return fallback;
}

async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return apiError(res, 401, 'unauthorized');
    const { data, error } = await supabaseClient().auth.getUser(token);
    if (error || !data?.user) return apiError(res, 401, 'unauthorized');
    req.auth = {
      token,
      authUser: data.user,
      user: await fetchProfile(data.user, token),
      db: supabaseClient({ token, admin: !!SUPABASE_SERVICE_ROLE_KEY }),
    };
    next();
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.auth?.user?.role !== role) return apiError(res, 403, 'forbidden');
    next();
  };
}

function targetPatientId(req) {
  return req.query.patientId || req.body?.patientId || req.auth.user.id;
}

function requestOrigin(req) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function authEmailRedirectTo(req) {
  const explicit = process.env.SUPABASE_AUTH_REDIRECT_URL || '';
  if (explicit) return explicit;
  const origin = requestOrigin(req);
  return origin ? `${origin}/therapist/capture` : undefined;
}

function serverDb(req) {
  return SUPABASE_SERVICE_ROLE_KEY ? supabaseClient({ admin: true }) : req.auth.db;
}

async function canAccessPatient(req, patientId) {
  if (!patientId) return false;
  if (req.auth.user.id === patientId) return true;
  if (req.auth.user.role !== 'therapist') return false;

  const { data, error } = await serverDb(req)
    .from(TABLES.therapistPatients)
    .select('patient_id')
    .eq('therapist_id', req.auth.user.id)
    .eq('patient_id', patientId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

function cleanPlan(plan, patientId) {
  const p = plan || {};
  return {
    patientId,
    items: Array.isArray(p.items) ? p.items : [],
    freqPerDay: p.freqPerDay ?? 1,
    daysPerWeek: p.daysPerWeek ?? 7,
    durationDays: p.durationDays ?? (p.durationWeeks ? p.durationWeeks * 7 : 28),
    durationWeeks: p.durationWeeks ?? Math.max(1, Math.ceil((p.durationDays || 28) / 7)),
    startDate: p.startDate ?? null,
    notes: p.notes ?? '',
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

function planFromRow(row) {
  if (!row) return null;
  return cleanPlan(row.data || row, row.patient_id || row.patientId);
}

function referenceFromRow(row) {
  return { exerciseId: row.exercise_id, ...(row.data || {}) };
}

function sessionFromRow(row) {
  const data = row.data || {};
  const endedAt = data.endedAt ?? (row.ended_at ? Number(new Date(row.ended_at)) : Date.now());
  return {
    id: row.id || data.id,
    patientId: row.patient_id || data.patientId,
    exerciseId: row.exercise_id || data.exerciseId,
    ...data,
    endedAt,
  };
}

function isoFromEpochMs(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return new Date(n).toISOString();
  const d = new Date(value || Date.now());
  return Number.isFinite(Number(d)) ? d.toISOString() : new Date().toISOString();
}

// Security headers + CORS. The API uses bearer tokens, not cookies.
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob: https: *; " +
    "style-src 'self' 'unsafe-inline' https: *; " +
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https: *; " +
    "font-src 'self' data: https: *; " +
    "connect-src 'self' https: *; " +
    "media-src 'self' blob: https: *; " +
    "worker-src 'self' blob:; " +
    "object-src 'none'; frame-src 'self' https: *;"
  );
  next();
});

app.use(express.json({ limit: '8mb' }));

app.get('/health', (_req, res) => res.json({ name: 'PhysioAI Supabase Backend', status: 'ok' }));

app.post('/auth/register', requireSupabase, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();
  const role = req.body.role === 'therapist' ? 'therapist' : 'patient';
  if (!email || !password || !name) return apiError(res, 400, 'required');

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
      if (created.error) return apiError(res, 400, normalizeAuthError(created.error), created.error.message);
      authUser = created.data.user;
      await admin.from(TABLES.profiles).upsert({ id: authUser.id, name, email, role }, { onConflict: 'id' });
    } else {
      const signed = await supabaseClient().auth.signUp({
        email,
        password,
        options: { data: { name, role }, emailRedirectTo: authEmailRedirectTo(req) },
      });
      if (signed.error) return apiError(res, 400, normalizeAuthError(signed.error), signed.error.message);
      authUser = signed.data.user;
      if (!signed.data.session?.access_token) {
        return apiError(res, 409, 'email_confirmation_required');
      }
    }

    const login = await supabaseClient().auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session?.access_token) {
      return apiError(res, 401, normalizeAuthError(login.error), login.error?.message);
    }
    const user = await fetchProfile(login.data.user || authUser, login.data.session.access_token);
    return res.json({ token: login.data.session.access_token, user });
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
});

app.post('/auth/resend-verification', requireSupabase, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return apiError(res, 400, 'required');

  try {
    const { error } = await supabaseClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: authEmailRedirectTo(req) },
    });
    if (error) return apiError(res, 400, normalizeAuthError(error), error.message);
    return res.json({ ok: true });
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
});

app.post('/auth/login', requireSupabase, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return apiError(res, 400, 'required');

  try {
    const { data, error } = await supabaseClient().auth.signInWithPassword({ email, password });
    if (error || !data?.session?.access_token || !data?.user) {
      return apiError(res, 401, normalizeAuthError(error), error?.message);
    }
    const user = await fetchProfile(data.user, data.session.access_token);
    return res.json({ token: data.session.access_token, user });
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
});

app.get('/auth/me', requireSupabase, requireAuth, (req, res) => {
  res.json({ user: req.auth.user });
});

app.get('/patients', requireSupabase, requireAuth, requireRole('therapist'), async (req, res) => {
  const db = serverDb(req);
  const { data: links, error } = await db
    .from(TABLES.therapistPatients)
    .select('patient_id,linked_at')
    .eq('therapist_id', req.auth.user.id)
    .order('linked_at', { ascending: false });
  if (error) return apiError(res, 500, 'supabase_error', error.message);

  const patientIds = [...new Set((links || []).map((row) => row.patient_id).filter(Boolean))];
  if (!patientIds.length) return res.json([]);

  const { data: profiles, error: profileError } = await db
    .from(TABLES.profiles)
    .select('id,name,email')
    .eq('role', 'patient')
    .in('id', patientIds);
  if (profileError) return apiError(res, 500, 'supabase_error', profileError.message);

  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return res.json(patientIds.map((id) => byId.get(id)).filter(Boolean));
});

app.post('/patients/link', requireSupabase, requireAuth, requireRole('therapist'), async (req, res) => {
  if (!SUPABASE_SERVICE_ROLE_KEY) return apiError(res, 500, 'service_role_required');

  const patientId = String(req.body.patientId || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!patientId && !email) return apiError(res, 400, 'required');

  const admin = serverDb(req);
  let query = admin
    .from(TABLES.profiles)
    .select('id,name,email,role')
    .eq('role', 'patient')
    .limit(1);
  query = patientId ? query.eq('id', patientId) : query.eq('email', email);

  const { data: patient, error } = await query.maybeSingle();
  if (error && error.code !== 'PGRST116') return apiError(res, 500, 'supabase_error', error.message);
  if (!patient) return apiError(res, 404, 'not_found');

  const { error: linkError } = await admin
    .from(TABLES.therapistPatients)
    .upsert({
      therapist_id: req.auth.user.id,
      patient_id: patient.id,
      linked_at: new Date().toISOString(),
    }, { onConflict: 'therapist_id,patient_id' });
  if (linkError) return apiError(res, 500, 'supabase_error', linkError.message);

  return res.status(201).json({ id: patient.id, name: patient.name, email: patient.email });
});

app.get('/plans', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const { data, error } = await req.auth.db
    .from(TABLES.plans)
    .select('*')
    .eq('patient_id', patientId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') return apiError(res, 500, 'supabase_error', error.message);
  return res.json(planFromRow(data));
});

app.put('/plans', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const plan = cleanPlan(req.body, patientId);
  const { data, error } = await req.auth.db
    .from(TABLES.plans)
    .upsert({
      patient_id: patientId,
      data: plan,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'patient_id' })
    .select()
    .single();
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.json(planFromRow(data));
});

app.get('/references', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const { data, error } = await req.auth.db
    .from(TABLES.references)
    .select('*')
    .eq('patient_id', patientId);
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.json((data || []).map(referenceFromRow));
});

app.post('/references', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  const exerciseId = req.body.exerciseId;
  if (!exerciseId) return apiError(res, 400, 'required');
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const { patientId: _patientId, exerciseId: _exerciseId, ...reference } = req.body;
  const { data, error } = await req.auth.db
    .from(TABLES.references)
    .upsert({
      patient_id: patientId,
      exercise_id: exerciseId,
      data: reference,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'patient_id,exercise_id' })
    .select()
    .single();
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.json(referenceFromRow(data));
});

app.delete('/references', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  const exerciseId = req.query.exerciseId || req.body?.exerciseId;
  if (!exerciseId) return apiError(res, 400, 'required');
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const { error } = await req.auth.db
    .from(TABLES.references)
    .delete()
    .eq('patient_id', patientId)
    .eq('exercise_id', exerciseId);
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.status(204).send();
});

app.get('/sessions', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const { data, error } = await req.auth.db
    .from(TABLES.sessions)
    .select('*')
    .eq('patient_id', patientId)
    .order('ended_at', { ascending: false });
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.json((data || []).map(sessionFromRow));
});

app.post('/sessions', requireSupabase, requireAuth, async (req, res) => {
  const patientId = targetPatientId(req);
  try {
    if (!(await canAccessPatient(req, patientId))) return apiError(res, 403, 'forbidden');
  } catch (error) {
    return apiError(res, 500, 'supabase_error', error.message);
  }
  const endedAt = req.body.endedAt || Date.now();
  const session = { ...req.body, patientId, endedAt };
  const id = req.body.id || `s_${patientId}_${endedAt}`;
  const { data, error } = await req.auth.db
    .from(TABLES.sessions)
    .insert({
      id,
      patient_id: patientId,
      exercise_id: req.body.exerciseId || req.body.exerciseKey || null,
      ended_at: isoFromEpochMs(endedAt),
      data: session,
    })
    .select()
    .single();
  if (error) return apiError(res, 500, 'supabase_error', error.message);
  return res.status(201).json(sessionFromRow(data));
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

function start() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const mode = supabaseReady() ? 'Supabase API enabled' : 'Supabase API missing env';
    console.log(`PhysioAI Therapist server on :${port} (${mode})`);
  });
}

if (require.main === module) start();

module.exports = app;
module.exports.app = app;
module.exports.start = start;
