import { runAuthenticatedDataHandler } from '../../_api.js';

export async function POST(request) {
  return runAuthenticatedDataHandler(request, 'linkPatient');
}
