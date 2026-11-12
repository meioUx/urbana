import { Pencil, Plus } from "lucide-react";
import { api } from "../../shared/api";
import { lazyModule } from "../../shared/lazyModule";
import type { Boot, Row } from "../../shared/types";
import SettingsForm from "./SettingsForm";
import { TableScroll } from "../../shared/ui";
const AuditPanel = lazyModule(() => import("./AuditPanel"));
const PortalSettingsForm = lazyModule(() => import("./PortalSettingsForm"));

export default function AdminPage({
  boot,
  users,
  adminTab,
  setAdminTab,
  name,
  onCatalog,
  onUser,
  onError,
  onSaveSettings,
}: {
  boot: Boot;
  users: Row[];
  adminTab: string;
  setAdminTab: (tab: string) => void;
  name: (id: string) => string;
  onCatalog: (kind: string, item?: Row) => void;
  onUser: (item?: Row) => void;
  onError: (message: string) => void;
  onSaveSettings: (data: any) => Promise<void>;
}) {
  const catalogs = (kind: string) =>
    boot?.catalogs.filter((c) => c.kind === kind) || [];
  return (
    <>
      <div className="tabs" data-guide="admin-tabs">
        {[
          ["categorias", "Categorias e SLA"],
          ["secretarias", "Secretarias"],
          ["departamentos", "Departamentos"],
          ["setores", "Setores"],
          ["users", "Usuários"],
          ["settings", "Configurações"],
          ["audit", "Auditoria"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={adminTab === k ? "selected" : ""}
            onClick={() => setAdminTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {["categorias", "secretarias", "departamentos", "setores"].includes(
        adminTab,
      ) && (
        <>
          <div className="section-heading">
            <h2>
              {adminTab === "categorias"
                ? "Categorias de manutenção"
                : "Estrutura administrativa"}
            </h2>
            <button
              className="button primary"
              onClick={() => onCatalog(adminTab)}
            >
              <Plus size={16} />
              Adicionar
            </button>
          </div>
          <TableScroll label="Tabela de cadastro">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>
                    {adminTab === "categorias" ? "Subcategorias" : "Vínculo"}
                  </th>
                  {adminTab === "categorias" && <th>SLA emergencial</th>}
                  <th>
                    <span className="visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {catalogs(adminTab).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.subcategories?.join(", ") || name(c.parent_id)}</td>
                    {adminTab === "categorias" && (
                      <td>{c.sla.Emergencial} horas</td>
                    )}
                    <td>
                      <button
                        className="icon"
                        title={`Editar ${c.name}`}
                        onClick={() => onCatalog(adminTab, c)}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
      {adminTab === "users" && (
        <>
          <div className="section-heading">
            <h2>Usuários e permissões</h2>
            <button
              className="button primary"
              data-guide="new-user"
              onClick={() => onUser()}
            >
              <Plus size={16} />
              Novo usuário
            </button>
          </div>
          <TableScroll label="Tabela de cadastro">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Equipe</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{name(u.team_id)}</td>
                    <td>
                      <button
                        className="button secondary"
                        data-guide="user-edit"
                        onClick={async () => {
                          try {
                            const data = await api(
                              `/users/${u.id}/permissions`,
                            );
                            onUser({ ...data.user, modules: data.modules });
                          } catch (e: any) {
                            onError(e.message);
                          }
                        }}
                      >
                        Editar usuário
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
      {adminTab === "settings" && (
        <>
          <SettingsForm boot={boot} save={onSaveSettings} />
          <PortalSettingsForm onError={onError} />
        </>
      )}{" "}
      {adminTab === "audit" && <AuditPanel api={api} />}
    </>
  );
}
