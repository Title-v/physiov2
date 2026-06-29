import health from '../../../shared/api/handlers/health.js';

const { healthPayload } = health;

export async function GET() {
  return Response.json(healthPayload());
}
