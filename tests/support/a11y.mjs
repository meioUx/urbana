// Auxiliares da auditoria automatizada de acessibilidade (tests/a11y-browser.mjs).
// Isto NÃO certifica conformidade WCAG: o axe cobre uma parte dos critérios; leitor de tela,
// usuários reais e aparelhos continuam exigindo avaliação humana.
import { AxeBuilder } from "@axe-core/playwright";

export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "best-practice",
];
const WCAG_TAG = /^wcag\d+(a|aa|aaa)$/;
const BLOCKING = new Set(["serious", "critical"]);

export class Report {
  constructor() {
    this.incomplete = new Map(); // regra -> telas em que o axe não conseguiu decidir (revisão humana)
    this.incompleteNodes = [];
    this.manualContrast = []; // contraste aproximado dos elementos que o axe não decidiu
    this.axe = []; // {screen, viewport, rule, impact, wcag, help, target, html, exception}
    this.screens = new Set();
    this.problems = []; // falhas dos complementos (teclado, alvo, reflow...)
    this.notes = []; // observações sem falha
    this.exceptions = []; // {rule, selector, reason}
    this.focusSeen = new Set(); // elementos que já mostraram indicador de foco
  }
  allow(rule, selector, reason) {
    this.exceptions.push({ rule, selector, reason });
  }
  fail(message) {
    this.problems.push(message);
  }
  note(message) {
    this.notes.push(message);
  }
}

function contrastData(node) {
  const data = (node.any || []).find((c) => c.id === "color-contrast")?.data;
  return data
    ? `${data.fgColor} on ${data.bgColor} = ${data.contrastRatio} (need ${data.expectedContrastRatio}) ${data.fontSize || ""}`
    : "";
}

async function matchesException(page, node, selector) {
  const target = node.target;
  if (target.length !== 1) return false;
  return page
    .evaluate(
      ([t, sel]) => {
        try {
          const el = document.querySelector(t);
          return Boolean(el && el.closest(sel));
        } catch {
          return false;
        }
      },
      [target[0], selector],
    )
    .catch(() => false);
}

/** Roda o axe (WCAG 2.1 A/AA e boas práticas) na página atual e registra as violações. */
export async function scan(report, page, screen, viewport, options = {}) {
  await page.waitForTimeout(options.settle ?? 350);
  report.screens.add(`${viewport} · ${screen}`);
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include) builder = builder.include(options.include);
  // O axe abre uma página em branco para fechar a análise; em Chrome essa página às vezes não
  // responde. Cada tentativa tem prazo curto; ao estourar, fecha as páginas em branco e repete.
  let result;
  for (let attempt = 1; !result; attempt++) {
    let timer;
    try {
      result = await Promise.race([
        builder.analyze(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 25000);
        }),
      ]);
    } catch (error) {
      if (error.message !== "timeout" || attempt >= 3)
        throw new Error(
          `axe falhou (${error.message}) em ${viewport} · ${screen}`,
          { cause: error },
        );
      for (const other of page.context().pages())
        if (other !== page && other.url() === "about:blank")
          await other.close().catch(() => {});
      builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
      if (options.include) builder = builder.include(options.include);
    } finally {
      clearTimeout(timer);
    }
  }
  for (const item of result.incomplete) {
    const where = report.incomplete.get(item.id) || {
      nodes: 0,
      screens: new Set(),
    };
    where.nodes += item.nodes.length;
    if (item.id === "color-contrast") {
      for (const node of item.nodes.slice(0, 80)) {
        if (
          node.target.length !== 1 ||
          /^(text|tspan|path)\b|\.leaflet-/.test(node.target[0])
        )
          continue;
        const manual = await page
          .evaluate(approxContrast, node.target[0])
          .catch(() => null);
        if (manual && manual.text)
          report.manualContrast.push({
            viewport,
            screen,
            target: node.target[0],
            ...manual,
          });
      }
    }
    for (const node of item.nodes.slice(0, 40))
      report.incompleteNodes.push({
        rule: item.id,
        viewport,
        screen,
        target: node.target.join(" >> "),
        html: node.html.slice(0, 140),
        message: (
          (node.any[0] || node.all[0] || node.none[0] || {}).message || ""
        ).slice(0, 160),
      });
    where.screens.add(`${viewport} · ${screen}`);
    report.incomplete.set(item.id, where);
  }
  for (const violation of result.violations) {
    const wcag = violation.tags.some((tag) => WCAG_TAG.test(tag));
    for (const node of violation.nodes) {
      let exception = "";
      for (const rule of report.exceptions) {
        if (
          rule.rule === violation.id &&
          (await matchesException(page, node, rule.selector))
        )
          exception = rule.reason;
      }
      report.axe.push({
        screen,
        viewport,
        rule: violation.id,
        impact: node.impact || violation.impact,
        wcag,
        help: violation.help,
        target: node.target.join(" >> "),
        html: node.html.slice(0, 160),
        colors:
          violation.id === "color-contrast" ? contrastData(node) : undefined,
        summary: (node.failureSummary || "")
          .split("\n")
          .slice(1, 3)
          .join(" ")
          .trim(),
        exception,
      });
    }
  }
}

