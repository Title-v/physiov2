import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createSupabaseRuntime,
  loadDotEnvLocal,
  supabaseConfig,
} from './supabase.js';

const require = createRequire(import.meta.url);

export function createNotConfiguredRuntime(env = process.env) {
  const config = supabaseConfig(env);
  return {
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    TABLES: config.tables,
    supabaseReady: () => false,
    supabaseClient: () => {
      throw new Error('Supabase is not configured');
    },
  };
}

export function createSupabaseRuntimeFromEnv({ createClient, env = process.env } = {}) {
  if (env === process.env && env.PHYSIOAI_SKIP_DOTENV !== '1') {
    loadDotEnvLocal(path.join(process.cwd(), '.env.local'), env);
  }
  const config = supabaseConfig(env);
  if (!config.url || !config.publishableKey) return createNotConfiguredRuntime(env);

  const clientFactory = createClient || require('@supabase/supabase-js').createClient;
  return createSupabaseRuntime({ createClient: clientFactory, env });
}

export default {
  createSupabaseRuntimeFromEnv,
};
