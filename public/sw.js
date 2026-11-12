// Service worker do Urbana.
// - Shell do app: HTML (rede primeiro, cópia local sem rede) e arquivos com hash do build em /assets/
//   (imutáveis: cache primeiro). Assim /campo abre sem rede depois do primeiro uso.
// - O service worker não toca em nenhuma requisição de /api: nada é guardado nem respondido daqui.
// - Nem no portal do cidadão (/portal): a página pública e os arquivos que ela pede vão direto à rede.
//   Os dados do Campo ficam no IndexedDB, por usuário (src/field-storage.ts); sem rede, o próprio
//   app abre /campo com a sessão salva ali (ADR-020).
// - Atualização: trocar VERSION descarta os caches antigos na ativação. O HTML vem sempre da rede
//   quando há conexão, então um build novo é usado na próxima abertura; os arquivos antigos com
//   hash continuam servindo a página aberta até ela recarregar.
// - Push e Background Sync (complemento: avisa o app aberto para enviar a fila; o envio é feito
//   pelo app ao reconectar, ao voltar para a tela e periodicamente, inclusive no iOS).
const VERSION = "v4";
const STATIC = `urbana-field-static-${VERSION}`;
const SHELL = `urbana-shell-${VERSION}`;
const SHELL_KEY = "/__urbana-shell__";
const MAX_ASSETS = 200;
const NAVIGATION_TIMEOUT = 5000;
const SYNC_TAG = "urbana-field-outbox";

const sameOrigin = (url) => url.origin === self.location.origin;
const isAsset = (url) => sameOrigin(url) && url.pathname.startsWith("/assets/");
const isFieldPath = (pathname) =>
  pathname === "/campo" || pathname.startsWith("/campo/");
// Portal do cidadão (/portal, /portal/*, /portal.html): página pública separada, sem login. O service
// worker não responde nem guarda nada dela: nem a navegação, nem os arquivos pedidos por ela.
const isPortalPath = (pathname) =>
  pathname === "/portal" ||
  pathname === "/portal.html" ||
  pathname.startsWith("/portal/");
const fromPortal = (request) => {
  try {
    return request.referrer
      ? isPortalPath(new URL(request.referrer).pathname)
      : false;
  } catch {
    return false;
  }
};

function assetUrls(html) {
  return [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]),
    ),
  ];
}

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((request) =>
    new URL(request.url).pathname.startsWith("/assets/"),
  );
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)))
    await cache.delete(request);
}

async function cacheAssets(urls) {
  const cache = await caches.open(SHELL);
  await Promise.allSettled(
    urls.map(async (value) => {
      const url = new URL(value, self.location.origin);
      if (!isAsset(url) || (await cache.match(url.pathname))) return;
      const response = await fetch(url.pathname);
      if (response.ok && response.type === "basic")
        await cache.put(url.pathname, response);
    }),
  );
  await trimAssets(cache);
}

/** Guarda o HTML do app (o mesmo para todas as rotas da SPA) e os arquivos de entrada do build. */
async function storeShell(response) {
  if (
    !response.ok ||
    response.type !== "basic" ||
    !(response.headers.get("content-type") || "").includes("text/html")
  )
    return;
  const html = await response.clone().text();
  if (!html.includes('id="root"')) return;
  const cache = await caches.open(SHELL);
  await cache.put(SHELL_KEY, response);
  await cacheAssets(assetUrls(html));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) =>
        cache.addAll([
          "/offline.html",
          "/offline.css",
          "/icon-192.png",
          "/icon-512.png",
        ]),
      )
      .then(() =>
        fetch("/campo", { cache: "no-store", credentials: "same-origin" })
          .then(storeShell)
          .catch(() => {}),
      )
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                (k.startsWith("urbana-field-static-") && k !== STATIC) ||
                (k.startsWith("urbana-shell-") && k !== SHELL),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function navigation(event, url) {
  const network = fetch(event.request);
  // A cópia do HTML é atualizada a cada abertura com rede (inclusive se chegar depois do prazo).
  event.waitUntil(
    network
      .then((response) =>
        url.pathname.endsWith(".html") ? null : storeShell(response.clone()),
      )
      .catch(() => {}),
  );
  return (async () => {
    const cached = isFieldPath(url.pathname)
      ? await caches.match(SHELL_KEY, { cacheName: SHELL })
      : null;
    if (!cached)
      return network.catch(
        async () => (await caches.match("/offline.html")) || Response.error(),
      );
    // Rede primeiro; sem rede ou sinal fraco demais (sem resposta em 5 s): abre o app salvo.
    return Promise.race([
      network.catch(() => cached),
      new Promise((resolve) =>
        setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT),
      ),
    ]);
  })();
}

async function asset(request, url) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(url.pathname);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(url.pathname, response.clone());
    await trimAssets(cache);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!sameOrigin(url) || request.method !== "GET") return;
  // /api: sempre a rede, sem passar pelo service worker.
  if (url.pathname.startsWith("/api/")) return;
  // Portal do cidadão: sempre a rede (página e recursos dela).
  if (isPortalPath(url.pathname) || fromPortal(request)) return;
  // Stylesheet of the offline page (kept out of offline.html for the Content-Security-Policy).
  if (url.pathname === "/offline.css") {
    event.respondWith(
      caches.match("/offline.css").then((cached) => cached || fetch(request)),
    );
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigation(event, url));
    return;
  }
  if (isAsset(url)) event.respondWith(asset(request, url));
});

self.addEventListener("message", (event) => {
  if (
    event.data?.type === "urbana-cache-shell" &&
    Array.isArray(event.data.urls)
  )
    event.waitUntil(cacheAssets(event.data.urls.slice(0, MAX_ASSETS)));
});

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) =>
        clients.forEach((client) =>
          client.postMessage({ type: "urbana-field-sync" }),
        ),
      ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  const url =
    typeof data.url === "string" && data.url.startsWith("/campo?ordem=")
      ? data.url
      : "/campo";
  event.waitUntil(
    self.registration.showNotification(data.title || "Urbana Campo", {
      body: data.body || "Uma tarefa foi atualizada.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "urbana-task",
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/campo",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const client = clients.find((c) =>
          c.url.startsWith(self.location.origin + "/campo"),
        );
        if (client) {
          await client.navigate(url);
          return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
