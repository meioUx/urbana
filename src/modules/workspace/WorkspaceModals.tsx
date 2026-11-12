import { api } from "../../shared/api";
import { lazyModule } from "../../shared/lazyModule";
import type { Boot } from "../../shared/types";
const PlanOrderForm = lazyModule(() => import("../planning/PlanOrderForm"));
const NewOccurrence = lazyModule(() => import("../occurrences/NewOccurrence"));
const CatalogForm = lazyModule(() => import("../catalogs/CatalogForm"));
const UserForm = lazyModule(() => import("../administration/UserForm"));
const Detail = lazyModule(() => import("../detail/Detail"));

/** Diálogos da área de gestão (cadastros, nova ocorrência, programação de plano) e o detalhe do registro aberto. */
export default function WorkspaceModals({
  modal,
  setModal,
  detail,
  setDetail,
  boot,
  lastSync,
  can,
  refresh,
  openDetail,
  setToast,
  setError,
  setSyncError,
}: {
  modal: any;
  setModal: (modal: any) => void;
  detail: any;
  setDetail: (detail: any) => void;
  boot: Boot;
  lastSync: string;
  can: (action: string) => boolean;
  refresh: () => Promise<void>;
  openDetail: (type: string, id: string, initialTab?: string) => Promise<void>;
  setToast: (message: string) => void;
  setError: (message: string) => void;
  setSyncError: (message: string) => void;
}) {
  return (
    <>
      {modal?.type === "plan-order" && (
        <PlanOrderForm
          plan={modal.plan}
          boot={boot}
          lastSync={lastSync}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api("/ordens-servico", "POST", data);
            setModal(null);
            setToast("Ordem de serviço vinculada ao plano.");
            try {
              await refresh();
            } catch {
              setSyncError(
                "A ordem foi salva, mas não foi possível atualizar o planejamento. Atualize os dados antes de continuar.",
              );
            }
          }}
        />
      )}
      {modal?.type === "new" && (
        <NewOccurrence
          boot={boot}
          onClose={() => setModal(null)}
          onSave={async (data, file) => {
            const result = await api("/ocorrencias", "POST", data);
            if (file) {
              try {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("stage", "registro");
                fd.append("lat", String(result.lat));
                fd.append("lng", String(result.lng));
                await api(`/ocorrencias/${result.id}/anexos`, "POST", fd);
              } catch (e: any) {
                setError(
                  `Ocorrência ${result.code} criada, mas a foto falhou: ${e.message}. Anexe novamente no detalhe.`,
                );
              }
            }
            setModal(null);
            setToast(
              result.linked
                ? "Solicitação vinculada."
                : "Ocorrência registrada.",
            );
            try {
              await refresh();
            } catch {
              setSyncError(
                "A ocorrência foi registrada, mas a atualização falhou. Atualize os dados antes de continuar.",
              );
            }
            await openDetail("occurrence", result.id);
          }}
        />
      )}
      {modal?.type === "catalog" && (
        <CatalogForm
          kind={modal.kind}
          item={modal.item}
          boot={boot}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api(
              `/${modal.kind}${modal.item ? "/" + modal.item.id : ""}`,
              modal.item ? "PATCH" : "POST",
              data,
            );
            await refresh();
            setModal(null);
            setToast("Cadastro salvo.");
          }}
        />
      )}
      {modal?.type === "user" && (
        <UserForm
          boot={boot}
          user={modal.item}
          onClose={() => setModal(null)}
          onSave={async (data: any) => {
            await api(
              modal.item ? `/users/${modal.item.id}` : "/users",
              modal.item ? "PATCH" : "POST",
              data,
            );
            await refresh();
            setModal(null);
            setToast(modal.item ? "Usuário atualizado." : "Usuário criado.");
          }}
        />
      )}
      {detail && (
        <Detail
          key={detail.id + ":" + (detail.guideKey || "")}
          value={detail}
          boot={boot}
          can={can}
          onClose={() => setDetail(null)}
          onOpen={openDetail}
          onChange={async () => {
            const updated = await api(
              `/${detail.type === "order" ? "ordens-servico" : "ocorrencias"}/${detail.id}`,
            );
            setDetail({ type: detail.type, ...updated });
            await refresh();
          }}
        />
      )}
    </>
  );
}
