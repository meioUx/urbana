// Tiny DOM helpers for the citizen portal (no framework: the page must stay small on slow networks).
type Child = Node | string | null | undefined | false;
type Attrs = Record<
  string,
  string | number | boolean | null | undefined | ((event: Event) => void)
>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function")
      element.addEventListener(name.replace(/^on/, "").toLowerCase(), value);
    else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined && child !== false)
      element.append(child);
  return element;
}

export const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

export function focusHeading(element: HTMLElement | null) {
  if (!element) return;
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus();
}

// crypto.randomUUID only exists in secure contexts; getRandomValues works everywhere.
export function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ApiResult = {
  status: number;
  data: Record<string, unknown>;
  retryAfter: number | null;
};

// fetch with a timeout; network failures throw "network", timeouts "timeout".
export async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    throw new Error(
      (error as Error)?.name === "AbortError" ? "timeout" : "network",
    );
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const retry = Number(response.headers.get("retry-after"));
  return {
    status: response.status,
    data,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

export const waitText = (seconds: number | null) => {
  if (!seconds) return "mais tarde";
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? "em cerca de 1 minuto"
    : minutes >= 60
      ? `em cerca de ${Math.ceil(minutes / 60)} hora(s)`
      : `em cerca de ${minutes} minutos`;
};

export const formatDate = (iso: unknown) => {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