export function summarize(report) {
  const open = report.axe.filter((v) => !v.exception);
  const by = (list) => {
    const rules = {};
    for (const v of list) {
      const key = `${v.rule} [${v.impact}${v.wcag ? "" : ", boa prática"}]`;
      rules[key] = (rules[key] || 0) + 1;
    }
    return rules;
  };
  const impacts = {};
  for (const v of open) impacts[v.impact] = (impacts[v.impact] || 0) + 1;
  return {
    screens: report.screens.size,
    nodes: open.length,
    byImpact: impacts,
    byRule: by(open),
    blocking: open.filter((v) => v.wcag && BLOCKING.has(v.impact)),
    excepted: report.axe.filter((v) => v.exception),
  };
}

// --------------------------------------------------------------------------- contraste manual

/**
 * Contraste aproximado de um elemento que o axe não conseguiu decidir (fundo sobreposto ou com
 * imagem): cor do texto contra a pilha de fundos opacos dos ancestrais. Devolve `image: true` quando
 * há imagem/gradiente na pilha (então o número é só indicativo).
 */
export const approxContrast = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    return a === 0
      ? [0, 0, 0, 0]
      : [0, 1, 2]
          .map(
            (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a,
          )
          .concat(a);
  };
  let bg = [255, 255, 255, 1];
  const stack = [];
  let image = false;
  for (let node = el; node; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (s.backgroundImage !== "none") image = true;
    const c = parse(s.backgroundColor);
    if (c[3] > 0) stack.push(c);
    if (c[3] === 1) break;
  }
  for (const layer of stack.reverse()) bg = over(layer, bg);
  const fg = over(parse(getComputedStyle(el).color), bg);
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const a = lum(fg);
  const b = lum(bg);
  const size = parseFloat(getComputedStyle(el).fontSize);
  const bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700;
  return {
    ratio:
      Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) /
      100,
    image,
    large: size >= 24 || (size >= 18.66 && bold),
    text: (el.innerText || "").trim().slice(0, 40),
  };
};

// --------------------------------------------------------------------------- teclado

/**
 * Indicador de foco visível do elemento focado. Compara o estilo do elemento com o de uma cópia
 * dele sem foco (não dá para tirar e devolver o foco: campos de data perderiam o segmento atual).
 */
const focusStyle = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const read = (node) => {
    const s = getComputedStyle(node);
    return [
      s.outlineStyle,
      s.outlineWidth,
      s.outlineColor,
      s.boxShadow,
      s.borderTopColor,
      s.borderBottomColor,
      s.borderLeftColor,
      s.backgroundColor,
      s.color,
      s.textDecorationLine,
    ].join("|");
  };
  const focused = read(el);
  const outline = getComputedStyle(el);
  const hasOutline =
    outline.outlineStyle !== "none" && parseFloat(outline.outlineWidth) > 0;
  const clone = el.cloneNode(false);
  clone.removeAttribute("id");
  clone.style.visibility = "hidden";
  el.after(clone);
  const blurred = read(clone);
  clone.remove();
  const rect = el.getBoundingClientRect();
  // Posição no conteúdo (soma a rolagem de todos os ancestrais), para comparar a ordem visual.
  let scrolled = 0;
  for (let p = el.parentElement; p; p = p.parentElement)
    scrolled += p.scrollTop;
  return {
    tag: el.tagName.toLowerCase(),
    type: el.type || "",
    name: (
      el.getAttribute("aria-label") ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.id ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60),
    changed: focused !== blurred,
    hasOutline,
    top: Math.round(rect.top + scrolled),
    left: Math.round(rect.left),
  };
};

