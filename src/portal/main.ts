// Portal do cidadão: registrar uma demanda (/portal) e acompanhar pelo número + código
// (/portal/acompanhar). Entrada separada do Vite (portal.html): não carrega nada da área autenticada.
// O mapa (Leaflet) só é baixado quando a pessoa escolhe "Marcar no mapa".
import "./portal.css";
import {
  byId,
  focusHeading,
  formatDate,
  h,
  request,
  uuid,
  waitText,
} from "./dom";
import { preparePhoto } from "./photo";

type Category = { id: string; name: string; subcategories: string[] };
type Catalog = {
  municipality: string;
  consent_text: string;
  categories: Category[];
  form_token: string;
  photo_max_bytes: number;
};
type Point = { lat: number; lng: number; source: "gps" | "mapa" };
type Picker = {
  useCenter: () => void;
  show: (lat: number, lng: number) => void;
  refresh: () => void;
};

const main = byId("conteudo")!;
const trackingPage = /^\/portal\/acompanhar\/?$/.test(location.pathname);
byId(trackingPage ? "nav-track" : "nav-register")?.setAttribute(
  "aria-current",
  "page",
);

const render = (...nodes: Node[]) => {
  main.replaceChildren(...nodes);
};

async function loadCatalog(): Promise<Catalog | "off" | "error"> {
  try {
    const result = await request("/api/publico/catalogo");
    if (result.status === 404) return "off";
    if (result.status !== 200) return "error";
    const catalog = result.data as unknown as Catalog;
    const municipality = byId("portal-municipality");
    if (municipality && catalog.municipality)
      municipality.textContent = `Prefeitura de ${catalog.municipality}`;
    return catalog;
  } catch {
    return "error";
  }
}

function unavailable() {
  document.title = "Portal indisponível | Portal do cidadão";
  const title = h("h1", {}, "Portal indisponível");
  render(
    title,
    h(
      "p",
      {},
      "O portal do cidadão não está disponível no momento. Para registrar ou acompanhar uma demanda, procure a central de atendimento da Prefeitura.",
    ),
  );
  focusHeading(title);
}

function loadFailed(retry: () => void) {
  const title = h("h1", {}, "Não foi possível carregar a página");
  render(
    title,
    h("p", {}, "Verifique a conexão com a internet e tente de novo."),
    h(
      "button",
      { type: "button", class: "button primary", onclick: retry },
      "Tentar de novo",
    ),
  );
  focusHeading(title);
}

// ---------------------------------------------------------------- campos com erro associado
function field(
  id: string,
  label: string,
  control: HTMLElement,
  { hint, required = false }: { hint?: string; required?: boolean } = {},
) {
  control.id = id;
  const describedBy = [hint ? `${id}-hint` : "", `${id}-error`]
    .filter(Boolean)
    .join(" ");
  control.setAttribute("aria-describedby", describedBy);
  if (required) control.setAttribute("aria-required", "true");
  return h(
    "div",
    { class: "field" },
    h(
      "label",
      { for: id },
      label,
      required
        ? h("span", { class: "required" }, " (obrigatório)")
        : h("span", { class: "optional" }, " (opcional)"),
    ),
    hint ? h("p", { class: "hint", id: `${id}-hint` }, hint) : null,
    h("p", { class: "field-error", id: `${id}-error`, hidden: true }),
    control,
  );
}
function setFieldError(id: string, message: string | null) {
  const control = byId(id);
  const error = byId(`${id}-error`);
  if (!control || !error) return;
  error.textContent = message ? message : "";
  error.hidden = !message;
  if (message) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
}

// Server field names → element ids of the form (where the person fixes the problem).
const FIELD_IDS: Record<string, string> = {
  category_id: "f-category",
  subcategory: "f-subcategory",
  description: "f-description",
  photo: "f-photo",
  address: "f-address",
  neighborhood: "f-neighborhood",
  reference: "f-reference",
  lat: "f-location",
  lng: "f-location",
  location_source: "f-location",
  name: "f-name",
  phone: "f-phone",
  consent: "f-consent",
};
const FIELD_LABELS: Record<string, string> = {
  "f-category": "Tipo de problema",
  "f-subcategory": "Detalhe do problema",
  "f-description": "Descrição",
  "f-photo": "Foto",
  "f-address": "Endereço",
  "f-neighborhood": "Bairro",
  "f-reference": "Ponto de referência",
  "f-location": "Local do problema",
  "f-name": "Nome",
  "f-phone": "Telefone",
  "f-consent": "Uso dos dados",
};

