import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { api } from "../../shared/api";
import { Field } from "../../shared/ui";

type PortalSettings = {
  enabled: boolean;
  consent_text: string;
  create_per_ip_hour: number;
  track_per_ip_15min: number;
  global_per_hour: number;
  min_fill_seconds: number;
  forced_off?: boolean;
  defaults?: Omit<PortalSettings, "forced_off" | "defaults">;
};

/** Administração > Configurações: portal do cidadão (registro público e acompanhamento por protocolo). */
export default function PortalSettingsForm({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [settings, setSettings] = useState<PortalSettings | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const reportError = useRef(onError);
  useEffect(() => {
    reportError.current = onError;
  });
  useEffect(() => {
    api("/settings/portal").then(setSettings, (e: Error) =>
      reportError.current(e.message),
    );
  }, []);
  if (!settings)
    return (
      <p className="muted">Carregando configurações do portal do cidadão…</p>
    );
  const set = (key: keyof PortalSettings, value: unknown) => {
    setSaved("");
    setSettings({ ...settings, [key]: value });
  };
  const number = (
    key: keyof PortalSettings,
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label}>
      <input
        required
        type="number"
        min={min}
        max={max}
        step={1}
        value={String(settings[key])}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </Field>
  );
  return (
    <form
      className="settings-form portal-settings"
      aria-labelledby="portal-settings-title"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const {
            enabled,
            consent_text,
            create_per_ip_hour,
            track_per_ip_15min,
            global_per_hour,
            min_fill_seconds,
          } = settings;
          const result = await api("/settings/portal", "PATCH", {
            enabled,
            consent_text,
            create_per_ip_hour,
            track_per_ip_15min,
            global_per_hour,
            min_fill_seconds,
          });
          setSettings(result);
          setSaved(
            result.enabled
              ? "Configurações do portal salvas. O portal está ligado."
              : "Configurações do portal salvas. O portal está desligado.",
          );
        } catch (error) {
          onError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="portal-settings-title">Portal do cidadão</h2>
      <p className="muted">
        Registro público de demandas em{" "}
        <a href="/portal" target="_blank" rel="noreferrer">
          /portal
        </a>{" "}
        e acompanhamento por número e código em{" "}
        <a href="/portal/acompanhar" target="_blank" rel="noreferrer">
          /portal/acompanhar
        </a>
        . As demandas entram na triagem com a origem “Portal do cidadão”.
      </p>
      {settings.forced_off && (
        <div className="notice error" role="status">
          <span>
            O portal está desligado pela variável de ambiente{" "}
            <code>URBANA_PUBLIC_PORTAL=off</code> do servidor, que tem
            precedência sobre esta tela.
          </span>
        </div>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        Portal ligado (aceita registros e consultas públicas)
      </label>
      <Field label="Texto de finalidade e consentimento (LGPD)">
        <textarea
          required
          minLength={50}
          maxLength={3000}
          rows={7}
          value={settings.consent_text}
          onChange={(e) => set("consent_text", e.target.value)}
        />
      </Field>
      {number("create_per_ip_hour", "Envios por conexão (IP) por hora", 1, 100)}
      {number(
        "track_per_ip_15min",
        "Consultas de protocolo por conexão (IP) a cada 15 minutos",
        5,
        500,
      )}
      {number(
        "global_per_hour",
        "Demandas aceitas por hora no portal inteiro",
        1,
        10000,
      )}
      {number(
        "min_fill_seconds",
        "Tempo mínimo de preenchimento do formulário (segundos)",
        0,
        120,
      )}
      <p role="status" className="muted">
        {saved}
      </p>
      <button className="button primary" disabled={busy}>
        <Check size={16} />
        Salvar portal do cidadão
      </button>
    </form>
  );
}