/**
 * Percorre `steps` Tab e devolve os elementos focados. `scope` limita o teste de contenção
 * (ex.: "dialog[open], [role=dialog]").
 */
export async function tabThrough(page, steps, { scope, shift = false } = {}) {
  const visited = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
    const info = await page.evaluate(focusStyle);
    const inside = scope
      ? await page.evaluate(
          (sel) => Boolean(document.activeElement?.closest(sel)),
          scope,
        )
      : true;
    visited.push(
      info
        ? { ...info, inside }
        : {
            tag: "body",
            name: "",
            changed: true,
            hasOutline: false,
            top: 0,
            left: 0,
            inside: false,
          },
    );
  }
  return visited;
}

export const hasVisibleFocus = (entry) =>
  entry.tag === "body" || entry.changed || entry.hasOutline;

/** Pulos para cima maiores que a tolerância entre passos consecutivos (ordem de foco x ordem visual). */
export function visualOrderJumps(visited, tolerance = 6) {
  const jumps = [];
  for (let i = 1; i < visited.length; i++) {
    const a = visited[i - 1];
    const b = visited[i];
    if (a.tag === "body" || b.tag === "body") continue;
    if (b.top < a.top - tolerance)
      jumps.push(`${a.name || a.tag} -> ${b.name || b.tag}`);
  }
  return jumps;
}

// --------------------------------------------------------------------------- alvo de toque

