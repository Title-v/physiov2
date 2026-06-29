import fs from 'node:fs/promises';
import path from 'node:path';
import nextConfig from '../next.config.mjs';

const root = process.cwd();
const checks = [];

function check(name, pass, detail = null) {
  checks.push({ name, pass: !!pass, detail });
}

async function readPublic(...parts) {
  return fs.readFile(path.join(root, 'public', ...parts), 'utf8');
}

async function readWorkspace(...parts) {
  return fs.readFile(path.join(root, ...parts), 'utf8');
}

async function publicExists(...parts) {
  try {
    await fs.access(path.join(root, 'public', ...parts));
    return true;
  } catch {
    return false;
  }
}

async function workspaceExists(...parts) {
  try {
    await fs.access(path.join(root, ...parts));
    return true;
  } catch {
    return false;
  }
}

async function contentIncludes(name, parts, expected) {
  try {
    const body = await readPublic(...parts);
    check(name, body.includes(expected));
  } catch (error) {
    check(name, false, error.message);
  }
}

async function workspaceContentIncludes(name, parts, expected) {
  try {
    const body = await readWorkspace(...parts);
    check(name, body.includes(expected));
  } catch (error) {
    check(name, false, error.message);
  }
}

const rewrites = typeof nextConfig.rewrites === 'function'
  ? await nextConfig.rewrites()
  : [];
const rewriteMap = new Map(rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));

check('root is no longer a static rewrite', !rewriteMap.has('/'));
await workspaceContentIncludes('native root page uses Therapist home client', ['src', 'app', 'page.jsx'], 'TherapistHomeClient');
await workspaceContentIncludes('native Therapist home client preserves capture link', ['src', 'app', 'therapist', 'TherapistHomeClient.jsx'], '/therapist');
await workspaceContentIncludes('native Therapist home links to native plan builder', ['src', 'app', 'therapist', 'TherapistHomeClient.jsx'], '/therapist/plan');
await workspaceContentIncludes('native Therapist home links to native dashboard', ['src', 'app', 'therapist', 'TherapistHomeClient.jsx'], '/therapist/dashboard');
await workspaceContentIncludes('native therapist default page uses capture client', ['src', 'app', 'therapist', 'page.jsx'], 'TherapistCaptureClient');
await workspaceContentIncludes('native capture page uses capture client', ['src', 'app', 'therapist', 'capture', 'page.jsx'], 'TherapistCaptureClient');
await workspaceContentIncludes('native capture controller delegates motion validation path', ['src', 'app', 'therapist', 'capture', 'captureController.js'], 'getValidationFrameProcessor');
await workspaceContentIncludes('native capture validation controller keeps shared frame processor', ['src', 'app', 'therapist', 'capture', 'validationController.js'], 'createPracticeFrameProcessor');
await workspaceContentIncludes('native capture controller keeps boundary gate', ['src', 'app', 'therapist', 'capture', 'captureController.js'], 'evaluateBoundaryBox');
await workspaceContentIncludes('native capture reference saver keeps trajectory builders', ['src', 'app', 'therapist', 'capture', 'referenceSaver.js'], 'buildReferenceTrajectory');
await workspaceContentIncludes('native plan page uses plan client', ['src', 'app', 'therapist', 'plan', 'page.jsx'], 'TherapistPlanClient');
await workspaceContentIncludes('native plan client keeps full plan save path', ['src', 'app', 'therapist', 'plan', 'TherapistPlanClient.jsx'], 'savePlanFull(patientId, plan)');
await workspaceContentIncludes('native record page uses record client', ['src', 'app', 'therapist', 'record', 'page.jsx'], 'TherapistRecordClient');
await workspaceContentIncludes('native record client keeps boundary recording path', ['src', 'app', 'therapist', 'record', 'TherapistRecordClient.jsx'], 'evaluateBoundaryBox');
await workspaceContentIncludes('native dashboard page uses dashboard client', ['src', 'app', 'therapist', 'dashboard', 'page.jsx'], 'TherapistDashboardClient');
await workspaceContentIncludes('native dashboard client keeps analytics aggregation', ['src', 'app', 'therapist', 'dashboard', 'TherapistDashboardClient.jsx'], 'aggregate(viewSessions)');
await workspaceContentIncludes('shared nav home link points to native root', ['shared', 'core', 'ui.js'], "const homeHref = '/'");
await workspaceContentIncludes('shared nav capture link points to native capture', ['shared', 'core', 'ui.js'], "file: '/therapist/capture'");
await workspaceContentIncludes('shared nav plan link points to native plan builder', ['shared', 'core', 'ui.js'], "file: '/therapist/plan'");
await workspaceContentIncludes('shared nav record link points to native recorder', ['shared', 'core', 'ui.js'], "file: '/therapist/record'");
await workspaceContentIncludes('shared nav dashboard link points to native dashboard', ['shared', 'core', 'ui.js'], "file: '/therapist/dashboard'");
check('patient root rewrites to patient index', rewriteMap.get('/patient') === '/patient/index.html');
check('therapist root is native', !rewriteMap.has('/therapist'));
check('legacy Therapist home rewrites to native root', rewriteMap.get('/therapist/index.html') === '/');
check('legacy Therapist capture rewrites to native capture', rewriteMap.get('/therapist/capture.html') === '/therapist/capture');
check('legacy Therapist plan rewrites to native plan builder', rewriteMap.get('/therapist/plan.html') === '/therapist/plan');
check('legacy Therapist record rewrites to native recorder', rewriteMap.get('/therapist/record.html') === '/therapist/record');
check('legacy Therapist dashboard rewrites to native dashboard', rewriteMap.get('/therapist/dashboard.html') === '/therapist/dashboard');

