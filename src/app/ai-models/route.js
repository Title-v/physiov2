import { runAuthenticatedDataHandler } from '../_api.js';

export async function GET(request) {
  return runAuthenticatedDataHandler(request, 'getAiModels');
}

export async function POST(request) {
  return runAuthenticatedDataHandler(request, 'postAiModel');
}
