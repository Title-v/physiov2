import fs from 'node:fs';

const source = fs.readFileSync('apps/patient/app.js', 'utf8');
const apiSource = fs.readFileSync('apps/patient/patientApi.js', 'utf8');
const screenSource = fs.readFileSync('apps/patient/patientScreens.js', 'utf8');
const runtimeSource = fs.readFileSync('apps/patient/practiceRuntime.js', 'utf8');
const syncSource = fs.readFileSync('apps/patient/sessionSync.js', 'utf8');
const frameSource = fs.readFileSync('shared/practice/frame.js', 'utf8');
const sessionSource = fs.readFileSync('shared/practice/session.js', 'utf8');

const checks = [
  {
    name: 'patient practice runtime imports shared pose detection',
    pass: runtimeSource.includes("from '../../shared/ai/PoseDetection.js'"),
  },
  {
    name: 'patient practice runtime creates shared motion engine and frame processor',
    pass: runtimeSource.includes('motionEngineFactory = createMotionQualityEngine')
      && runtimeSource.includes('frameProcessorFactory = createPracticeFrameProcessor')
      && runtimeSource.includes('state.motionEngine = motionEngineFactory({')
      && runtimeSource.includes('state.frameProcessor = frameProcessorFactory({'),
  },
  {
    name: 'patient delegates live frame processing to shared practice frame processor',
    pass: runtimeSource.includes("from '../../shared/practice/frame.js'")
      && runtimeSource.includes('frameProcessorFactory = createPracticeFrameProcessor')
      && runtimeSource.includes('state.frameProcessor.processPracticeFrame({')
      && frameSource.includes('motionEngine.pushFrame({')
      && frameSource.includes('jointAngles: prepared.liveAngles')
      && frameSource.includes('boundary: prepared.boundary')
      && frameSource.includes('aiSignal'),
  },
  {
    name: 'patient runtime uses optional async AI classifier path',
    pass: runtimeSource.includes("from '../../shared/ai/MotionTcnRuntime.js'")
      && runtimeSource.includes("from '../../shared/ai/TcnMotionClassifier.js'")
      && runtimeSource.includes('modelRegistryFactory = createMotionTcnModelRegistry')
      && runtimeSource.includes('motionClassifierFactory = createTcnMotionClassifier')
      && runtimeSource.includes('state.frameProcessor.processPracticeFrameWithAi(frameArgs)')
      && runtimeSource.includes('motionClassifier: state.motionClassifier')
      && runtimeSource.includes('classifierOptions: {')
      && runtimeSource.includes('landmarkSchemaId: exercise.landmarkSchemaId'),
  },
  {
    name: 'shared practice frame processor exposes optional async AI signal path',
    pass: frameSource.includes('processPracticeFrameWithAi')
      && frameSource.includes('motionClassifier.predict')
      && frameSource.includes('classifierWindowSize')
      && frameSource.includes('resetAiWindow'),
  },
  {
    name: 'patient smooths live landmarks before shared frame processing',
    pass: runtimeSource.includes("from '../../shared/ai/LandmarkFilters.js'")
      && runtimeSource.includes('landmarkFilterFactory = createEmaLandmarkFilter')
      && runtimeSource.includes('state.landmarkFilter?.smooth(rawLandmarks)'),
  },
  {
    name: 'patient session summary payload comes from shared session helper',
    pass: runtimeSource.includes('state.motionEngine.finishSummary()')
      && syncSource.includes('buildPracticeSessionPayload({')
      && sessionSource.includes('score: summary.overallScore')
      && syncSource.includes("postSession('/sessions', payload)"),
  },
  {
    name: 'patient session payload carries versioned score breakdown',
    pass: syncSource.includes('reference: run.reference')
      && sessionSource.includes('sessionVersion: PRACTICE_SESSION_VERSION')
      && sessionSource.includes('scoreBreakdown: sessionScoreBreakdown(summary)')
      && sessionSource.includes('referenceVersion: reference?.referenceVersion'),
  },
  {
    name: 'patient app uses shared role auth client',
    pass: apiSource.includes("from '../../shared/core/auth-client.js'")
      && apiSource.includes("role: 'patient'")
      && apiSource.includes('createRoleAuthClient({')
      && !source.includes('async function api(path'),
  },
  {
    name: 'patient app splits state api screens from orchestration',
    pass: source.includes("from './patientState.js'")
      && source.includes("from './patientApi.js'")
      && source.includes("from './patientScreens.js'")
      && screenSource.includes('createPatientScreenRenderer')
      && source.includes('createPatientPracticeRuntime({'),
  },
  {
    name: 'patient no longer uses synthetic replay scoring',
    pass: !/(runPracticeEngine|pushSyntheticFrame|replayMotionRep)/.test(source + runtimeSource),
  },
];

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
