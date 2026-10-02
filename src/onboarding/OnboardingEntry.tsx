import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { hasModuleAccess, moduleCatalog } from "../../shared/authorization.mjs";
import { ONBOARDING_VERSION } from "../../shared/onboarding-version.mjs";
const Training = lazy(() => import("./Training"));
export default function OnboardingEntry({ boot, api }: any) {
  const [entry, setEntry] = useState<"welcome" | "help" | null>(null);
  const allowed = moduleCatalog.some((m) => hasModuleAccess(boot.user, m.key));
  const key = "urbana:onboarding:" + boot.user.id + ":" + ONBOARDING_VERSION;
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(key) === "dismissed";
    } catch {}
    if (
      allowed &&
      !dismissed &&
      (!boot.onboarding ||
        ["not_started", "started"].includes(boot.onboarding.status))
    )
      setEntry("welcome");
  }, [key, allowed, boot.onboarding?.status]);
  const close = () => {
    try {
      sessionStorage.setItem(key, "dismissed");
    } catch {}
    setEntry(null);
  };
  return createPortal(
    <>
      <div className="urbana-help-host">
        <button
          className="urbana-help-button"
          data-guide="help"
          aria-label="Ajuda: Como usar o Urbana"
          onClick={() => setEntry("help")}
        >
          <CircleHelp size={18} />
          <span>Ajuda</span>
        </button>
      </div>
      {entry && (
        <Suspense
          fallback={
            <div className="onboarding-loading" role="status">
              Carregando ajuda…{" "}
              <button className="button secondary" onClick={close}>
                Fechar
              </button>
            </div>
          }
        >
          <Training
            key={key + entry}
            user={boot.user}
            initial={boot.onboarding}
            api={api}
            entry={entry}
            onClose={close}
          />
        </Suspense>
      )}
    </>,
    document.body,
  );
}
