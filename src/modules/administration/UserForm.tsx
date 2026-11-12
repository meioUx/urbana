import { useState } from "react";
import {
  isMasterUser,
  moduleCatalog,
  defaultModules,
  canRoleAccessModule,
} from "../../../shared/authorization.mjs";
import type { Boot } from "../../shared/types";
import { Field, Modal } from "../../shared/ui";
import { Plus } from "lucide-react";

export default function UserForm({
  user,
  boot,
  onClose,
  onSave,
}: {
  boot: Boot;
  user?: any;
  onClose: () => void;
  onSave: (d: any) => Promise<void>;
}) {
  const [d, setD] = useState<any>({
      name: "",
      email: "",
      password: "",
      role: user?.role || "Consulta",
      modules: user?.modules || defaultModules("Consulta"),
      team_id: user?.team_id || null,
      ...(user ? { name: user.name, email: user.email } : {}),
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const master = isMasterUser(user);
  return (
    <Modal title={user ? "Editar usuário" : "Novo usuário"} onClose={onClose}>
      <form
        data-guide="user-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { password, ...data } = d;
            await onSave(user ? data : d);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {[
          ["name", "Nome", "text"],
          ["email", "E-mail", "email"],
          ["password", "Senha (mínimo 10 caracteres)", "password"],
        ]
          .filter(([k]) => !user || k !== "password")
          .map(([k, l, t]) => (
            <Field key={k} label={l}>
              <input
                required
                type={t}
                readOnly={master && k === "email"}
                minLength={k === "password" ? 10 : 2}
                autoComplete={k === "password" ? "new-password" : "off"}
                value={d[k]}
                onChange={(e) => setD({ ...d, [k]: e.target.value })}
              />
            </Field>
          ))}
        <Field label="Perfil">
          <select
            disabled={master}
            value={d.role}
            onChange={(e) => {
              const role = e.target.value;
              const removed = d.modules.filter(
                (m: string) => !canRoleAccessModule(role, m),
              );
              setD({
                ...d,
                role,
                team_id: role === "Equipe de Campo" ? d.team_id : null,
                modules: user
                  ? d.modules.filter((m: string) =>
                      canRoleAccessModule(role, m),
                    )
                  : defaultModules(role),
              });
              setError(
                removed.length
                  ? "Acessos incompatíveis removidos: " +
                      removed
                        .map(
                          (m: string) =>
                            moduleCatalog.find((c) => c.key === m)?.label,
                        )
                        .join(", ")
                  : "",
              );
            }}
          >
            {boot.roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Equipe">
          <select
            required={d.role === "Equipe de Campo"}
            value={d.team_id || ""}
            onChange={(e) => setD({ ...d, team_id: e.target.value || null })}
          >
            <option value="">Sem equipe</option>
            {boot.catalogs
              .filter((c) => c.kind === "equipes")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <fieldset data-guide="module-access" className="module-access">
          <legend>Acesso aos módulos</legend>
          <p className="muted">
            Módulos não concedem poderes adicionais ao perfil. Campo é exclusivo
            da Equipe de Campo, com exceção da conta master de manutenção.
          </p>
          {master && (
            <p className="notice">
              Conta master de manutenção: todos os módulos permanecem liberados.
            </p>
          )}
          <div className="module-access-options">
            {moduleCatalog
              .filter((m) => master || canRoleAccessModule(d.role, m.key))
              .map((m) => (
                <label key={m.key} className="module-access-option">
                  <input
                    type="checkbox"
                    disabled={master}
                    checked={master || d.modules.includes(m.key)}
                    onChange={(e) =>
                      setD({
                        ...d,
                        modules: e.target.checked
                          ? [...d.modules, m.key]
                          : d.modules.filter((key: string) => key !== m.key),
                      })
                    }
                  />
                  <span>{m.label}</span>
                </label>
              ))}
          </div>
        </fieldset>
        {error && (
          <p
            className={
              error.startsWith("Acessos incompatíveis removidos:")
                ? "notice"
                : "form-error"
            }
          >
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            <Plus size={16} />
            {user ? "Salvar usuário" : "Criar usuário"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
