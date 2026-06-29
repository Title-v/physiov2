export function isMotionExercise(ex = {}) {
  return ex?.type !== 'hold';
}

export function canRecordSequence(ex = {}) {
  return isMotionExercise(ex);
}

export function boundaryText(boundary, { lang = 'en', translate = (key) => key } = {}) {
  if (!boundary) return translate('noPose');
  return lang === 'th' ? boundary.hintTh : boundary.hint;
}

export function boundaryClass(boundary) {
  const status = boundary?.status || 'outside';
  return `pill ${status === 'inside' ? 'good' : 'bad'} glass`;
}

export function captureButtonText(ex = {}, { lang = 'en', translate = (key) => key } = {}) {
  if (isMotionExercise(ex)) return lang === 'th' ? 'ใช้ Record motion' : 'Use Record motion';
  return translate('captureRef');
}

export function captureHint(ex = {}, { lang = 'en', translate = (key) => key } = {}) {
  if (ex.movementPattern === 'alternating') {
    return lang === 'th'
      ? 'บันทึก 1 cycle เต็ม: rest → เป้าซ้าย → rest → เป้าขวา → rest'
      : 'Record one full cycle: rest → left target → rest → right target → rest.';
  }
  if (isMotionExercise(ex)) {
    return lang === 'th'
      ? 'บันทึก 1 cycle เต็ม: rest → target → rest เพื่อใช้ให้คะแนนแบบ motion'
      : 'Record one full cycle: rest → target → rest for motion scoring.';
  }
  return translate('captureHint');
}

export function degText(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '—';
}

export function trajectoryRangeFor(reference, joint) {
  const values = (reference?.referenceSequence?.frames || [])
    .map((frame) => frame?.angles?.[joint])
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return Math.max(...values) - Math.min(...values);
}

export function cycleAnglesFor(reference, joint) {
  if (!reference) return { rest: null, target: null, returned: null, range: null, endpointRange: null, trajectoryRange: null };
  const motion = reference?.jointMotion?.[joint] || null;
  const rest = motion?.rest ?? reference?.restJointAngles?.[joint] ?? reference?.plan?.restAngle;
  const target = motion?.target ?? reference?.targetJointAngles?.[joint] ?? reference?.jointAngles?.[joint] ?? reference?.plan?.targetAngle;
  const returned = reference?.returnRestJointAngles?.[joint] ?? null;
  const endpointRange = Number.isFinite(rest) && Number.isFinite(target) ? Math.abs(target - rest) : null;
  const trajectoryRange = motion?.trajectoryRange ?? trajectoryRangeFor(reference, joint);
  const range = Math.max(endpointRange || 0, trajectoryRange || 0);
  return { rest, target, returned, range, endpointRange, trajectoryRange };
}

export function roleText(role, lang = 'en') {
  if (role === 'primary_motion') return lang === 'th' ? 'หลัก' : 'primary';
  if (role === 'coordinated_motion') return lang === 'th' ? 'ร่วมขยับ' : 'coordinated';
  if (role === 'reference_pattern') return lang === 'th' ? 'แพทเทิร์น' : 'pattern';
  return lang === 'th' ? 'ติดตาม' : 'tracked';
}

export function buildReferencePanelModel({
  reference = null,
  exercise = {},
  romBodyRegion = null,
  lang = 'en',
  candidateRepJointsForExercise = () => [],
  formatMs = (ms) => `${ms}ms`,
} = {}) {
  const primaryJoint = reference?.dominantJoint || reference?.primaryJoint || reference?.repJoints?.[0] || exercise.dominantJoint || exercise.primaryJoint;
  const primaryCycle = cycleAnglesFor(reference, primaryJoint);
  const targetShownText = reference && Number.isFinite(primaryCycle.target)
    ? `${Math.round(primaryCycle.target)}°`
    : '—';
  const tracked = reference?.repJoints || (isMotionExercise(exercise)
    ? candidateRepJointsForExercise(exercise, romBodyRegion || exercise.bodyRegion || 'full')
    : (exercise.repJoints || [reference?.dominantJoint || exercise.primaryJoint].filter(Boolean)));
  const requested = reference?.requestedRepJoints || [];
  const skippedRequested = requested.filter((joint) => !tracked.includes(joint));
  const trackedLabel = tracked.length
    ? tracked.join(', ') +
      (skippedRequested.length
        ? (lang === 'th' ? ` · ไม่มีข้อมูล ${skippedRequested.join(', ')}` : ` · unavailable ${skippedRequested.join(', ')}`)
        : (!reference && isMotionExercise(exercise) ? (lang === 'th' ? ' (candidate)' : ' (candidate)') : ''))
    : (lang === 'th' ? 'ระบบจะเลือกจาก motion ตอนบันทึก' : 'detected from motion during capture');
  const seqPhases = reference?.referenceSequence?.phases;
  const timingText = seqPhases?.targetMs != null && seqPhases?.restEndMs != null
    ? `${formatMs(seqPhases.targetMs - (seqPhases.restStartMs || 0))} out · ${formatMs(seqPhases.restEndMs - seqPhases.targetMs)} back`
    : (reference?.referenceSequence?.durationMs ? formatMs(reference.referenceSequence.durationMs) : null);
  const primaryCycleText = reference ? [
    degText(primaryCycle.rest),
    degText(primaryCycle.target),
    primaryCycle.returned != null ? degText(primaryCycle.returned) : null,
  ].filter(Boolean).join(' → ') : '— → —';
  const jointRows = reference && tracked.length
    ? tracked.map((joint) => {
        const cycle = cycleAnglesFor(reference, joint);
        const role = reference?.jointMotion?.[joint]?.role || reference?.jointRoles?.[joint]?.role;
        const valuesText = [degText(cycle.rest), degText(cycle.target), cycle.returned != null ? degText(cycle.returned) : null]
          .filter(Boolean)
          .join(' → ');
        const suffix = Number.isFinite(cycle.range)
          ? ` · ${roleText(role, lang)} ${Math.round(cycle.range)}°${cycle.trajectoryRange ? ' path' : ''}`
          : '';
        return { joint, cycle, role, valuesText, suffix };
      })
    : [];
  return {
    primaryJoint,
    primaryCycle,
    targetShownText,
    tracked,
    requested,
    skippedRequested,
    trackedLabel,
    timingText,
    primaryCycleText,
    patternText: reference?.movementPattern || exercise.movementPattern || 'unilateral',
    jointRows,
  };
}
