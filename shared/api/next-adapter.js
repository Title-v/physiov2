export function headersObject(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

export async function nextRequestToApiRequest(request) {
  const headers = headersObject(request.headers);
  const url = new URL(request.url || 'http://localhost');
  if (!headers.host) headers.host = url.host;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = url.protocol.replace(/:$/, '');
  let body = {};
  if (!['GET', 'HEAD'].includes(String(request.method || 'GET').toUpperCase())) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  return {
    body,
    headers,
    method: request.method,
    protocol: url.protocol.replace(/:$/, ''),
    query: Object.fromEntries(url.searchParams.entries()),
  };
}

export function resultToNextResponse(result) {
  if (result.status === 204) return new Response(null, { status: 204 });
  return Response.json(result.body, { status: result.status || 200 });
}

export default {
  nextRequestToApiRequest,
  resultToNextResponse,
};
