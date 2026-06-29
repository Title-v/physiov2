export const HEALTH_PAYLOAD = Object.freeze({
  name: 'PhysioAI Supabase Backend',
  status: 'ok',
});

export function healthPayload() {
  return { ...HEALTH_PAYLOAD };
}

export function sendHealth(_req, res) {
  return res.json(healthPayload());
}

export default {
  HEALTH_PAYLOAD,
  healthPayload,
  sendHealth,
};
