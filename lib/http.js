// Small helper for returning JSON from Web-API serverless functions.
export function json(data, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  return new Response(JSON.stringify(data), { ...init, headers });
}