// ---------------------------------------------------------------- registrar demanda
async function registerPage() {
  const catalog = await loadCatalog();
  if (catalog === "off") return unavailable();
  if (catalog === "error") return loadFailed(registerPage);
  let formToken = catalog.form_token;
  // Kept across retries of the same submission (idempotent resend), discarded after success.
  let requestId = uuid();
  let point: Point | null = null;
  let picker: Picker | null = null;

  const title = h("h1", {}, "Registrar uma demanda");
  const summary = h("div", {
    class: "error-summary",
    id: "error-summary",
    role: "alert",
    tabindex: "-1",
    hidden: true,
  });
  const status = h("p", {
    class: "form-status",
    role: "status",
    "aria-live": "polite",
  });

  const category = h(
    "select",
    { name: "category_id" },
    h("option", { value: "" }, "Escolha o tipo de problema"),
    ...catalog.categories.map((c) => h("option", { value: c.id }, c.name)),
  );
  const subcategory = h(
    "select",
    { name: "subcategory", disabled: true },
    h("option", { value: "" }, "Escolha primeiro o tipo"),
  );
  category.addEventListener("change", () => {
    const chosen = catalog.categories.find((c) => c.id === category.value);
    subcategory.replaceChildren(
      h(
        "option",
        { value: "" },
        chosen ? "Escolha o detalhe" : "Escolha primeiro o tipo",
      ),
      ...(chosen?.subcategories ?? []).map((s) => h("option", { value: s }, s)),
    );
    subcategory.disabled = !chosen;
    if (chosen?.subcategories.length === 1)
      subcategory.value = chosen.subcategories[0];
  });
  const description = h("textarea", {
    name: "description",
    rows: 5,
    maxlength: 2000,
    minlength: 10,
  });
  const counter = h(
    "p",
    { class: "hint counter", "aria-live": "off" },
    "0 de 2.000 caracteres",
  );
  description.addEventListener(
    "input",
    () =>
      (counter.textContent = `${description.value.length.toLocaleString("pt-BR")} de 2.000 caracteres`),
  );
  const photo = h("input", {
    type: "file",
    name: "photo",
    accept: "image/jpeg,image/png,image/webp",
  });
  const address = h("input", {
    type: "text",
    name: "address",
    maxlength: 300,
    autocomplete: "street-address",
  });
  const neighborhood = h("input", {
    type: "text",
    name: "neighborhood",
    maxlength: 120,
  });
  const reference = h("input", {
    type: "text",
    name: "reference",
    maxlength: 500,
  });
  const name = h("input", {
    type: "text",
    name: "name",
    maxlength: 200,
    autocomplete: "name",
  });
  const phone = h("input", {
    type: "tel",
    name: "phone",
    maxlength: 40,
    autocomplete: "tel",
    inputmode: "tel",
  });
  const honeypot = h("input", {
    type: "text",
    name: "website",
    id: "f-website",
    tabindex: "-1",
    autocomplete: "off",
  });
  const consent = h("input", {
    type: "checkbox",
    name: "consent",
    value: "true",
  });

  // Location: GPS, or the map (keyboard: arrows move, + and − zoom, then "Usar o centro do mapa").
  const locationStatus = h(
    "p",
    {
      class: "location-status",
      id: "f-location-status",
      "aria-live": "polite",
    },
    "Nenhum local marcado ainda.",
  );
  const gpsButton = h(
    "button",
    { type: "button", class: "button secondary", id: "f-location" },
    "Usar minha localização (GPS)",
  );
  gpsButton.setAttribute(
    "aria-describedby",
    "f-location-hint f-location-status f-location-error",
  );
  const mapButton = h(
    "button",
    {
      type: "button",
      class: "button secondary",
      "aria-expanded": "false",
      "aria-controls": "location-map-panel",
    },
    "Marcar no mapa",
  );
  const mapBox = h("div", {
    class: "location-map",
    id: "location-map",
    role: "application",
    "aria-label":
      "Mapa para marcar o local. Use as setas para mover, + e − para aproximar.",
  });
  const centerButton = h(
    "button",
    { type: "button", class: "button secondary" },
    "Usar o centro do mapa",
  );
  const mapPanel = h(
    "div",
    { id: "location-map-panel", class: "location-map-panel", hidden: true },
    h(
      "p",
      { class: "hint" },
      "Toque no ponto exato do problema, ou mova o mapa até a mira ficar sobre ele e use o botão abaixo.",
    ),
    mapBox,
    centerButton,
  );
  const setPoint = (lat: number, lng: number, source: Point["source"]) => {
    point = { lat, lng, source };
    locationStatus.textContent = `Local marcado ${source === "gps" ? "pelo GPS" : "no mapa"}: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`;
    setFieldError("f-location", null);
  };
  gpsButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      locationStatus.textContent =
        "Este aparelho não informa a localização. Use “Marcar no mapa”.";
      return;
    }
    locationStatus.textContent = "Obtendo a sua localização…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint(position.coords.latitude, position.coords.longitude, "gps");
        picker?.show(position.coords.latitude, position.coords.longitude);
      },
      () => {
        locationStatus.textContent =
          "Não foi possível obter a localização. Verifique a permissão do navegador ou use “Marcar no mapa”.";
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
  mapButton.addEventListener("click", async () => {
    const opening = mapPanel.hidden;
    mapPanel.hidden = !opening;
    mapButton.setAttribute("aria-expanded", String(opening));
    if (!opening) return;
    if (picker) return picker.refresh();
    mapBox.textContent = "Carregando o mapa…";
    try {
      const { createPicker } = await import("./map");
      mapBox.textContent = "";
      picker = createPicker(mapBox, point, (lat, lng) =>
        setPoint(lat, lng, "mapa"),
      );
    } catch {
      mapBox.textContent =
        "Não foi possível carregar o mapa. Use o GPS ou tente de novo mais tarde.";
    }
  });
  centerButton.addEventListener("click", () => picker?.useCenter());

  const submit = h(
    "button",
    { type: "submit", class: "button primary" },
    "Enviar demanda",
  );
  const form = h(
    "form",
    { novalidate: true, class: "portal-form", "aria-labelledby": "form-title" },
    h(
      "fieldset",
      {},
      h("legend", {}, "O problema"),
      field("f-category", "Tipo de problema", category, { required: true }),
      field("f-subcategory", "Detalhe do problema", subcategory, {
        required: true,
      }),
      field("f-description", "Descrição", description, {
        required: true,
        hint: "Conte o que está acontecendo (pelo menos 10 caracteres). Não escreva dados pessoais de outras pessoas.",
      }),
      counter,
      field("f-photo", "Foto", photo, {
        hint: "JPG, PNG ou WebP. Fotos grandes são reduzidas antes do envio.",
      }),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Onde fica"),
      field("f-address", "Endereço", address, {
        required: true,
        hint: "Rua e número aproximado.",
      }),
      field("f-neighborhood", "Bairro", neighborhood, { required: true }),
      field("f-reference", "Ponto de referência", reference, {
        hint: "Por exemplo: em frente à escola.",
      }),
      h(
        "div",
        { class: "field location" },
        h(
          "p",
          { class: "label", id: "f-location-label" },
          "Local do problema",
          h("span", { class: "required" }, " (obrigatório)"),
        ),
        h(
          "p",
          { class: "hint", id: "f-location-hint" },
          "Marque o ponto pelo GPS do celular, se você estiver no local, ou no mapa.",
        ),
        h("p", { class: "field-error", id: "f-location-error", hidden: true }),
        h("div", { class: "actions" }, gpsButton, mapButton),
        locationStatus,
        mapPanel,
      ),
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Contato"),
      h(
        "p",
        { class: "hint" },
        "Nome e telefone são opcionais. Servem só para a equipe falar com você sobre esta demanda e não aparecem na consulta pública.",
      ),
      field("f-name", "Nome", name),
      field("f-phone", "Telefone", phone),
    ),
    h(
      "div",
      { class: "hp-field", "aria-hidden": "true" },
      h("label", { for: "f-website" }, "Não preencha este campo"),
      honeypot,
    ),
    h(
      "fieldset",
      {},
      h("legend", {}, "Uso dos dados"),
      h(
        "p",
        { class: "consent-text", id: "consent-text" },
        catalog.consent_text,
      ),
      h(
        "div",
        { class: "field checkbox" },
        h("p", { class: "field-error", id: "f-consent-error", hidden: true }),
        h(
          "label",
          { for: "f-consent" },
          consent,
          " Li e concordo com o uso dos meus dados para esta finalidade.",
          h("span", { class: "required" }, " (obrigatório)"),
        ),
      ),
    ),
    status,
    submit,
  );
  consent.id = "f-consent";
  consent.setAttribute("aria-describedby", "consent-text f-consent-error");

  const showErrors = (errors: [string, string][]) => {
    for (const id of Object.values(FIELD_IDS)) setFieldError(id, null);
    const unique = errors.filter(
      ([id], i) => errors.findIndex(([other]) => other === id) === i,
    );
    for (const [id, message] of unique) setFieldError(id, message);
    if (!unique.length) {
      summary.hidden = true;
      return;
    }
    summary.replaceChildren(
      h(
        "h2",
        {},
        unique.length === 1
          ? "Corrija 1 campo para enviar"
          : `Corrija ${unique.length} campos para enviar`,
      ),
      h(
        "ul",
        {},
        ...unique.map(([id, message]) =>
          h(
            "li",
            {},
            h(
              "a",
              {
                href: `#${id}`,
                onclick: (event: Event) => (
                  event.preventDefault(),
                  byId(id)?.focus()
                ),
              },
              `${FIELD_LABELS[id] ?? "Campo"}: ${message}`,
            ),
          ),
        ),
      ),
    );
    summary.hidden = false;
    summary.focus();
  };
  const localErrors = () => {
    const errors: [string, string][] = [];
    if (!category.value)
      errors.push(["f-category", "Escolha o tipo de problema."]);
    else if (!subcategory.value)
      errors.push(["f-subcategory", "Escolha o detalhe do problema."]);
    if (description.value.trim().length < 10)
      errors.push([
        "f-description",
        "Descreva o problema com pelo menos 10 caracteres.",
      ]);
    if (!address.value.trim())
      errors.push([
        "f-address",
        "Informe o endereço (rua e número aproximado).",
      ]);
    if (!neighborhood.value.trim())
      errors.push(["f-neighborhood", "Informe o bairro."]);
    if (!point)
      errors.push([
        "f-location",
        "Marque o local do problema pelo GPS ou no mapa.",
      ]);
    if (phone.value && !/^[0-9()+\-.\s]*$/.test(phone.value))
      errors.push(["f-phone", "Use apenas números no telefone."]);
    const file = photo.files?.[0];
    if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      errors.push(["f-photo", "A foto deve ser JPG, PNG ou WebP."]);
    if (!consent.checked)
      errors.push([
        "f-consent",
        "Marque que você leu e concorda com o uso dos dados.",
      ]);
    return errors;
  };

  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const errors = localErrors();
    showErrors(errors);
    if (errors.length) return;
    busy = true;
    submit.disabled = true;
    submit.textContent = "Enviando…";
    status.textContent = "Enviando a demanda. Aguarde.";
    try {
      const body = new FormData();
      const values: Record<string, string> = {
        request_id: requestId,
        form_token: formToken,
        website: honeypot.value,
        consent: consent.checked ? "true" : "false",
        category_id: category.value,
        subcategory: subcategory.value,
        description: description.value,
        address: address.value,
        neighborhood: neighborhood.value,
        reference: reference.value,
        lat: String(point!.lat),
        lng: String(point!.lng),
        location_source: point!.source,
        name: name.value,
        phone: phone.value,
      };
      for (const [key, value] of Object.entries(values))
        body.append(key, value);
      const file = photo.files?.[0];
      if (file) {
        status.textContent = "Preparando a foto…";
        const prepared = await preparePhoto(file, catalog.photo_max_bytes);
        if (!prepared) {
          showErrors([
            [
              "f-photo",
              "A foto é grande demais (máximo de 8 MB). Escolha outra.",
            ],
          ]);
          return;
        }
        body.append("photo", prepared, prepared.name);
        status.textContent = "Enviando a demanda. Aguarde.";
      }
      const result = await request(
        "/api/publico/demandas",
        { method: "POST", body },
        120000,
      );
      if (result.status === 201 || result.status === 200) {
        requestId = uuid();
        return success(
          String(result.data.protocol),
          String(result.data.tracking_code),
        );
      }
      const data = result.data as {
        error?: string;
        code?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
      if (result.status === 400 && data.details?.fieldErrors) {
        showErrors(
          Object.entries(data.details.fieldErrors).map(
            ([key, messages]) =>
              [FIELD_IDS[key] ?? "f-description", messages[0]] as [
                string,
                string,
              ],
          ),
        );
        status.textContent = "";
        return;
      }
      if (data.code === "SUBMISSION_REJECTED") {
        // Token expired or sent too fast: a new token is fetched; the person just sends again.
        const fresh = await loadCatalog();
        if (fresh !== "off" && fresh !== "error") formToken = fresh.form_token;
        status.textContent =
          "Não foi possível confirmar o envio. Aguarde alguns segundos e toque em “Enviar demanda” de novo.";
        return;
      }
      if (result.status === 404) return unavailable();
      if (result.status === 429)
        status.textContent = `${data.error ?? "Muitas tentativas."} Tente de novo ${waitText(result.retryAfter)}.`;
      else if (result.status === 413)
        showErrors([["f-photo", data.error ?? "A foto é grande demais."]]);
      else
        status.textContent =
          data.error ?? "Não foi possível registrar a demanda. Tente de novo.";
    } catch (error) {
      status.textContent =
        (error as Error).message === "timeout"
          ? "O envio demorou demais. Seus dados continuam no formulário: toque em “Enviar demanda” de novo (não haverá registro duplicado)."
          : "A conexão falhou. Seus dados continuam no formulário: toque em “Enviar demanda” de novo (não haverá registro duplicado).";
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = "Enviar demanda";
    }
  });

  title.id = "form-title";
  render(
    title,
    h(
      "p",
      { class: "lead" },
      "Avise a Prefeitura sobre problemas como buracos, iluminação apagada, calçadas danificadas ou bueiros entupidos. Você recebe um número e um código para acompanhar o atendimento.",
    ),
    summary,
    form,
  );
}

