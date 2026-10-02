import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Compass,
  GraduationCap,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getJourney,
  getTutorial,
  getTutorials,
  operationFlow,
  ONBOARDING_VERSION,
  type GuideStep,
} from "../../shared/onboarding.mjs";
import { hasModuleAccess } from "../../shared/authorization.mjs";
import "./onboarding.css";
type Props = {
  user: any;
  initial: any;
  api: (path: string, method?: string, body?: any) => Promise<any>;
  entry: "welcome" | "help";
  onClose: () => void;
};
type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};
const visible = (element: HTMLElement | null) =>
  element &&
  element.getClientRects().length > 0 &&
  getComputedStyle(element).visibility !== "hidden";
export function findGuideTarget(step: GuideStep) {
  const primary = document.querySelector<HTMLElement>(step.target);
  if (visible(primary)) return { element: primary!, fallback: false };
  const fallback = step.fallback
    ? document.querySelector<HTMLElement>(step.fallback)
    : null;
  return visible(fallback) ? { element: fallback!, fallback: true } : null;
}
export default function Training({
  user,
  initial,
  api,
  entry,
  onClose,
}: Props) {
  const signature =
    user.role + ":" + [...(user.modules || [])].sort().join(",");
  const journey = useMemo(() => getJourney(user), [signature]);
  const tutorials = useMemo(() => getTutorials(user), [signature]);
  const [phase, setPhase] = useState<
      "welcome" | "role" | "help" | "tour" | "finish"
    >(entry),
    [tutorialId, setTutorialId] = useState("main"),
    [index, setIndex] = useState(0),
    [position, setPosition] = useState<Rect | null>(null),
    [fallback, setFallback] = useState(false),
    [savingError, setSavingError] = useState(""),
    [seen, setSeen] = useState<any[]>([]),
    [pending, setPending] = useState(false),
    [visited, setVisited] = useState<string[]>([]);
  const tutorial = useMemo(
    () => getTutorial(user, tutorialId),
    [signature, tutorialId],
  );
  const steps = tutorial?.steps || [];
  const step = steps[index];
  const layer = useRef<HTMLDivElement>(null),
    card = useRef<HTMLElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    lastFailed = useRef<any>(null),
    saveQueue = useRef(Promise.resolve()),
    request = useRef(0),
    nextLock = useRef(false),
    lastSignature = useRef(signature);
  const [cardSize, setCardSize] = useState({ width: 400, height: 400 }),
    [viewport, setViewport] = useState({
      width: window.innerWidth,
      height: window.innerHeight,
      top: 0,
      left: 0,
    });
  const record = useCallback(
    (
      event: string,
      id = tutorialId,
      stepId: string | null = step?.id || null,
    ) => {
      const payload = {
        version: ONBOARDING_VERSION,
        tutorial_id: id,
        event,
        step_id: stepId,
      };
      const next = saveQueue.current
        .then(() => api("/onboarding", "PATCH", payload))
        .then(() => {
          lastFailed.current = null;
          setSavingError("");
          if (event === "completed" && id !== "main")
            setSeen((old) => [
              ...old.filter((t) => t.tutorial_id !== id),
              { tutorial_id: id, status: "completed" },
            ]);
        })
        .catch(() => {
          lastFailed.current = payload;
          setSavingError(
            "Não foi possível salvar seu progresso. Você pode continuar e tentar novamente.",
          );
        });
      saveQueue.current = next;
      return next;
    },
    [api, tutorialId, step?.id],
  );
  const close = useCallback(
    (skip = false) => {
      if (skip && steps.length) void record("skipped");
      window.dispatchEvent(new CustomEvent("urbana:onboarding-end"));
      onClose();
    },
    [onClose, record, steps.length],
  );
  useEffect(() => {
    api("/onboarding")
      .then((data) => setSeen(data.tutorials || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement;
    const siblings = Array.from(document.body.children).filter(
      (e) => e !== layer.current,
    ) as HTMLElement[];
    const values = siblings.map((e) => e.inert);
    siblings.forEach((e) => {
      e.inert = true;
    });
    return () => {
      siblings.forEach((e, i) => {
        e.inert = values[i];
      });
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : document.querySelector<HTMLElement>('[data-guide="help"]');
      target?.focus();
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      card.current?.querySelector<HTMLElement>("button")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [phase, index, pending]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(phase !== "help" && phase !== "finish");
        return;
      }
      if (e.key === "Tab") {
        const controls = Array.from(
          card.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
          ) || [],
        ).filter((e) => visible(e));
        const first = controls[0],
          last = controls.at(-1);
        if (!first) return;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !card.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !card.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [close, phase]);
  useLayoutEffect(() => {
    const resize = () => {
      const v = window.visualViewport;
      setViewport({
        width: v?.width || innerWidth,
        height: v?.height || innerHeight,
        top: v?.offsetTop || 0,
        left: v?.offsetLeft || 0,
      });
      if (card.current)
        setCardSize({
          width: card.current.offsetWidth,
          height: card.current.offsetHeight,
        });
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [phase, index, pending]);
  useEffect(() => {
    document.body.classList.toggle("urbana-training-active", phase === "tour");
    return () => document.body.classList.remove("urbana-training-active");
  }, [phase]);
  useEffect(() => {
    if (phase !== "tour") return;
    if (!step) {
      if (visited.length) void record("completed", tutorialId, visited.at(-1));
      setPhase("finish");
      return;
    }
    if (!hasModuleAccess(user, step.module)) {
      close();
      return;
    }
    const generation = ++request.current;
    setPosition(null);
    setPending(true);
    window.dispatchEvent(
      new CustomEvent("urbana:onboarding-navigate", { detail: { step } }),
    );
    let cancelled = false,
      attempt = 0,
      element: HTMLElement | null = null;
    const measure = () => {
      if (!element?.isConnected || !visible(element)) {
        setPosition(null);
        return;
      }
      const r = element.getBoundingClientRect();
      const left = Math.max(6, r.left - 5),
        top = Math.max(6, r.top - 5),
        right = Math.min(innerWidth - 6, r.right + 5),
        bottom = Math.min(innerHeight - 6, r.bottom + 5);
      setPosition({
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      });
    };
    const timer = window.setInterval(() => {
      if (cancelled || generation !== request.current) return;
      attempt++;
      const match = findGuideTarget(step);
      // Give lazy modules and record reads time to render before using a real fallback.
      if (match && (!match.fallback || attempt >= 12)) {
        window.clearInterval(timer);
        element = match.element;
        setFallback(match.fallback);
        element.scrollIntoView({
          block: innerWidth < 700 ? "start" : "center",
          behavior: "instant",
        });
        measure();
        setPending(false);
        nextLock.current = false;
        setVisited((old) => (old.includes(step.id) ? old : [...old, step.id]));
        void record("progress", tutorialId, step.id);
      } else if (attempt >= 20) {
        window.clearInterval(timer);
        setPending(false);
        setIndex((i) => i + 1);
      }
    }, 80);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const mutations = new MutationObserver(() => {
      if (element && !element.isConnected) {
        const replacement = findGuideTarget(step);
        if (replacement) {
          element = replacement.element;
          setFallback(replacement.fallback);
          measure();
        } else {
          element = null;
          setPosition(null);
          setIndex((i) => i + 1);
        }
      }
    });
    mutations.observe(document.getElementById("root") || document.body, {
      childList: true,
      subtree: true,
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      mutations.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [phase, index, signature, tutorialId]);
  useEffect(() => {
    if (!journey?.steps.length && phase !== "help") close();
    else if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      setPhase("help");
      setIndex(0);
      setPosition(null);
    }
  }, [signature]);
  function start(id: string, replay = true) {
    const current = getTutorial(user, id);
    if (!current?.steps.length) return;
    setVisited([]);
    nextLock.current = false;
    setTutorialId(id);
    setIndex(
      !replay && id === "main"
        ? Math.max(
            0,
            current.steps.findIndex((s) => s.id === initial?.step_id),
          )
        : 0,
    );
    setPhase("tour");
    void record(replay ? "replayed" : "started", id, null);
  }
  async function next() {
    if (pending || nextLock.current) return;
    nextLock.current = true;
    setPending(true);
    if (tutorialId === "main" && step)
      void record("completed", "task:" + step.id, step.id);
    if (index >= steps.length - 1) {
      await record("completed", tutorialId, step?.id || null);
      setPhase("finish");
      setPosition(null);
      setPending(false);
      nextLock.current = false;
    } else setIndex((i) => i + 1);
  }
  const mobile = viewport.width < 700;
  let cardStyle: any =
    phase === "tour"
      ? {
          position: "fixed",
          width: Math.min(420, viewport.width - 24),
          maxHeight: Math.max(180, viewport.height - 32),
          left: viewport.left + Math.max(12, (viewport.width - 420) / 2),
          bottom: 16,
        }
      : undefined;
  if (phase === "tour" && position && !mobile) {
    const roomRight = position.right + cardSize.width + 24 < viewport.width;
    const roomLeft = position.left - cardSize.width - 24 > 0;
    let left = roomRight
      ? position.right + 16
      : roomLeft
        ? position.left - cardSize.width - 16
        : Math.max(
            12,
            Math.min(position.left, viewport.width - cardSize.width - 12),
          );
    let top =
      roomRight || roomLeft
        ? Math.max(
            12,
            Math.min(position.top, viewport.height - cardSize.height - 12),
          )
        : position.bottom + 16 + cardSize.height < viewport.height
          ? position.bottom + 16
          : position.top - cardSize.height - 16 > 12
            ? position.top - cardSize.height - 16
            : viewport.height - cardSize.height - 12;
    cardStyle = {
      ...cardStyle,
      left: viewport.left + left,
      top: viewport.top + top,
      bottom: "auto",
    };
  } else if (phase === "tour" && mobile) {
    cardStyle = {
      ...cardStyle,
      maxHeight: viewport.height * 0.53,
      bottom: "auto",
      top:
        viewport.top +
        viewport.height -
        Math.min(cardSize.height, viewport.height * 0.53) -
        12,
    };
  }
  const flow = (items: string[], active: string | undefined) => (
    <ol className="onboarding-flow" aria-label="Etapas da sua jornada">
      {items.map((label, i) => (
        <li
          key={label}
          className={
            label === active
              ? "is-current"
              : items.indexOf(active || "") > i
                ? "is-done"
                : ""
          }
          aria-current={label === active ? "step" : undefined}
        >
          {items.indexOf(active || "") > i && <Check size={12} />}
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
  return createPortal(
    <div
      className={"onboarding-layer " + (phase === "tour" ? "is-tour" : "")}
      ref={layer}
      data-onboarding-phase={phase}
      data-onboarding-step={phase === "tour" ? step?.id : undefined}
    >
      {phase === "tour" && position ? (
        <>
          <div
            className="onboarding-shade"
            style={{ top: 0, left: 0, right: 0, height: position.top }}
          />
          <div
            className="onboarding-shade"
            style={{
              top: position.top,
              left: 0,
              width: position.left,
              height: position.height,
            }}
          />
          <div
            className="onboarding-shade"
            style={{
              top: position.top,
              left: position.right,
              right: 0,
              height: position.height,
            }}
          />
          <div
            className="onboarding-shade"
            style={{ top: position.bottom, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="onboarding-highlight"
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              height: position.height,
            }}
          />
        </>
      ) : (
        <div className="onboarding-shade" style={{ inset: 0 }} />
      )}
      <section
        ref={card}
        className={
          "onboarding-card " + (phase === "tour" ? "onboarding-tooltip" : "")
        }
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        tabIndex={-1}
      >
        <button
          className="onboarding-close"
          aria-label={
            phase === "tour"
              ? "Pular tour"
              : phase === "help"
                ? "Fechar central de ajuda"
                : "Fechar apresentação"
          }
          onClick={() => close(phase !== "help" && phase !== "finish")}
        >
          <X size={20} />
        </button>
        {phase === "welcome" && (
          <>
            <div className="onboarding-symbol">
              <Compass size={30} />
            </div>
            <p className="onboarding-eyebrow">
              GESTÃO URBANA, DO CHAMADO À ENTREGA.
            </p>
            <h1 id="onboarding-title">Bem-vindo ao Urbana</h1>
            <p id="onboarding-description">
              Vamos apresentar rapidamente as ferramentas disponíveis para o seu
              perfil.
            </p>
            <div className="onboarding-person">
              <strong>Olá, {user.name.split(" ")[0]} 👋</strong>
              <span>{user.role}</span>
              <p>{journey?.description}</p>
            </div>
            {user.role === "Administrador" && (
              <p className="onboarding-note">
                Vamos preparar o Urbana. Conheça como organizar a estrutura e os
                acessos da sua equipe.
              </p>
            )}
            <div className="onboarding-actions">
              <button className="button secondary" onClick={() => close(true)}>
                Pular por enquanto
              </button>
              <button
                className="button primary"
                onClick={() => setPhase("role")}
              >
                Conhecer o Urbana
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {phase === "role" && (
          <>
            <div className="onboarding-symbol">
              <GraduationCap size={30} />
            </div>
            <p className="onboarding-eyebrow">CONHEÇA SUA FUNÇÃO</p>
            <h1 id="onboarding-title">Como o Urbana funciona</h1>
            <p id="onboarding-description">
              Uma demanda passa por análise e programação, é executada em campo
              e depois conferida.
            </p>
            <ol className="onboarding-operation" aria-label="Fluxo do Urbana">
              {operationFlow.map((label, i) => (
                <li
                  key={label}
                  className={
                    journey?.participation.includes(i) ? "is-current" : ""
                  }
                >
                  {label}
                  {journey?.participation.includes(i) && (
                    <small>Você atua aqui</small>
                  )}
                </li>
              ))}
            </ol>
            {!journey?.participation.length && (
              <p className="onboarding-note">
                {user.role === "Administrador"
                  ? "Você prepara e mantém a estrutura que apoia todo o fluxo."
                  : "Você acompanha as informações disponíveis ao longo do fluxo."}
              </p>
            )}
            <h2>{journey?.title}</h2>
            <p>{journey?.description}</p>
            {flow(journey?.workflow || [], undefined)}
            <div className="onboarding-actions">
              <button className="button secondary" onClick={() => close(true)}>
                Pular por enquanto
              </button>
              <button
                className="button primary"
                onClick={() => start("main", false)}
              >
                {initial?.step_id
                  ? "Continuar meu fluxo"
                  : "Aprender meu fluxo"}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {phase === "help" && (
          <>
            <div className="onboarding-symbol">
              <BookOpen size={30} />
            </div>
            <p className="onboarding-eyebrow">
              AJUDA • {user.role.toLocaleUpperCase("pt-BR")}
            </p>
            <h1 id="onboarding-title">Como usar o Urbana</h1>
            <p id="onboarding-description">
              Aprenda sua parte do trabalho e consulte um tutorial quando
              precisar.
            </p>
            {journey?.steps.length ? (
              <>
                <button
                  className="onboarding-journey-button"
                  onClick={() => start("main")}
                >
                  <GraduationCap />
                  <span>
                    <strong>Conhecer o Urbana</strong>
                    <small>
                      {journey.title} · {journey.steps.length} etapas
                    </small>
                  </span>
                  <ArrowRight />
                </button>
                <div className="onboarding-tutorials">
                  {tutorials.map((t) => (
                    <button
                      key={t.id}
                      aria-label={t.title}
                      onClick={() => start(t.id)}
                    >
                      <span>{t.title}</span>
                      {seen.some(
                        (v) =>
                          (v.tutorial_id === t.id && v.completed_at) ||
                          (v.tutorial_id === t.id && v.status === "completed"),
                      ) ? (
                        <CheckCircle2
                          size={18}
                          aria-label="Tutorial já visto"
                        />
                      ) : (
                        <ArrowRight size={18} />
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="onboarding-note">
                Sem módulos disponíveis. Seu usuário não possui módulos
                liberados no momento. Entre em contato com o administrador do
                sistema.
              </p>
            )}
            <div className="onboarding-actions">
              <button className="button secondary" onClick={() => close()}>
                Fechar ajuda
              </button>
            </div>
          </>
        )}
        {phase === "tour" && (
          <>
            <p className="onboarding-eyebrow">
              APRENDA SEU FLUXO • {user.role.toLocaleUpperCase("pt-BR")}
            </p>
            <h2 id="onboarding-title">
              {pending ? "Preparando a próxima etapa…" : step?.title}
            </h2>
            <div id="onboarding-description" aria-live="polite">
              {!pending && (
                <>
                  <p>{step?.description}</p>
                  {fallback && (
                    <p className="onboarding-note">
                      {step?.module === "field"
                        ? "A ação aparece quando houver uma tarefa no estado correspondente. Quando uma tarefa for atribuída à sua equipe, ela aparecerá aqui."
                        : "Se não houver registro no estado correspondente, esta área ficará vazia. Use estas orientações quando o atendimento estiver disponível."}
                    </p>
                  )}
                  {step?.transition && (
                    <div className="onboarding-transition">
                      {step.transition.map((state, i) => (
                        <span key={state}>
                          {i > 0 && " → "}
                          {
                            (
                              {
                                PROGRAMADA: "Programada",
                                EM_DESLOCAMENTO: "Em deslocamento",
                                EM_EXECUCAO: "Em execução",
                                AGUARDANDO_VALIDACAO: "Aguardando validação",
                                DEVOLVIDA: "Devolvida",
                                CONCLUIDA: "Concluída",
                              } as Record<string, string>
                            )[state]
                          }
                        </span>
                      ))}
                    </div>
                  )}
                  {flow(tutorial?.workflow || [], step?.stage)}
                </>
              )}
            </div>
            {step?.map && !pending && (
              <button
                className="onboarding-map-link"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("urbana:onboarding-navigate", {
                      detail: { step: { ...step, fullMap: true } },
                    }),
                  )
                }
              >
                Abrir mapa completo
                <ArrowRight size={14} />
              </button>
            )}
            <p className="onboarding-safe">
              <ShieldCheck size={14} />
              Durante o guia, apenas observamos a interface.
            </p>
            <div className="onboarding-progress" aria-label="Progresso">
              <span>
                {Math.min(index + 1, steps.length)} de {steps.length}
              </span>
              <button className="text-button" onClick={() => close(true)}>
                Pular tour
              </button>
            </div>
            <div className="onboarding-actions">
              <button
                className="button secondary"
                disabled={index === 0 || pending}
                onClick={() => setIndex((i) => i - 1)}
              >
                Voltar
              </button>
              <button
                className="button primary"
                disabled={pending}
                onClick={() => void next()}
              >
                {index >= steps.length - 1 ? "Concluir" : "Próximo"}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {phase === "finish" && (
          <>
            <div className="onboarding-symbol">
              <CheckCircle2 size={32} />
            </div>
            <p className="onboarding-eyebrow">SEU PRÓXIMO PASSO</p>
            <h1 id="onboarding-title">
              {visited.length
                ? "Tudo pronto!"
                : "Nenhuma etapa disponível nesta tela"}
            </h1>
            <p id="onboarding-description">
              {visited.length
                ? "Você já conhece o essencial para começar a utilizar o Urbana."
                : "Você pode trabalhar normalmente e voltar à Ajuda quando as ferramentas estiverem disponíveis."}
            </p>
            {visited.length > 0 && <h2>Agora você já sabe como:</h2>}
            <ul className="onboarding-checklist">
              {steps
                .filter((s) => visited.includes(s.id))
                .map((s) => (
                  <li key={s.id}>
                    <Check size={16} />
                    {s.checklist || s.title}
                  </li>
                ))}
            </ul>
            {flow(tutorial?.workflow || [], undefined)}
            <p className="onboarding-note">{journey?.handoff}</p>
            <p>
              Você pode rever seu fluxo ou apenas um tutorial em{" "}
              <strong>Ajuda → Como usar o Urbana</strong>.
            </p>
            <div className="onboarding-actions">
              <button
                className="button secondary"
                onClick={() => {
                  setPhase("help");
                  setPosition(null);
                }}
              >
                Voltar à ajuda
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const first = steps[0];
                  if (first)
                    window.dispatchEvent(
                      new CustomEvent("urbana:onboarding-navigate", {
                        detail: {
                          step: {
                            ...first,
                            detail: undefined,
                            filter: undefined,
                          },
                        },
                      }),
                    );
                  close();
                }}
              >
                {tutorialId === "main" ? journey?.cta : "Começar"}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {savingError && (
          <div className="onboarding-save-warning" role="status">
            {savingError}
            <button
              className="text-button"
              onClick={() => {
                const payload = lastFailed.current;
                if (payload)
                  void record(
                    payload.event,
                    payload.tutorial_id,
                    payload.step_id,
                  );
              }}
            >
              Tentar salvar progresso
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
