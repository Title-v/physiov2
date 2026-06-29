import { runAuthenticatedDataHandler } from '../_api.js';

export async function GET(request) {
  return runAuthenticatedDataHandler(request, 'getReferences');
}

export async function POST(request) {
  return runAuthenticatedDataHandler(request, 'postReference');
}

export async function DELETE(request) {
  return runAuthenticatedDataHandler(request, 'deleteReference');
}
