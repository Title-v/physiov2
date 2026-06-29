import {
  cleanPlan,
  isoFromEpochMs,
  normalizeAuthError,
  planFromRow,
  referenceFromRow,
  sessionFromRow,
} from './core.js';
import { authEmailRedirectTo, targetPatientId } from './request.js';
import { errorResult, jsonResult, noContentResult } from './result.js';
import { createPatientAccess } from './patient-access.js';
import {
  validateCreatePatientPayload,
  validateDeleteReferencePayload,
  validatePatientLookupPayload,
  validatePlanPayload,
  validateReferencePayload,
  validateSessionPayload,
} from './payload-validation.js';

function validationErrorResult(validation) {
  const required = validation.issues?.some((item) => item.endsWith(':required'));
  return errorResult(400, required ? 'required' : 'invalid_payload', validation.issues?.join(','));
}

export function createDataHandlers({
  supabaseReady,
  supabaseClient,
  TABLES,
  SUPABASE_SERVICE_ROLE_KEY = '',
}) {
  if (typeof supabaseReady !== 'function') {
    throw new TypeError('createDataHandlers requires supabaseReady');
  }
  if (typeof supabaseClient !== 'function') {
    throw new TypeError('createDataHandlers requires supabaseClient');
  }
  if (!TABLES) {
    throw new TypeError('createDataHandlers requires TABLES');
  }

  const {
    canAccessPatient,
    linkPatientToTherapist,
    serverDb,
  } = createPatientAccess({ supabaseClient, TABLES, SUPABASE_SERVICE_ROLE_KEY });

  function requireSupabaseResult() {
    return supabaseReady() ? null : errorResult(500, 'supabase_not_configured');
  }

  function requireTherapist(req) {
    return req.auth?.user?.role === 'therapist' ? null : errorResult(403, 'forbidden');
  }

  async function listPatients(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const notTherapist = requireTherapist(req);
    if (notTherapist) return notTherapist;

    const db = serverDb(req);
    const { data: links, error } = await db
      .from(TABLES.therapistPatients)
      .select('patient_id,linked_at')
      .eq('therapist_id', req.auth.user.id)
      .order('linked_at', { ascending: false });
    if (error) return errorResult(500, 'supabase_error', error.message);

    const patientIds = [...new Set((links || []).map((row) => row.patient_id).filter(Boolean))];
    if (!patientIds.length) return jsonResult([]);

    const { data: profiles, error: profileError } = await db
      .from(TABLES.profiles)
      .select('id,name,email')
      .eq('role', 'patient')
      .in('id', patientIds);
    if (profileError) return errorResult(500, 'supabase_error', profileError.message);

    const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return jsonResult(patientIds.map((id) => byId.get(id)).filter(Boolean));
  }

  async function linkPatient(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const notTherapist = requireTherapist(req);
    if (notTherapist) return notTherapist;

    const validation = validatePatientLookupPayload(req.body);
    if (!validation.ok) return validationErrorResult(validation);
    const { patientId, email } = validation.value;
    if (email && !SUPABASE_SERVICE_ROLE_KEY) return errorResult(500, 'service_role_required');

    const admin = serverDb(req);
    let patient = null;
    if (SUPABASE_SERVICE_ROLE_KEY || email) {
      let query = admin
        .from(TABLES.profiles)
        .select('id,name,email,role')
        .eq('role', 'patient')
        .limit(1);
      query = patientId ? query.eq('id', patientId) : query.eq('email', email);

      const { data, error } = await query.maybeSingle();
      if (error && error.code !== 'PGRST116') return errorResult(500, 'supabase_error', error.message);
      if (!data) return errorResult(404, 'not_found');
      patient = data;
    } else {
      patient = { id: patientId, name: 'Patient', email: '' };
    }

    try {
      await linkPatientToTherapist(admin, req.auth.user.id, patient);
      const { data: linked } = await admin
        .from(TABLES.profiles)
        .select('id,name,email,role')
        .eq('id', patient.id)
        .eq('role', 'patient')
        .maybeSingle();
      return jsonResult(linked ? { id: linked.id, name: linked.name, email: linked.email } : patient, 201);
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
  }

  async function createPatient(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const notTherapist = requireTherapist(req);
    if (notTherapist) return notTherapist;

    const validation = validateCreatePatientPayload(req.body);
    if (!validation.ok) return validationErrorResult(validation);
    const { email, password, name } = validation.value;

    const admin = serverDb(req);
    try {
      if (SUPABASE_SERVICE_ROLE_KEY) {
        const { data: existing, error: lookupError } = await admin
          .from(TABLES.profiles)
          .select('id,name,email,role')
          .eq('email', email)
          .limit(1)
          .maybeSingle();
        if (lookupError && lookupError.code !== 'PGRST116') return errorResult(500, 'supabase_error', lookupError.message);
        if (existing) {
          if (existing.role !== 'patient') return errorResult(409, 'email_used_by_non_patient');
          return jsonResult(await linkPatientToTherapist(admin, req.auth.user.id, existing), 201);
        }

        const created = await supabaseClient({ admin: true }).auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        });
        if (created.error) return errorResult(400, normalizeAuthError(created.error), created.error.message);

        const patient = { id: created.data.user.id, name, email, role: 'patient' };
        const { error: profileError } = await admin
          .from(TABLES.profiles)
          .upsert(patient, { onConflict: 'id' });
        if (profileError) return errorResult(500, 'supabase_error', profileError.message);

        return jsonResult(await linkPatientToTherapist(admin, req.auth.user.id, patient), 201);
      }

      const signed = await supabaseClient().auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: authEmailRedirectTo(req) },
      });
      if (signed.error) return errorResult(400, normalizeAuthError(signed.error), signed.error.message);
      const authUser = signed.data.user;
      if (!authUser?.id) return errorResult(500, 'supabase_error', 'Missing created user id');

      const patient = { id: authUser.id, name, email, verificationRequired: !signed.data.session?.access_token };
      await linkPatientToTherapist(req.auth.db, req.auth.user.id, patient);
      return jsonResult(patient, 201);
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
  }

  async function getPlan(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const { data, error } = await req.auth.db
      .from(TABLES.plans)
      .select('*')
      .eq('patient_id', patientId)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') return errorResult(500, 'supabase_error', error.message);
    return jsonResult(planFromRow(data));
  }

  async function putPlan(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const validation = validatePlanPayload(req.body, patientId);
    if (!validation.ok) return validationErrorResult(validation);
    const plan = cleanPlan(validation.value, patientId);
    const { data, error } = await req.auth.db
      .from(TABLES.plans)
      .upsert({
        patient_id: patientId,
        data: plan,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'patient_id' })
      .select()
      .single();
    if (error) return errorResult(500, 'supabase_error', error.message);
    return jsonResult(planFromRow(data));
  }

  async function getReferences(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const { data, error } = await req.auth.db
      .from(TABLES.references)
      .select('*')
      .eq('patient_id', patientId);
    if (error) return errorResult(500, 'supabase_error', error.message);
    return jsonResult((data || []).map(referenceFromRow));
  }

  async function postReference(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    const validation = validateReferencePayload(req.body);
    if (!validation.ok) return validationErrorResult(validation);
    const { exerciseId } = validation.value;
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
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
    if (error) return errorResult(500, 'supabase_error', error.message);
    return jsonResult(referenceFromRow(data));
  }

  async function deleteReference(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    const validation = validateDeleteReferencePayload({ query: req.query, body: req.body });
    if (!validation.ok) return validationErrorResult(validation);
    const { exerciseId } = validation.value;
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const { error } = await req.auth.db
      .from(TABLES.references)
      .delete()
      .eq('patient_id', patientId)
      .eq('exercise_id', exerciseId);
    if (error) return errorResult(500, 'supabase_error', error.message);
    return noContentResult();
  }

  async function getSessions(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const { data, error } = await req.auth.db
      .from(TABLES.sessions)
      .select('*')
      .eq('patient_id', patientId)
      .order('ended_at', { ascending: false });
    if (error) return errorResult(500, 'supabase_error', error.message);
    return jsonResult((data || []).map(sessionFromRow));
  }

  async function postSession(req) {
    const notReady = requireSupabaseResult();
    if (notReady) return notReady;
    const patientId = targetPatientId(req);
    try {
      if (!(await canAccessPatient(req, patientId))) return errorResult(403, 'forbidden');
    } catch (error) {
      return errorResult(500, 'supabase_error', error.message);
    }
    const validation = validateSessionPayload(req.body);
    if (!validation.ok) return validationErrorResult(validation);
    const endedAt = req.body?.endedAt || Date.now();
    const session = { ...req.body, patientId, endedAt };
    const id = req.body?.id || `s_${patientId}_${endedAt}`;
    const { data, error } = await req.auth.db
      .from(TABLES.sessions)
      .insert({
        id,
        patient_id: patientId,
        exercise_id: req.body?.exerciseId || req.body?.exerciseKey || null,
        ended_at: isoFromEpochMs(endedAt),
        data: session,
      })
      .select()
      .single();
    if (error) return errorResult(500, 'supabase_error', error.message);
    return jsonResult(sessionFromRow(data), 201);
  }

  return {
    createPatient,
    deleteReference,
    getPlan,
    getReferences,
    getSessions,
    linkPatient,
    listPatients,
    postReference,
    postSession,
    putPlan,
  };
}

export default {
  createDataHandlers,
};