/** Controles interativos menores que 24x24 CSS px (WCAG 2.2, 2.5.8), já aplicando as exceções de espaçamento e de link em texto. */
export const undersizedTargets = (root) => {
  const scope = root ? document.querySelector(root) : document.body;
  if (!scope) return [];
  const selector =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (
      s.visibility === "hidden" ||
      s.display === "none" ||
      s.pointerEvents === "none"
    )
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const box = (el) => {
    let target = el;
    if (el.tagName === "INPUT" && /checkbox|radio/.test(el.type)) {
      const label =
        el.closest("label") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (label) target = label;
    }
    // Entrada de arquivo escondida: o rótulo/botão é o alvo.
    const r = target.getBoundingClientRect();
    return { el: target, x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const inline = (el) => {
    if (el.tagName !== "A") return false;
    const parent = el.parentElement;
    if (!parent) return false;
    const own = [...parent.childNodes].filter(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    return getComputedStyle(el).display === "inline" && own.length > 0;
  };
  const items = [...scope.querySelectorAll(selector)]
    .filter(
      (el) =>
        visible(el) &&
        !el.disabled &&
        !el.closest("[inert]") &&
        !(el.tagName === "INPUT" && el.type === "file"),
    )
    .map(box);
  const dedupe = new Map();
  for (const item of items) dedupe.set(item.el, item);
  const targets = [...dedupe.values()];
  const small = targets.filter(
    (t) => (t.w < 23.5 || t.h < 23.5) && !inline(t.el),
  );
  const circle = (t) => ({ cx: t.x + t.w / 2, cy: t.y + t.h / 2, r: 12 });
  const out = [];
  for (const t of small) {
    const c = circle(t);
    let crowded = false;
    for (const other of targets) {
      if (other === t || other.el.contains(t.el) || t.el.contains(other.el))
        continue;
      const smallOther = other.w < 23.5 || other.h < 23.5;
      if (smallOther) {
        const o = circle(other);
        if (Math.hypot(o.cx - c.cx, o.cy - c.cy) < 24) crowded = true;
      } else {
        const nx = Math.max(other.x, Math.min(c.cx, other.x + other.w));
        const ny = Math.max(other.y, Math.min(c.cy, other.y + other.h));
        if (Math.hypot(nx - c.cx, ny - c.cy) < c.r) crowded = true;
      }
      if (crowded) break;
    }
    if (crowded || t.w < 1) {
      const el = t.el;
      out.push({
        tag: el.tagName.toLowerCase(),
        name: (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.innerText ||
          el.getAttribute("name") ||
          el.id ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 50),
        cls: String(el.className || "").slice(0, 40),
        w: Math.round(t.w * 10) / 10,
        h: Math.round(t.h * 10) / 10,
      });
    }
  }
  return out;
};

// --------------------------------------------------------------------------- reflow

/** Conteúdo que ultrapassa a largura da janela fora de um contêiner com rolagem própria. */
export const overflowReport = () => {
  const vw = document.documentElement.clientWidth;
  const pageScroll = document.documentElement.scrollWidth > vw + 1;
  const scrollable = (el) => {
    for (
      let p = el.parentElement;
      p && p !== document.documentElement;
      p = p.parentElement
    ) {
      const s = getComputedStyle(p);
      if (
        /(auto|scroll|hidden|clip)/.test(s.overflowX) &&
        p.clientWidth < p.scrollWidth + 1
      )
        return true;
      if (/(auto|scroll)/.test(s.overflowX)) return true;
    }
    return false;
  };
  const offenders = [];
  for (const el of document.body.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    if (
      s.display === "none" ||
      s.visibility === "hidden" ||
      s.position === "fixed"
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && !scrollable(el)) {
      offenders.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} (${Math.round(r.right)}px)`,
      );
      if (offenders.length >= 6) break;
    }
  }
  // Texto cortado por overflow oculto (perda de conteúdo), ignorando reticências deliberadas.
  const clipped = [];
  for (const el of document.body.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    if (
      !/(hidden|clip)/.test(s.overflowX + s.overflowY) ||
      s.textOverflow === "ellipsis"
    )
      continue;
    if (
      el.closest(".leaflet-container, svg, .visually-hidden") ||
      el.clientWidth <= 2
    )
      continue;
    if (
      el.scrollWidth > el.clientWidth + 2 &&
      el.clientWidth > 0 &&
      (el.innerText || "").trim()
    ) {
      clipped.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} (${el.scrollWidth}>${el.clientWidth})`,
      );
      if (clipped.length >= 6) break;
    }
  }
  return {
    pageScroll,
    scrollWidth: document.documentElement.scrollWidth,
    vw,
    offenders,
    clipped,
  };
};

// --------------------------------------------------------------------------- movimento

/**
 * Movimento na página: animações em execução (infinitas ou não), elementos com animação ou
 * transição declaradas (estilo calculado) e rolagem suave. Ignora o interior do Leaflet (terceiro).
 */
export const motionReport = () => {
  const running = document
    .getAnimations()
    .filter((a) => a.playState === "running")
    .map((a) => {
      const t = a.effect?.getComputedTiming?.();
      return {
        name: a.animationName || a.transitionProperty || "?",
        infinite: t?.iterations === Infinity,
        duration: Math.round(Number(t?.duration) || 0),
        target:
          a.effect?.target?.className?.toString().slice(0, 40) ||
          a.effect?.target?.tagName,
      };
    });
  const seconds = (value) =>
    Math.max(
      0,
      ...String(value)
        .split(",")
        .map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 0.001 : 1) || 0),
    );
  const animated = [];
  const transitions = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(".leaflet-container")) continue;
    const s = getComputedStyle(el);
    if (s.display === "none") continue;
    const label = `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(" ")[0]}`;
    if (s.animationName !== "none" && seconds(s.animationDuration) > 0.01)
      animated.push(`${label} ${s.animationName} ${s.animationDuration}`);
    if (
      s.transitionProperty !== "none" &&
      s.transitionProperty !== "all" &&
      seconds(s.transitionDuration) > 0.2
    )
      transitions.push(
        `${label} ${s.transitionProperty} ${s.transitionDuration}`,
      );
    else if (
      s.transitionProperty === "all" &&
      seconds(s.transitionDuration) > 0.2
    )
      transitions.push(`${label} all ${s.transitionDuration}`);
  }
  return {
    running,
    animated,
    transitions,
    smoothScroll:
      getComputedStyle(document.documentElement).scrollBehavior === "smooth",
  };
};
