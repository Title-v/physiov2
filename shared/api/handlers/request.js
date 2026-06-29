export function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function targetPatientId(req) {
  return req.query.patientId || req.body?.patientId || req.auth.user.id;
}

export function requestOrigin(req) {
  const origin = req.headers.origin || '';
  if (/^https?:\/\//i.test(origin)) return origin.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

export function authEmailRedirectTo(req, explicit = process.env.SUPABASE_AUTH_REDIRECT_URL || '') {
  if (explicit) return explicit;
  const origin = requestOrigin(req);
  return origin ? `${origin}/therapist/capture` : undefined;
}

export default {
  authEmailRedirectTo,
  bearerToken,
  requestOrigin,
  targetPatientId,
};
