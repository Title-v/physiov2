export function apiErrorBody(error, detail, env = process.env.NODE_ENV) {
  const body = { error };
  if (detail && env !== 'production') body.detail = detail;
  return body;
}

export function apiError(res, status, error, detail) {
  return res.status(status).json(apiErrorBody(error, detail));
}

export function normalizeAuthError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) return 'exists';
  if (msg.includes('invalid') || msg.includes('credentials') || msg.includes('password')) return 'invalid';
  if (msg.includes('confirm')) return 'email_confirmation_required';
  return 'supabase_error';
}

export function publicUser(authUser, profile) {
  const meta = authUser?.user_metadata || {};
  return {
    id: profile?.id || authUser?.id,
    name: profile?.name || meta.name || authUser?.email?.split('@')[0] || 'User',
    email: profile?.email || authUser?.email || '',
    role: profile?.role || 'patient',
  };
}

export function cleanPlan(plan, patientId) {
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

export function planFromRow(row) {
  if (!row) return null;
  return cleanPlan(row.data || row, row.patient_id || row.patientId);
}

export function referenceFromRow(row) {
  return { exerciseId: row.exercise_id, ...(row.data || {}) };
}

export function sessionFromRow(row) {
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

export function datasetFromRow(row) {
  const data = row.data || {};
  return {
    id: row.id || data.id,
    patientId: row.patient_id || data.patientId || null,
    therapistId: row.therapist_id || data.therapistId || null,
    exerciseId: row.exercise_id || data.exerciseId,
    landmarkSchemaId: row.landmark_schema_id || data.landmarkSchemaId,
    labelStatus: row.label_status || data.labelStatus,
    dataQuality: row.data_quality || data.dataQuality,
    trainable: row.trainable ?? data.trainable,
    ...data,
    createdAt: data.createdAt || row.created_at || null,
  };
}

export function aiModelFromRow(row) {
  const data = row.data || {};
  return {
    id: row.id || data.id || data.modelId,
    therapistId: row.therapist_id || data.therapistId || null,
    exerciseId: row.exercise_id || data.exerciseId || null,
    landmarkSchemaId: row.landmark_schema_id || data.landmarkSchemaId,
    version: row.version || data.version,
    approved: row.approved ?? data.approved === true,
    ...data,
    updatedAt: data.updatedAt || row.updated_at || null,
    createdAt: data.createdAt || row.created_at || null,
  };
}

export function isoFromEpochMs(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return new Date(n).toISOString();
  const d = new Date(value || Date.now());
  return Number.isFinite(Number(d)) ? d.toISOString() : new Date().toISOString();
}

export default {
  apiError,
  apiErrorBody,
  cleanPlan,
  isoFromEpochMs,
  normalizeAuthError,
  aiModelFromRow,
  planFromRow,
  publicUser,
  datasetFromRow,
  referenceFromRow,
  sessionFromRow,
};
