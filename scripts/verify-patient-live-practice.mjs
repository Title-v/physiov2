import fs from 'node:fs';

const source = fs.readFileSync('apps/patient/app.js', 'utf8');
const frameSource = fs.readFileSync('shared/practice/frame.js', 'utf8');
const sessionSource = fs.readFileSync('shared/practice/session.js', 'utf8');

const checks = [
  {
    name: 'patient imports shared pose detection',
    pass: source.includes("from '../../shared/ai/PoseDetection.js'"),
  },
  {
    name: 'patient creates shared motion engine and frame processor',
    pass: source.includes('createMotionQualityEngine({') && source.includes('practiceRuntime.motionEngine'),
  },
  {
    name: 'patient delegates live frame processing to shared practice frame processor',
    pass: source.includes("from '../../shared/practice/frame.js'")
      && source.includes('createPracticeFrameProcessor({')
      && source.includes('practiceRuntime.frameProcessor.processPracticeFrame({')
      && frameSource.includes('motionEngine.pushFrame({ timestamp, landmarks, jointAngles: liveAngles, boundary: nextBoundary })'),
  },
  {
    name: 'patient session summary payload comes from shared session helper',
    pass: source.includes('practiceRuntime.motionEngine.finishSummary()')
      && source.includes('buildPracticeSessionPayload({')
      && sessionSource.includes('score: summary.overallScore')
      && source.includes("apiPost('/sessions'"),
  },
  {
    name: 'patient no longer uses synthetic replay scoring',
    pass: !/(runPracticeEngine|pushSyntheticFrame|replayMotionRep)/.test(source),
  },
];

const failed = checks.filter((check) => !check.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
