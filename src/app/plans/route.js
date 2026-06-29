import { runAuthenticatedDataHandler } from '../_api.js';

export async function GET(request) {
  return runAuthenticatedDataHandler(request, 'getPlan');
}

export async function PUT(request) {
  return runAuthenticatedDataHandler(request, 'putPlan');
}
