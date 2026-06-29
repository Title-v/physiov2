import { publicUser } from './core.js';

export function createFetchProfile({
  supabaseClient,
  TABLES,
  serviceRoleAvailable = false,
}) {
  if (typeof supabaseClient !== 'function') {
    throw new TypeError('createFetchProfile requires supabaseClient');
  }
  if (!TABLES?.profiles) {
    throw new TypeError('createFetchProfile requires TABLES.profiles');
  }

  return async function fetchProfile(authUser, token) {
    const db = supabaseClient({ token, admin: !!serviceRoleAvailable });
    const { data, error } = await db
      .from(TABLES.profiles)
      .select('id,name,email,role')
      .eq('id', authUser.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    if (data) return publicUser(authUser, data);

    const fallback = publicUser(authUser, null);
    if (serviceRoleAvailable) {
      await supabaseClient({ admin: true })
        .from(TABLES.profiles)
        .upsert(fallback, { onConflict: 'id' });
    }
    return fallback;
  };
}

export default {
  createFetchProfile,
};
