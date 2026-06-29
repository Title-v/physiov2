import dataRoutes from '../shared/api/handlers/data-routes.js';

const { createDataHandlers } = dataRoutes;

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

const rows = {
  therapist_patients: [
    { therapist_id: 't1', patient_id: 'p1', linked_at: '2026-01-02T00:00:00.000Z' },
  ],
  profiles: [
    { id: 'p1', name: 'Patient One', email: 'p1@example.com', role: 'patient' },
  ],
  plans: [
    { patient_id: 'p1', data: { items: [{ exerciseId: 'shoulder' }], updatedAt: 1 } },
  ],
  references: [
    { patient_id: 'p1', exercise_id: 'shoulder', data: { score: 88 } },
  ],
  sessions: [
    {
      id: 's1',
      patient_id: 'p1',
      exercise_id: 'shoulder',
      ended_at: '2026-01-01T00:00:00.000Z',
      data: { reps: 5 },
    },
  ],
};

function matchFilters(row, filters) {
  return filters.every((filter) => {
    if (filter.type === 'eq') return row[filter.column] === filter.value;
    if (filter.type === 'in') return filter.values.includes(row[filter.column]);
    return true;
  });
}

function createBuilder(table, calls) {
  const state = { table, filters: [], op: 'select', payload: null, options: null };
  const builder = {
    select() {
      state.op = state.op || 'select';
      return builder;
    },
    eq(column, value) {
      state.filters.push({ type: 'eq', column, value });
      return builder;
    },
    in(column, values) {
      state.filters.push({ type: 'in', column, values });
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    upsert(payload, options) {
      state.op = 'upsert';
      state.payload = payload;
      state.options = options;
      calls.push({ table, op: 'upsert', payload, options });
      return builder;
    },
    insert(payload) {
      state.op = 'insert';
      state.payload = payload;
      calls.push({ table, op: 'insert', payload });
      return builder;
    },
    delete() {
      state.op = 'delete';
      calls.push({ table, op: 'delete' });
      return builder;
    },
    maybeSingle: async () => resolveOne(state),
    single: async () => resolveOne(state),
    then(resolve, reject) {
      return Promise.resolve(resolveMany(state)).then(resolve, reject);
    },
  };
  return builder;
}

function resolveMany(state) {
  if (state.op === 'upsert') {
    const payload = state.payload;
    if (state.table === 'plans') return { data: { ...payload }, error: null };
    if (state.table === 'references') return { data: { ...payload }, error: null };
    return { data: payload, error: null };
  }
  if (state.op === 'insert') {
    return { data: { ...state.payload }, error: null };
  }
  if (state.op === 'delete') return { data: null, error: null };
  return { data: (rows[state.table] || []).filter((row) => matchFilters(row, state.filters)), error: null };
}

function resolveOne(state) {
  if (state.op === 'upsert' || state.op === 'insert') return resolveMany(state);
  const data = (rows[state.table] || []).find((row) => matchFilters(row, state.filters)) || null;
  return { data, error: null };
}

function createDb(calls = []) {
  return {
    calls,
    from(table) {
      return createBuilder(table, calls);
    },
  };
}

function createHandlers({ ready = true, serviceRole = '' } = {}) {
  const calls = [];
  const db = createDb(calls);
  const handlers = createDataHandlers({
    supabaseReady: () => ready,
    supabaseClient: () => db,
    TABLES: {
      profiles: 'profiles',
      therapistPatients: 'therapist_patients',
      plans: 'plans',
      references: 'references',
      sessions: 'sessions',
    },
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  });
  return { calls, db, handlers };
}

const therapistReq = (body = {}, query = {}) => ({
  body,
  query,
  auth: {
    user: { id: 't1', role: 'therapist' },
    db: createDb(),
  },
});

const patientReq = (body = {}, query = {}) => ({
  body,
  query,
  auth: {
    user: { id: 'p1', role: 'patient' },
    db: createDb(),
  },
});

{
  const { handlers } = createHandlers({ ready: false });
  const result = await handlers.listPatients(therapistReq());
  check('list patients rejects missing supabase', result.status === 500 && result.body.error === 'supabase_not_configured');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.listPatients(patientReq());
  check('list patients requires therapist', result.status === 403 && result.body.error === 'forbidden');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.listPatients(therapistReq());
  check('list patients returns linked profiles', result.status === 200 && result.body[0].id === 'p1');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.linkPatient(therapistReq({ patientId: 'p2' }));
  check('link patient by id works without service role', result.status === 201 && result.body.id === 'p2');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.createPatient(therapistReq({}));
  check('create patient validates required fields', result.status === 400 && result.body.error === 'required');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.getPlan(patientReq());
  check('get own plan returns plan document', result.status === 200 && result.body.patientId === 'p1' && result.body.items.length === 1);
}

{
  const { handlers } = createHandlers();
  const result = await handlers.putPlan(patientReq({ items: [{ exerciseId: 'knee' }] }));
  check('put plan upserts clean plan', result.status === 200 && result.body.patientId === 'p1' && result.body.items[0].exerciseId === 'knee');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.postReference(patientReq({}));
  check('post reference requires exercise id', result.status === 400 && result.body.error === 'required');
}

{
  const { handlers } = createHandlers();
  const result = await handlers.getReferences(patientReq());
  check('get references maps rows', result.status === 200 && result.body[0].exerciseId === 'shoulder' && result.body[0].score === 88);
}

{
  const { handlers } = createHandlers();
  const result = await handlers.deleteReference(patientReq({}, { exerciseId: 'shoulder' }));
  check('delete reference returns no content', result.status === 204 && result.body == null);
}

{
  const { handlers } = createHandlers();
  const result = await handlers.getSessions(patientReq());
  check('get sessions maps rows', result.status === 200 && result.body[0].id === 's1' && result.body[0].reps === 5);
}

{
  const { handlers } = createHandlers();
  const result = await handlers.postSession(patientReq({ exerciseId: 'shoulder', reps: 6, endedAt: 0 }));
  check('post session inserts and maps row', result.status === 201 && result.body.patientId === 'p1' && result.body.reps === 6);
}

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
