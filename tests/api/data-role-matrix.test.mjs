import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataHandlers } from '../../shared/api/handlers/data-routes.js';

const TABLES = {
  profiles: 'profiles',
  therapistPatients: 'therapist_patients',
  plans: 'plans',
  references: 'references',
  sessions: 'sessions',
};

const seedRows = {
  therapist_patients: [
    { therapist_id: 'therapist-1', patient_id: 'patient-1', linked_at: '2026-06-29T00:00:00.000Z' },
  ],
  profiles: [
    { id: 'patient-1', name: 'Linked Patient', email: 'p1@example.com', role: 'patient' },
    { id: 'patient-2', name: 'Unlinked Patient', email: 'p2@example.com', role: 'patient' },
    { id: 'therapist-1', name: 'Therapist', email: 't@example.com', role: 'therapist' },
  ],
  plans: [
    { patient_id: 'patient-1', data: { items: [{ exerciseId: 'shoulder' }] }, updated_at: '2026-06-29T00:00:00.000Z' },
    { patient_id: 'patient-2', data: { items: [{ exerciseId: 'knee' }] }, updated_at: '2026-06-29T00:00:00.000Z' },
  ],
  references: [
    { patient_id: 'patient-1', exercise_id: 'shoulder', data: { exerciseId: 'shoulder', kind: 'motion_cycle' } },
  ],
  sessions: [
    {
      id: 's1',
      patient_id: 'patient-1',
      exercise_id: 'shoulder',
      ended_at: '2026-06-29T00:00:00.000Z',
      data: { exerciseId: 'shoulder', score: 88 },
    },
  ],
};

function matchFilters(row, filters) {
  return filters.every((filter) => row[filter.column] === filter.value);
}

function cloneRows() {
  return Object.fromEntries(Object.entries(seedRows).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
}

function createBuilder(table, rows, calls) {
  const state = { table, filters: [], op: 'select', payload: null, options: null };
  const builder = {
    select() {
      return builder;
    },
    eq(column, value) {
      state.filters.push({ column, value });
      return builder;
    },
    in(column, values) {
      state.filters.push({ column, values, in: true });
      return builder;
    },
    order() {
      return Promise.resolve(resolveMany());
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
      calls.push({ table, op: 'delete', filters: state.filters });
      return builder;
    },
    maybeSingle: async () => ({ data: matchingRows()[0] || null, error: null }),
    single: async () => {
      const result = resolveMany();
      return { data: result.data, error: result.error };
    },
    then(resolve, reject) {
      return Promise.resolve(resolveMany()).then(resolve, reject);
    },
  };

  function matchingRows() {
    return (rows[table] || []).filter((row) => state.filters.every((filter) => {
      if (filter.in) return filter.values.includes(row[filter.column]);
      return row[filter.column] === filter.value;
    }));
  }

  function resolveMany() {
    if (state.op === 'upsert') {
      return { data: { ...state.payload }, error: null };
    }
    if (state.op === 'insert') {
      return { data: { ...state.payload }, error: null };
    }
    if (state.op === 'delete') return { data: null, error: null };
    return { data: matchingRows(), error: null };
  }

  return builder;
}

function createDb(rows = cloneRows(), calls = []) {
  return {
    calls,
    rows,
    from(table) {
      calls.push({ table, op: 'from' });
      return createBuilder(table, rows, calls);
    },
  };
}

function createHandlers(db) {
  return createDataHandlers({
    supabaseReady: () => true,
    supabaseClient: () => db,
    TABLES,
  });
}

function request({ id, role }, db, body = {}, query = {}) {
  return {
    body,
    query,
    headers: {},
    auth: {
      user: { id, role },
      db,
    },
  };
}

function writeCalls(calls) {
  return calls.filter((call) => ['upsert', 'insert', 'delete'].includes(call.op));
}

test('patient can access own plan but cannot target another patient', async () => {
  const db = createDb();
  const handlers = createHandlers(db);

  const own = await handlers.getPlan(request({ id: 'patient-1', role: 'patient' }, db));
  const other = await handlers.getPlan(request({ id: 'patient-1', role: 'patient' }, db, {}, { patientId: 'patient-2' }));

  assert.equal(own.status, 200);
  assert.equal(own.body.patientId, 'patient-1');
  assert.equal(other.status, 403);
  assert.equal(other.body.error, 'forbidden');
});

test('therapist can access linked patient data across plan references and sessions', async () => {
  const db = createDb();
  const handlers = createHandlers(db);
  const req = (body = {}, query = { patientId: 'patient-1' }) => request({ id: 'therapist-1', role: 'therapist' }, db, body, query);

  assert.equal((await handlers.getPlan(req())).status, 200);
  assert.equal((await handlers.putPlan(req({ items: [{ exerciseId: 'shoulder', reps: 8 }] }))).status, 200);
  assert.equal((await handlers.getReferences(req())).status, 200);
  assert.equal((await handlers.postReference(req({ exerciseId: 'shoulder', kind: 'motion_cycle' }))).status, 200);
  assert.equal((await handlers.deleteReference(req({}, { patientId: 'patient-1', exerciseId: 'shoulder' }))).status, 204);
  assert.equal((await handlers.getSessions(req())).status, 200);
  assert.equal((await handlers.postSession(req({ exerciseId: 'shoulder', endedAt: 1000, score: 88 }))).status, 201);
});

test('therapist cannot read or write unlinked patient data', async () => {
  const db = createDb();
  const handlers = createHandlers(db);
  const req = (body = {}, query = { patientId: 'patient-2' }) => request({ id: 'therapist-1', role: 'therapist' }, db, body, query);

  const results = [
    await handlers.getPlan(req()),
    await handlers.putPlan(req({ items: [{ exerciseId: 'knee' }] })),
    await handlers.getReferences(req()),
    await handlers.postReference(req({ exerciseId: 'knee', kind: 'motion_cycle' })),
    await handlers.deleteReference(req({}, { patientId: 'patient-2', exerciseId: 'knee' })),
    await handlers.getSessions(req()),
    await handlers.postSession(req({ exerciseId: 'knee', endedAt: 1000, score: 70 })),
  ];

  assert.deepEqual(results.map((result) => result.status), [403, 403, 403, 403, 403, 403, 403]);
  assert.equal(writeCalls(db.calls).length, 0);
});

test('patient cannot use therapist roster endpoints', async () => {
  const db = createDb();
  const handlers = createHandlers(db);
  const patientReq = request({ id: 'patient-1', role: 'patient' }, db, { patientId: 'patient-2' });

  assert.equal((await handlers.listPatients(patientReq)).status, 403);
  assert.equal((await handlers.linkPatient(patientReq)).status, 403);
  assert.equal((await handlers.createPatient(patientReq)).status, 403);
  assert.equal(writeCalls(db.calls).length, 0);
});
