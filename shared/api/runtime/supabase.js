import fs from 'node:fs';

export function readEnvValue(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function loadDotEnvLocal(envPath, env = process.env) {
  if (!envPath || !fs.existsSync(envPath)) return false;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = readEnvValue(trimmed.slice(eq + 1));
    if (key && env[key] == null) env[key] = value;
  }
  return true;
}

export function supabaseConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.REACT_APP_SUPABASE_URL,
    publishableKey:
      env.SUPABASE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.REACT_APP_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    tables: {
      profiles: env.SUPABASE_PROFILES_TABLE || 'profiles',
      therapistPatients: env.SUPABASE_THERAPIST_PATIENTS_TABLE || 'therapist_patients',
      plans: env.SUPABASE_PLANS_TABLE || 'plans',
      references: env.SUPABASE_REFERENCES_TABLE || 'references',
      sessions: env.SUPABASE_SESSIONS_TABLE || 'sessions',
      datasets: env.SUPABASE_DATASETS_TABLE || 'motion_datasets',
      aiModels: env.SUPABASE_AI_MODELS_TABLE || 'ai_models',
    },
  };
}

export function createSupabaseRuntime({ createClient, env = process.env } = {}) {
  if (typeof createClient !== 'function') {
    throw new TypeError('createSupabaseRuntime requires createClient');
  }

  const config = supabaseConfig(env);

  function supabaseReady() {
    return !!config.url && !!config.publishableKey;
  }

  function supabaseClient({ token, admin = false } = {}) {
    const key = admin && config.serviceRoleKey
      ? config.serviceRoleKey
      : config.publishableKey;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return createClient(config.url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: { headers },
    });
  }

  return {
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    TABLES: config.tables,
    supabaseReady,
    supabaseClient,
  };
}

export default {
  createSupabaseRuntime,
  loadDotEnvLocal,
  supabaseConfig,
};
