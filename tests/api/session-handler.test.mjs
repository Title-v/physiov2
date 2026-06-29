import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataHandlers } from '../../shared/api/handlers/data-routes.js';

const TABLES = {
  sessions: 'sessions',
  therapistPatients: 'therapist_patients',
  profiles: 'profiles',
  plans: 'plans',
  references: 'references',
};

function createMockDb() {
  const rows = [];
  return {
    rows,
    from(table) {
      assert.equal(table, TABLES.sessions);
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(column, value) {
          filters.push({ column, value });
          return this;
        },
        order() {
          const data = rows
            .filter((row) => filters.every((filter) => row[filter.column] === filter.value))
            .sort((a, b) => Number(new Date(b.ended_at)) - Number(new Date(a.ended_at)));
          return { data, error: null };
        },
        insert(row) {
          rows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function patientRequest(db, body = {}, query = {}) {
  return {
    body,
    query,
    auth: {
      user: { id: 'patient-1', role: 'patient' },
      db,
    },
  };
}

test('postSession persists summary shape and returns session row shape', async () => {
  const db = createMockDb();
  const handlers = createDataHandlers({
    supabaseReady: () => true,
    supabaseClient: () => db,
    TABLES,
  });
  const summary = {
    overallScore: 88,
    avgScore: 84,
    reps: 10,
    validReps: 9,
    invalidRepCount: 1,
  };
  const result = await handlers.postSession(patientRequest(db, {
    id: 'patient_shoulder_1000',
    exerciseId: 'shoulder',
    endedAt: 1000,
    score: 88,
    avgScore: 84,
    reps: 10,
    validReps: 9,
    invalidRepCount: 1,
    summary,
  }));

  assert.equal(result.status, 201);
  assert.equal(result.body.patientId, 'patient-1');
  assert.equal(result.body.exerciseId, 'shoulder');
  assert.equal(result.body.summary, summary);
  assert.equal(db.rows[0].patient_id, 'patient-1');
  assert.equal(db.rows[0].exercise_id, 'shoulder');
  assert.equal(db.rows[0].data.validReps, 9);
});

test('getSessions returns newest-first sessions with data payload fields', async () => {
  const db = createMockDb();
  db.rows.push(
    {
      id: 'old',
      patient_id: 'patient-1',
      exercise_id: 'knee',
      ended_at: new Date(1000).toISOString(),
      data: { id: 'old', exerciseId: 'knee', endedAt: 1000, score: 70, summary: { overallScore: 70 } },
    },
    {
      id: 'new',
      patient_id: 'patient-1',
      exercise_id: 'shoulder',
      ended_at: new Date(2000).toISOString(),
      data: { id: 'new', exerciseId: 'shoulder', endedAt: 2000, score: 90, summary: { overallScore: 90 } },
    },
  );
  const handlers = createDataHandlers({
    supabaseReady: () => true,
    supabaseClient: () => db,
    TABLES,
  });
  const result = await handlers.getSessions(patientRequest(db));
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 2);
  assert.equal(result.body[0].id, 'new');
  assert.equal(result.body[0].summary.overallScore, 90);
  assert.equal(result.body[1].id, 'old');
});
