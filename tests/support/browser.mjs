// Ponto único de lançamento do navegador das suítes de navegador.
// URBANA_BROWSER_CHANNEL: msedge (padrão), chrome ou chromium (qualquer canal aceito pelo Playwright).
export function browserChannel() {
  return process.env.URBANA_BROWSER_CHANNEL?.trim() || "msedge";
}

export function launchOptions(extra = {}) {
  return { headless: true, channel: browserChannel(), ...extra };
}

export function launchBrowser(chromium, extra = {}) {
  return chromium.launch(launchOptions(extra));
}
