export function createPatientAccess({
  supabaseClient,
  TABLES,
  SUPABASE_SERVICE_ROLE_KEY = '',
}) {
  if (typeof supabaseClient !== 'function') {
    throw new TypeError('createPatientAccess requires supabaseClient');
  }
  if (!TABLES?.therapistPatients) {
    throw new TypeError('createPatientAccess requires TABLES.therapistPatients');
  }

  function serverDb(req) {
    return SUPABASE_SERVICE_ROLE_KEY ? supabaseClient({ admin: true }) : req.auth.db;
  }

  async function linkPatientToTherapist(db, therapistId, patient) {
    const { error: linkError } = await db
      .from(TABLES.therapistPatients)
      .upsert({
        therapist_id: therapistId,
        patient_id: patient.id,
        linked_at: new Date().toISOString(),
      }, { onConflict: 'therapist_id,patient_id' });
    if (linkError) throw linkError;
    return { id: patient.id, name: patient.name, email: patient.email };
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

  return {
    canAccessPatient,
    linkPatientToTherapist,
    serverDb,
  };
}

export default {
  createPatientAccess,
};