// Spelled-out code for screen readers ("K 7 Q M, 3 X H P, …").
const spelled = (code: string) =>
  code
    .split("-")
    .map((group) => group.split("").join(" "))
    .join(", ");

function success(protocol: string, code: string) {
  document.title = "Demanda registrada | Portal do cidadão";
  const title = h("h1", {}, "Demanda registrada");
  const copy = h(
    "button",
    { type: "button", class: "button secondary" },
    "Copiar número e código",
  );
  const copied = h("p", {
    class: "form-status",
    role: "status",
    "aria-live": "polite",
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        `Número da demanda: ${protocol}\nCódigo de acompanhamento: ${code}`,
      );
      copied.textContent = "Número e código copiados.";
    } catch {
      copied.textContent = "Não foi possível copiar. Anote os dados acima.";
    }
  });
  render(
    h(
      "section",
      { class: "success", "aria-labelledby": "success-title" },
      Object.assign(title, { id: "success-title" }),
      h(
        "p",
        { class: "lead" },
        "Guarde os dois dados abaixo. ",
        h("strong", {}, "O código aparece só agora"),
        " e é necessário para acompanhar a demanda. Anote, copie ou tire uma foto da tela.",
      ),
      h(
        "dl",
        { class: "receipt" },
        h("dt", {}, "Número da demanda"),
        h("dd", { class: "protocol", id: "receipt-protocol" }, protocol),
        h("dt", {}, "Código de acompanhamento"),
        h(
          "dd",
          { class: "tracking-code", id: "receipt-code" },
          h("span", { "aria-hidden": "true" }, code),
          h("span", { class: "visually-hidden" }, spelled(code)),
        ),
      ),
      h(
        "div",
        { class: "actions" },
        copy,
        h(
          "a",
          {
            class: "button primary",
            href: `/portal/acompanhar?protocolo=${encodeURIComponent(protocol)}`,
          },
          "Acompanhar esta demanda",
        ),
      ),
      copied,
      h("p", {}, h("a", { href: "/portal" }, "Registrar outra demanda")),
    ),
  );
  focusHeading(title);
}

