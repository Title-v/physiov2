import { apiErrorBody } from './core.js';

export function jsonResult(body, status = 200) {
  return { status, body };
}

export function errorResult(status, error, detail) {
  return jsonResult(apiErrorBody(error, detail), status);
}

export function noContentResult() {
  return { status: 204, body: null };
}

export function sendResult(res, result) {
  if (result.status === 204) return res.status(204).send();
  return res.status(result.status || 200).json(result.body);
}

export default {
  errorResult,
  jsonResult,
  noContentResult,
  sendResult,
};