await contentIncludes('public patient index uses absolute app module', ['patient', 'index.html'], '/patient/app.js');
await contentIncludes('public patient index uses absolute stylesheet', ['patient', 'index.html'], '/patient/styles.css');
await contentIncludes('public patient app module exists', ['patient', 'app.js'], 'createPatientPracticeRuntime');
await contentIncludes('public patient practice runtime module exists', ['patient', 'practiceRuntime.js'], 'drawAngleOverlayForJoints');
await contentIncludes('public patient session sync module exists', ['patient', 'sessionSync.js'], 'buildPracticeSessionPayload');
await contentIncludes('public patient api module exists', ['patient', 'patientApi.js'], 'createPatientAuthClient');
await contentIncludes('public patient state module exists', ['patient', 'patientState.js'], 'createPatientAppState');
await contentIncludes('public patient screens module exists', ['patient', 'patientScreens.js'], 'createPatientScreenRenderer');

check('old public Therapist home is retired', !(await publicExists('therapist', 'index.html')));
check('old public Therapist capture is retired', !(await publicExists('therapist', 'capture.html')));
check('old public Therapist plan is retired', !(await publicExists('therapist', 'plan.html')));
check('old public Therapist record is retired', !(await publicExists('therapist', 'record.html')));
check('old public Therapist dashboard is retired', !(await publicExists('therapist', 'dashboard.html')));
check('old Therapist plan static page is retired', !(await workspaceExists('apps', 'therapist', 'pages', 'plan.html')));
check('old Therapist capture static page is retired', !(await workspaceExists('apps', 'therapist', 'pages', 'capture.html')));
check('old Therapist record static page is retired', !(await workspaceExists('apps', 'therapist', 'pages', 'record.html')));
check('old Therapist dashboard static page is retired', !(await workspaceExists('apps', 'therapist', 'pages', 'dashboard.html')));

await contentIncludes('public shared route serves canonical exercises', ['shared', 'core', 'exercises.js'], 'export const EXERCISES');
await contentIncludes('public shared route serves practice frame processor', ['shared', 'practice', 'frame.js'], 'createPracticeFrameProcessor');
check('public shared route serves pose model', await publicExists('shared', 'models', 'pose_landmarker_lite.task'));
check('public shared route serves wasm', await publicExists('shared', 'vendor', 'wasm', 'vision_wasm_internal.wasm'));

check('public shared api helpers are not published', !(await publicExists('shared', 'api', 'contracts.mjs')));
check('public shared traversal cannot reach private api helpers', !(await publicExists('shared', 'core', '..', 'api', 'contracts.mjs')));
check('public shared unknown section is absent', !(await publicExists('shared', 'unknown', 'file.js')));

const failed = checks.filter((item) => !item.pass);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