// ---------------------------------------------------------------- acompanhar
type Tracking = {
  protocol: string;
  category: string | null;
  neighborhood: string | null;
  status: { code: string; label: string; text: string };
  reason: string | null;
  steps: {
    code: string;
    label: string;
    done: boolean;
    current: boolean;
    at: string | null;
  }[];
};

async function trackingPageView() {
  document.title = "Acompanhar demanda | Portal do cidadão";
  const catalog = await loadCatalog();
  if (catalog === "off") return unavailable();
  if (catalog === "error") return loadFailed(trackingPageView);
  const title = h("h1", {}, "Acompanhar demanda");
  const protocol = h("input", {
    type: "text",
    name: "protocol",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    placeholder: "OC-2026-00012",
    maxlength: 40,
  });
  const code = h("input", {
    type: "text",
    name: "code",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    placeholder: "XXXX-XXXX-XXXX-XXXX",
    maxlength: 60,
  });
  protocol.value = new URLSearchParams(location.search).get("protocolo") ?? "";
  const error = h("div", {
    class: "error-summary",
    id: "track-error",
    role: "alert",
    tabindex: "-1",
    hidden: true,
  });
  const result = h("section", {
    class: "tracking-result",
    id: "tracking-result",
    "aria-live": "polite",
    hidden: true,
  });
  const submit = h(
    "button",
    { type: "submit", class: "button primary" },
    "Consultar",
  );
  const form = h(
    "form",
    { novalidate: true, class: "portal-form compact" },
    field("t-protocol", "Número da demanda", protocol, {
      required: true,
      hint: "Exemplo: OC-2026-00012.",
    }),
    field("t-code", "Código de acompanhamento", code, {
      required: true,
      hint: "Os 16 caracteres (letras e números) recebidos no registro. Maiúsculas, minúsculas, espaços e traços não fazem diferença.",
    }),
    submit,
  );
  const fail = (message: string, fieldErrors: [string, string][] = []) => {
    setFieldError("t-protocol", null);
    setFieldError("t-code", null);
    for (const [id, text] of fieldErrors) setFieldError(id, text);
    error.replaceChildren(h("p", {}, message));
    error.hidden = false;
    result.hidden = true;
    error.focus();
  };
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const missing: [string, string][] = [];
    if (!protocol.value.trim())
      missing.push(["t-protocol", "Informe o número da demanda."]);
    if (!code.value.trim())
      missing.push(["t-code", "Informe o código de acompanhamento."]);
    if (missing.length)
      return fail("Preencha o número e o código para consultar.", missing);
    busy = true;
    submit.disabled = true;
    submit.textContent = "Consultando…";
    try {
      const response = await request("/api/publico/acompanhar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol: protocol.value, code: code.value }),
      });
      const data = response.data as { error?: string; code?: string };
      if (response.status === 200) {
        error.hidden = true;
        setFieldError("t-protocol", null);
        setFieldError("t-code", null);
        showResult(result, response.data as unknown as Tracking);
        submit.textContent = "Atualizar";
        return;
      }
      if (response.status === 429)
        return fail(
          `${data.error ?? "Muitas consultas."} Tente de novo ${waitText(response.retryAfter)}.`,
        );
      if (response.status === 404 && data.code !== "TRACKING_NOT_FOUND")
        return unavailable();
      fail(
        data.error ?? "Não foi possível consultar agora. Tente de novo.",
        response.status === 404
          ? [["t-code", "Confira o número e o código."]]
          : [],
      );
    } catch {
      fail("A conexão falhou. Verifique a internet e tente de novo.");
    } finally {
      busy = false;
      submit.disabled = false;
      if (submit.textContent === "Consultando…")
        submit.textContent = "Consultar";
    }
  });
  render(
    title,
    h(
      "p",
      { class: "lead" },
      "Informe o número da demanda e o código de acompanhamento que você recebeu ao registrar.",
    ),
    error,
    form,
    result,
  );
  (protocol.value ? code : protocol).focus();
}

