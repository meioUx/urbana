import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

export default function PermissionForm({ user, api, onClose, onSaved }: { user: any; api: (path: string, method?: string, body?: any) => Promise<any>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<any>(null), [values, setValues] = useState<Record<string, boolean | null>>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api(`/users/${user.id}/permissions`).then((result) => { setData(result); setValues(result.overrides); }).catch((e) => setError(e.message)); }, [user.id]);
  if (!data) return <div className="modal-backdrop"><section className="modal permission-modal"><p>{error || "Carregando permissões..."}</p></section></div>;
  return <div className="modal-backdrop" role="presentation"><section className="modal permission-modal" role="dialog" aria-modal="true" aria-label={`Permissões de ${user.name}`}>
    <div className="modal-header"><div><ShieldCheck/><span><h2>Permissões de {user.name}</h2><small>Perfil base: {user.role}</small></span></div><button className="icon" onClick={onClose} aria-label="Fechar">×</button></div>
    {error && <p className="form-error">{error}</p>}
    <p className="muted">“Padrão do perfil” acompanha automaticamente as regras do perfil. Uma liberação ou bloqueio individual tem prioridade.</p>
    <div className="permission-list">{data.catalog.map((permission: any) => {
      const override = values[permission.key]; const effective = override ?? data.defaults[permission.key];
      return <div className="permission-row" key={permission.key}><span><strong>{permission.label}</strong><small>{permission.group}</small></span><select aria-label={permission.label} value={override === null || override === undefined ? "default" : override ? "allow" : "deny"} disabled={user.role === "Administrador" && permission.key === "admin"} onChange={(e) => setValues({ ...values, [permission.key]: e.target.value === "default" ? null : e.target.value === "allow" })}><option value="default">Padrão do perfil ({data.defaults[permission.key] ? "permitido" : "bloqueado"})</option><option value="allow">Permitir individualmente</option><option value="deny">Bloquear individualmente</option></select><b className={effective ? "permission-on" : "permission-off"}>{effective ? "Permitido" : "Bloqueado"}</b></div>;
    })}</div>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`/users/${user.id}/permissions`, "PATCH", { permissions: values }); await onSaved(); onClose(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}><ShieldCheck size={16}/>{busy ? "Salvando..." : "Salvar permissões"}</button></div>
  </section></div>;
}
