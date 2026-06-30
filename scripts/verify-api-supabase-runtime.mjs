import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import runtime from '../shared/api/runtime/supabase.js';

const {
  createSupabaseRuntime,
  loadDotEnvLocal,
  supabaseConfig,
} = runtime;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_PROFILES_TABLE: 'app_profiles',
};

const config = supabaseConfig(env);
check('config reads url and keys', config.url === env.SUPABASE_URL && config.publishableKey === 'publishable' && config.serviceRoleKey === 'service');
check('config applies table defaults', config.tables.profiles === 'app_profiles' && config.tables.sessions === 'sessions' && config.tables.datasets === 'motion_datasets' && config.tables.aiModels === 'ai_models');

const createdClients = [];
const supabase = createSupabaseRuntime({
  env,
  createClient: (url, key, options) => {
    createdClients.push({ url, key, options });
    return { url, key, options };
  },
});

check('runtime ready with url and publishable key', supabase.supabaseReady() === true);
check('runtime exposes tables', supabase.TABLES.profiles === 'app_profiles' && supabase.TABLES.therapistPatients === 'therapist_patients');

const anon = supabase.supabaseClient();
check('client uses publishable key by default', anon.key === 'publishable' && createdClients[0].options.global.headers.Authorization == null);

const user = supabase.supabaseClient({ token: 'user-token' });
check('client attaches bearer token', user.key === 'publishable' && createdClients[1].options.global.headers.Authorization === 'Bearer user-token');

const admin = supabase.supabaseClient({ token: 'admin-token', admin: true });
check('admin client uses service key when available', admin.key === 'service' && createdClients[2].options.global.headers.Authorization === 'Bearer admin-token');

const missing = createSupabaseRuntime({ env: {}, createClient: () => ({}) });
check('runtime not ready without env', missing.supabaseReady() === false);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'physioai-env-'));
const envPath = path.join(tmpDir, '.env.local');
fs.writeFileSync(envPath, [
  '# comment',
  'SUPABASE_URL="https://dotenv.supabase.co"',
  "SUPABASE_PUBLISHABLE_KEY='dotenv-key'",
  'EMPTY_LINE_TEST=ok',
].join('\n'));
const loadedEnv = { SUPABASE_URL: 'preexisting' };
check('dotenv file loads', loadDotEnvLocal(envPath, loadedEnv) === true);
check('dotenv preserves existing keys', loadedEnv.SUPABASE_URL === 'preexisting');
check('dotenv strips quotes for new keys', loadedEnv.SUPABASE_PUBLISHABLE_KEY === 'dotenv-key' && loadedEnv.EMPTY_LINE_TEST === 'ok');

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