function showResult(container: HTMLElement, data: Tracking) {
  const heading = h(
    "h2",
    { id: "result-title" },
    `Situação: ${data.status.label}`,
  );
  container.replaceChildren(
    heading,
    h(
      "p",
      { class: `status-text status-${data.status.code}` },
      data.status.text,
    ),
    ...(data.reason
      ? [h("p", { class: "reason" }, h("strong", {}, "Motivo: "), data.reason)]
      : []),
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Número"),
      h("dd", {}, data.protocol),
      data.category ? h("dt", {}, "Tipo de problema") : null,
      data.category ? h("dd", {}, data.category) : null,
      data.neighborhood ? h("dt", {}, "Bairro") : null,
      data.neighborhood ? h("dd", {}, data.neighborhood) : null,
    ),
    h("h3", {}, "Etapas"),
    h(
      "ol",
      { class: "steps" },
      ...data.steps.map((step) =>
        h(
          "li",
          {
            class: [
              step.done ? "done" : "pending",
              step.current ? "current" : "",
            ]
              .join(" ")
              .trim(),
            "aria-current": step.current ? "step" : null,
          },
          h("span", { class: "step-label" }, step.label),
          h(
            "span",
            { class: "step-date" },
            step.at
              ? formatDate(step.at)
              : step.done
                ? "concluída"
                : "ainda não",
          ),
        ),
      ),
    ),
    h(
      "p",
      { class: "hint" },
      "A situação é atualizada pela equipe da Prefeitura. Volte a consultar quando quiser.",
    ),
  );
  container.setAttribute("aria-labelledby", "result-title");
  container.hidden = false;
  focusHeading(heading);
}

if (trackingPage) void trackingPageView();
else void registerPage();
