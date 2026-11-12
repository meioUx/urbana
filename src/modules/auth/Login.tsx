import { useState } from "react";
import { Field } from "../../shared/ui";
import { GeoMap } from "../map/LazyGeoMap";
import { ArrowRight, Building2 } from "lucide-react";

export default function Login({
  onLogin,
  error: outer,
}: {
  onLogin: (e: string, p: string) => Promise<void>;
  error: string;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-content">
        <a className="brand">
          <span className="brand-icon">
            <Building2 size={29} />
          </span>
          <span>
            urbana<small>GESTÃO MUNICIPAL</small>
          </span>
        </a>
        <div className="login-form">
          <p className="eyebrow">MANUTENÇÃO URBANA</p>
          <h1>Acesso à plataforma</h1>
          <p className="subtitle">Entre com sua conta municipal.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await onLogin(email, password);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="E-mail">
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.nome@municipio.gov.br"
              />
            </Field>
            <Field label="Senha">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {(error || outer) && (
              <p className="form-error" role="alert">
                {error || outer}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Entrando..." : "Entrar"}
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
        <small className="muted">
          Plataforma Municipal de Gestão de Manutenção Urbana
        </small>
      </div>
      <div className="login-map">
        <GeoMap rows={[]} large />
        <div className="login-caption">
          <span className="eyebrow">TERRITÓRIO CONECTADO</span>
          <h2>
            Cuidado com a cidade.
            <br />
            Do registro à resolução.
          </h2>
        </div>
      </div>
    </main>
  );
}
