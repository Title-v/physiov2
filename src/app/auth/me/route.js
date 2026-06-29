import { runAuthMeHandler } from '../_shared.js';

export async function GET(request) {
  return runAuthMeHandler(request);
}
