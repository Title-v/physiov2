function clonePoint(point) {
  return point ? { ...point } : point;
}

function cloneLandmarks(landmarks) {
  return Array.isArray(landmarks) ? landmarks.map(clonePoint) : landmarks;
}

export function createEmaLandmarkFilter({ alpha = 0.55, minVisibility = 0.35 } = {}) {
  const smoothing = Math.min(1, Math.max(0, Number(alpha) || 0.55));
  const visibilityFloor = Math.max(0, Number(minVisibility) || 0);
  let previous = null;

  function reset() {
    previous = null;
  }

  function smooth(landmarks) {
    if (!Array.isArray(landmarks)) {
      previous = null;
      return landmarks;
    }

    if (!previous || previous.length !== landmarks.length) {
      previous = cloneLandmarks(landmarks);
      return cloneLandmarks(previous);
    }

    const out = landmarks.map((point, index) => {
      const old = previous[index];
      if (!point || !old || (point.visibility ?? 1) < visibilityFloor) {
        return clonePoint(point);
      }
      return {
        ...point,
        x: old.x + smoothing * (point.x - old.x),
        y: old.y + smoothing * (point.y - old.y),
        z: (old.z ?? 0) + smoothing * ((point.z ?? 0) - (old.z ?? 0)),
        visibility: point.visibility,
      };
    });

    previous = out.map((point, index) => {
      const incoming = landmarks[index];
      if (!incoming || (incoming.visibility ?? 1) < visibilityFloor) return clonePoint(previous[index]);
      return clonePoint(point);
    });
    return cloneLandmarks(out);
  }

  return { smooth, reset };
}
