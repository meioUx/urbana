// API tests call the server with Node's fetch, which (unlike a browser) sends no Origin header.
// The server rejects state-changing requests without proof of same origin (ORIGIN_REQUIRED), so this
// helper makes test requests look like the app's own same-origin fetch: it adds Origin = the target
// URL's origin when the caller did not set one. An explicit Origin (e.g. a forged one) is kept as is.
// tests/security.test.js does not import it and exercises the raw behavior.
const rawFetch = globalThis.fetch;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

globalThis.fetch = (input, init = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method = String(
    init.method || (input instanceof Request ? input.method : "GET"),
  ).toUpperCase();
  if (SAFE.has(method)) return rawFetch(input, init);
  const headers = new Headers(
    init.headers || (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has("origin")) headers.set("origin", url.origin);
  return rawFetch(input, { ...init, headers });
};

export { rawFetch };
