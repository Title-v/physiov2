import { runPublicAuthHandler } from '../_shared.js';

export async function POST(request) {
  return runPublicAuthHandler(request, 'login');
}
