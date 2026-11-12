import { useEffect, useState } from "react";
import DispatchContext from "../../DispatchContext";
import WorkflowGuide from "../../WorkflowGuide";
import { api } from "../../shared/api";
import { fmt, money } from "../../shared/format";
import { lazyModule } from "../../shared/lazyModule";
import type { Boot, Row } from "../../shared/types";
import {
  Badge,
  Empty,
  Field,
  Modal,
  Priority,
  Sla,
  TableScroll,
} from "../../shared/ui";
import { GeoMap } from "../map/LazyGeoMap";
import Assignment from "./Assignment";
import {
  DEFAULT_REFUSAL_TEXT,
  PUBLIC_REASONS,
} from "../../../shared/portal-public.mjs";
const InvoicePanel = lazyModule(() => import("../../InvoicePanel"));
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Filter,
  HardHat,
  LocateFixed,
  MapPin,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Truck,
} from "lucide-react";

export default function Detail({
  value: v,
  boot,
  can,
  onClose,
  onOpen,
  onChange,
}: {
  value: any;
  boot: Boot;
  can: (a: string) => boolean;
  onClose: () => void;
  onOpen: (t: string, id: string) => void;
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState(v.initialTab || "overview"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [notes, setNotes] = useState(""),
    [reason, setReason] = useState(""),
    [stage, setStage] = useState(v.type === "order" ? "antes" : "registro"),
    [file, setFile] = useState<File | null>(null),
    [material, setMaterial] = useState(""),
    [quantity, setQuantity] = useState(1),
    [equipment, setEquipment] = useState("");
  const [conflict, setConflict] = useState(false);
  const [triageDecision, setTriageDecision] = useState(
      v.guideMode === "program" ? "program" : "",
    ),
    [rejectionReason, setRejectionReason] = useState(""),
    [publicReason, setPublicReason] = useState("");
  const cats = boot.catalogs.filter((c) => c.kind === "categorias"),
    sectors = boot.catalogs.filter((c) => c.kind === "setores");
  const [triage, setTriage] = useState({
    category_id: v.category_id,
    subcategory: v.subcategory,
    sector_id: v.sector_id,
    priority: v.priority,
  });
  const teams = boot.catalogs.filter(
    (c) => c.kind === "equipes" && c.sector_id === triage.sector_id,
  );
  const [schedule, setSchedule] = useState({
    team_id: "",
    scheduled_at: new Date().toISOString().slice(0, 10),
    responsible: "",
    notes: "",
    assigned_user_id: "",
  });
  useEffect(() => {
    if (schedule.team_id && !teams.some((t) => t.id === schedule.team_id))
      setSchedule((s) => ({
        ...s,
        team_id: "",
        assigned_user_id: "",
        responsible: "",
      }));
  }, [triage.sector_id, schedule.team_id]);
  const name = (id: string) =>
    boot.catalogs.find((c) => c.id === id)?.name || "—";
  const isOrder = v.type === "order",
    base = `/${isOrder ? "ordens-servico" : "ocorrencias"}/${v.id}`,
    location = isOrder ? v.occurrences[0] : v;
  const [lat, setLat] = useState(location?.lat || 0),
    [lng, setLng] = useState(location?.lng || 0);
  const execute = async (
    fn: () => Promise<any>,
    message = "Operação registrada com sucesso.",
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      setConflict(false);
      setSuccess(message);
      try {
        await onChange();
      } catch {
        setError(
          "A operação foi registrada, mas não foi possível atualizar o detalhe. Feche e abra o registro antes de continuar.",
        );
      }
    } catch (e: any) {
      setConflict(e.code === "VERSION_CONFLICT");
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const action = (a: string, body: any = {}) =>
    execute(
      () => api(`${base}/${a}`, "POST", { ...body, version: v.version }),
      (
        {
          classificar:
            "Triagem salva. A gestão já pode programar a ordem de serviço.",
          assumir:
            "Deslocamento registrado. Confira a chegada e as evidências antes de iniciar.",
          iniciar:
            "Execução iniciada. Registre os materiais e as fotos do serviço.",
          material: "Consumo de material registrado.",
          equipamento: "Equipamento vinculado ao serviço.",
          concluir:
            "Serviço enviado para validação. A conclusão depende da análise da gestão ou fiscalização.",
          validar:
            "Serviço validado e concluído. O resultado foi registrado no histórico.",
          reabrir:
            "Execução reaberta para correção. A justificativa foi registrada.",
          cancelar:
            "Ordem cancelada. A justificativa foi registrada no histórico.",
        } as Record<string, string>
      )[a],
    );
  const editable = ![
    "CONCLUIDA",
    "CANCELADA",
    "RECUSADA",
    "AGUARDANDO_VALIDACAO",
  ].includes(v.status);
  return (
    <Modal title={v.code} onClose={onClose} wide>
      <div className="detail-summary" data-guide="detail-summary">
        <div>
          <Badge status={v.status} />
          <Priority value={v.priority} />
        </div>
        <h2>{isOrder ? name(v.team_id) : v.address}</h2>
        <p>
          {isOrder
            ? `${name(v.sector_id)} · ${v.responsible}`
            : `${v.neighborhood} · ${name(v.category_id)} / ${v.subcategory}`}
        </p>
        {v.demo && <small className="demo-label">Registro demonstrativo</small>}
      </div>
      <>
        {conflict && (
          <div className="notice" role="alert">
            <p>
              Este registro foi alterado por outra pessoa enquanto você
              trabalhava nele. Atualize os dados antes de continuar. Seus campos
              locais foram preservados.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onChange();
                  setConflict(false);
                  setError("");
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Atualizar dados
            </button>
          </div>
        )}
      </>
      <WorkflowGuide
        value={v}
        catalogs={boot.catalogs}
        onEvidence={() => setTab("evidence")}
      />
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      <div className="tabs">
        <button
          className={tab === "overview" ? "selected" : ""}
          onClick={() => setTab("overview")}
        >
          Informações
        </button>
        <button
          className={tab === "evidence" ? "selected" : ""}
          onClick={() => setTab("evidence")}
        >
          Evidências ({v.evidence.length})
        </button>
        {isOrder && (
          <button
            className={tab === "execution" ? "selected" : ""}
            onClick={() => setTab("execution")}
          >
            Execução
          </button>
        )}
        {isOrder && (
          <button
            className={tab === "costs" ? "selected" : ""}
            onClick={() => setTab("costs")}
          >
            Custos e NFs ({v.invoices?.length || 0})
          </button>
        )}
        <button
          className={tab === "history" ? "selected" : ""}
          onClick={() => setTab("history")}
        >
          Histórico ({v.history.length})
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "overview" && (
        <>
          {isOrder ? (
            <>
              <div className="detail-facts">
                <div>
                  <small>Programação</small>
                  <strong>{v.scheduled_at}</strong>
                </div>
                <div>
                  <small>Prazo de atendimento</small>
                  <Sla order={v} />
                </div>
                <div>
                  <small>Início da execução</small>
                  <strong>{fmt(v.started_at)}</strong>
                </div>
                <div>
                  <small>Conclusão validada</small>
                  <strong>{fmt(v.completed_at)}</strong>
                </div>
              </div>
              <h3>Ocorrências relacionadas</h3>
              {v.occurrences.map((o: Row) => (
                <button
                  className="linked-row"
                  key={o.id}
                  onClick={() => onOpen("occurrence", o.id)}
                >
                  <MapPin size={18} />
                  <span>
                    <strong>{o.address}</strong>
                    <small>{o.code}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
              {v.completion_notes && (
                <p className="description">{v.completion_notes}</p>
              )}
            </>
          ) : (
            <>
              <p className="description">{v.description}</p>
              {v.public_portal && (
                <div className="notice" role="note">
                  <span>
                    <strong>Registrada pelo portal do cidadão</strong>
                    <p>
                      Local marcado{" "}
                      {v.public_portal.location_source === "gps"
                        ? "pelo GPS do aparelho"
                        : "no mapa"}{" "}
                      pelo cidadão. Consentimento para uso dos dados em{" "}
                      {fmt(v.public_portal.consent_at)}.
                    </p>
                    {v.public_portal.possible_duplicates?.length > 0 && (
                      <p>
                        Possível duplicidade com{" "}
                        {v.public_portal.possible_duplicates.join(", ")} (ativas
                        no raio configurado). Confira antes de programar.
                      </p>
                    )}
                  </span>
                </div>
              )}
              {v.status === "RECUSADA" && (
                <div className="notice" role="status">
                  <span>
                    <strong>Recusada na triagem</strong>
                    <p>{v.rejection_reason}</p>
                    <small>
                      {v.rejected_by} · {fmt(v.rejected_at)}
                    </small>
                  </span>
                </div>
              )}
              <div className="detail-facts">
                <div>
                  <small>Origem</small>
                  <strong>{v.origin}</strong>
                </div>
                <div>
                  <small>Identificada em</small>
                  <strong>{fmt(v.created_at)}</strong>
                </div>
                <div>
                  <small>Setor responsável</small>
                  <strong>{name(v.sector_id)}</strong>
                </div>
                <div>
                  <small>Coordenadas</small>
                  <strong>
                    {v.lat.toFixed(6)}, {v.lng.toFixed(6)}
                  </strong>
                </div>
              </div>
              {v.reference && <p>Referência: {v.reference}</p>}
              <GeoMap rows={[v]} point={[v.lat, v.lng]} />
              {can("classify") &&
                ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) &&
                triageDecision === "" && (
                  <form
                    data-guide="classification"
                    onSubmit={(e) => {
                      e.preventDefault();
                      action("classificar", triage);
                    }}
                  >
                    <div className="form-section-title">
                      <Filter size={18} />
                      <h3>Triagem</h3>
                    </div>
                    <div className="form-grid">
                      <Field label="Categoria">
                        <select
                          value={triage.category_id}
                          onChange={(e) => {
                            const c = cats.find(
                              (c) => c.id === e.target.value,
                            )!;
                            setTriage({
                              ...triage,
                              category_id: c.id,
                              subcategory: c.subcategories[0],
                              sector_id: c.sector_id,
                            });
                          }}
                        >
                          {cats.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Subcategoria">
                        <select
                          value={triage.subcategory}
                          onChange={(e) =>
                            setTriage({
                              ...triage,
                              subcategory: e.target.value,
                            })
                          }
                        >
                          {cats
                            .find((c) => c.id === triage.category_id)
                            ?.subcategories.map((s: string) => (
                              <option key={s}>{s}</option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Prioridade">
                        <select
                          value={triage.priority}
                          onChange={(e) =>
                            setTriage({ ...triage, priority: e.target.value })
                          }
                        >
                          {boot.priorities.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Setor responsável">
                        <select
                          value={triage.sector_id}
                          onChange={(e) =>
                            setTriage({ ...triage, sector_id: e.target.value })
                          }
                        >
                          {sectors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="form-actions">
                      {can("schedule") && (
                        <button
                          type="button"
                          className="button primary"
                          disabled={busy}
                          onClick={() => {
                            setTriageDecision("program");
                            setError("");
                          }}
                        >
                          <Plus size={16} />
                          Gerar ordem de serviço
                        </button>
                      )}
                      <button
                        type="submit"
                        className={`button ${can("schedule") ? "secondary" : "primary"}`}
                        disabled={busy}
                      >
                        <Check size={16} />
                        Concluir triagem e programar depois
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        data-guide="refuse"
                        onClick={() => {
                          setTriageDecision("reject");
                          setError("");
                        }}
                      >
                        Recusar
                      </button>
                    </div>
                  </form>
                )}
              {can("classify") &&
                ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) &&
                triageDecision === "reject" && (
                  <form
                    className="assignment-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      execute(async () => {
                        await api(`/ocorrencias/${v.id}/recusar`, "POST", {
                          reason: rejectionReason,
                          version: v.version,
                          ...(v.public_portal && publicReason
                            ? { public_reason: publicReason }
                            : {}),
                        });
                        setTriageDecision("");
                      }, "Demanda recusada. A justificativa foi registrada no histórico.");
                    }}
                  >
                    <h3>Justificativa de recusa</h3>
                    <Field label="Justificativa de recusa">
                      <textarea
                        autoFocus
                        required
                        maxLength={2000}
                        rows={4}
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Informe o motivo da recusa desta demanda."
                      />
                    </Field>
                    {v.public_portal && (
                      <Field label="Mensagem ao cidadão no portal">
                        <select
                          value={publicReason}
                          onChange={(e) => setPublicReason(e.target.value)}
                        >
                          <option value="">
                            Padrão: {DEFAULT_REFUSAL_TEXT}
                          </option>
                          {Object.entries(PUBLIC_REASONS).map(
                            ([code, text]) => (
                              <option key={code} value={code}>
                                {text}
                              </option>
                            ),
                          )}
                        </select>
                      </Field>
                    )}
                    {v.public_portal && (
                      <p className="muted">
                        A justificativa acima é interna. O cidadão vê só a
                        mensagem escolhida.
                      </p>
                    )}
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setTriageDecision("")}
                      >
                        Voltar
                      </button>
                      <button
                        className="button primary"
                        disabled={busy || !rejectionReason.trim()}
                      >
                        {busy ? "Enviando..." : "Enviar"}
                      </button>
                    </div>
                  </form>
                )}
              {can("schedule") &&
                ["IDENTIFICADA", "EM_TRIAGEM"].includes(v.status) &&
                triageDecision === "program" && (
                  <form
                    data-guide="scheduling"
                    onSubmit={(e) => {
                      e.preventDefault();
                      execute(async () => {
                        await api("/ordens-servico", "POST", {
                          ...schedule,
                          occurrence_ids: [v.id],
                          triage: { ...triage, version: v.version },
                        });
                        setTriageDecision("");
                        setTab("overview");
                      }, "Ordem de serviço criada e equipe designada.");
                    }}
                  >
                    <div className="form-section-title">
                      <ClipboardList size={18} />
                      <h3>Gerar ordem de serviço</h3>
                    </div>
                    <p>
                      Escolha a equipe e a data. A triagem será salva junto com
                      a programação.
                    </p>
                    <details className="dispatch-optional">
                      <summary>Consultar equipes e trabalhos do setor</summary>
                      <DispatchContext
                        boot={boot}
                        api={api}
                        sectorId={triage.sector_id || v.sector_id}
                        selectedTeam={schedule.team_id}
                        scheduledAt={schedule.scheduled_at}
                        occurrenceId={v.id}
                        onOpen={onOpen}
                        onChoose={(t: any) =>
                          setSchedule({
                            ...schedule,
                            team_id: t.id,
                            assigned_user_id: "",
                            responsible: t.leader || "",
                          })
                        }
                      />
                    </details>
                    <div className="form-grid">
                      <Field label="Equipe">
                        <select
                          required
                          value={schedule.team_id}
                          onChange={(e) =>
                            setSchedule({
                              ...schedule,
                              team_id: e.target.value,
                              assigned_user_id: "",
                              responsible:
                                teams.find((t) => t.id === e.target.value)
                                  ?.leader || "",
                            })
                          }
                        >
                          <option value="">Selecione</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Operador designado">
                        <select
                          aria-label="Operador designado"
                          value={schedule.assigned_user_id}
                          onChange={(e) =>
                            setSchedule({
                              ...schedule,
                              assigned_user_id: e.target.value,
                            })
                          }
                        >
                          <option value="">Toda a equipe</option>
                          {boot.operators
                            .filter((u) => u.team_id === schedule.team_id)
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Data programada">
                        <input
                          type="date"
                          required
                          value={schedule.scheduled_at}
                          onChange={(e) =>
                            setSchedule({
                              ...schedule,
                              scheduled_at: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Responsável" wide>
                        <input
                          required
                          value={schedule.responsible}
                          onChange={(e) =>
                            setSchedule({
                              ...schedule,
                              responsible: e.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setTriageDecision("")}
                      >
                        Voltar à triagem
                      </button>
                      <button className="button primary" disabled={busy}>
                        <Plus size={17} />
                        Confirmar ordem de serviço
                      </button>
                    </div>
                  </form>
                )}
              {v.orders.length > 0 && (
                <>
                  <h3 className="spaced">Ordens de serviço</h3>
                  {v.orders.map((o: Row) => (
                    <button
                      className="linked-row"
                      key={o.id}
                      onClick={() => onOpen("order", o.id)}
                    >
                      <ClipboardList size={18} />
                      <strong>{o.code}</strong>
                      <Badge status={o.status} />
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
      {tab === "evidence" && (
        <>
          {isOrder && (
            <>
              <h3>Fotos do registro inicial</h3>
              <div className="evidence-grid" data-guide="evidence">
                {v.occurrences
                  .flatMap((o: any) => o.evidence || [])
                  .filter((e: any) => e.mime.startsWith("image/"))
                  .map((e: any) => (
                    <a
                      className="evidence-item"
                      key={e.id}
                      href={`/api/anexos/${e.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/anexos/${e.id}`}
                        alt="Foto do problema registrado"
                      />
                      <small>
                        {e.user_name} · {fmt(e.created_at)}
                      </small>
                    </a>
                  ))}
              </div>
              <h3>Execução do serviço</h3>
            </>
          )}
          <div className="evidence-grid">
            {v.evidence.map((e: Row) => (
              <a
                key={e.id}
                href={`/api/anexos/${e.id}`}
                target="_blank"
                rel="noreferrer"
                className="evidence-item"
              >
                {e.mime.startsWith("image/") ? (
                  <img src={`/api/anexos/${e.id}`} alt={`Foto ${e.stage}`} />
                ) : (
                  <div className="file-preview">
                    <FileText size={35} />
                  </div>
                )}
                <strong>
                  {e.stage} · {e.original_name}
                </strong>
                <small>
                  {fmt(e.created_at)} · {e.user_name}
                </small>
                <small>
                  {e.lat?.toFixed(5)}, {e.lng?.toFixed(5)}
                </small>
              </a>
            ))}
          </div>
          {!v.evidence.length && <Empty text="Nenhuma evidência anexada." />}
          {editable && can(isOrder ? "execute" : "create") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                execute(async () => {
                  if (!file) throw new Error("Selecione um arquivo.");
                  const fd = new FormData();
                  fd.append("file", file);
                  fd.append("stage", stage);
                  fd.append("lat", String(lat));
                  fd.append("lng", String(lng));
                  await api(`${base}/anexos`, "POST", fd);
                });
              }}
            >
              <div className="form-section-title">
                <Camera size={18} />
                <h3>Anexar evidência</h3>
              </div>
              <div className="form-grid">
                <Field label="Etapa">
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value)}
                  >
                    {(isOrder
                      ? ["antes", "durante", "depois", "documento"]
                      : ["registro", "documento"]
                    ).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Arquivo (até 15 MB)">
                  <input
                    type="file"
                    required
                    accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </Field>
                <Field label="Latitude da captura">
                  <input
                    type="number"
                    step="any"
                    required
                    min="-90"
                    max="90"
                    value={lat}
                    onChange={(e) => setLat(Number(e.target.value))}
                  />
                </Field>
                <Field label="Longitude da captura">
                  <input
                    type="number"
                    step="any"
                    required
                    min="-180"
                    max="180"
                    value={lng}
                    onChange={(e) => setLng(Number(e.target.value))}
                  />
                </Field>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => {
                      setLat(p.coords.latitude);
                      setLng(p.coords.longitude);
                    },
                    () =>
                      setError(
                        "GPS indisponível. Confirme as coordenadas manualmente.",
                      ),
                    { timeout: 10000 },
                  )
                }
              >
                <LocateFixed size={16} />
                GPS da captura
              </button>{" "}
              <button className="button primary" disabled={busy}>
                <Camera size={16} />
                Enviar evidência
              </button>
            </form>
          )}
        </>
      )}
      {isOrder && tab === "costs" && (
        <InvoicePanel
          order={v}
          materials={boot.catalogs.filter((item) => item.kind === "materiais")}
          api={api}
          onChange={onChange}
          canManage={can("schedule")}
        />
      )}
      {isOrder && v.return_reason && (
        <div className="notice">
          <TriangleAlert />
          <span>
            <strong>Não foi possível executar</strong>
            <br />
            {v.return_reason}
            <br />
            {v.returned_by} · {fmt(v.returned_at)}
          </span>
        </div>
      )}
      {isOrder && v.completion_notes && (
        <div className="notice">
          <CheckCircle2 />
          <span>
            <strong>Relato de campo</strong>
            <br />
            {v.completion_notes}
            <br />
            {v.executed_by} · {fmt(v.finished_at)}
          </span>
        </div>
      )}
      {isOrder &&
        can("schedule") &&
        ["PROGRAMADA", "DEVOLVIDA"].includes(v.status) && (
          <Assignment
            key={v.updated_at}
            order={v}
            boot={boot}
            onSave={(data: any) =>
              execute(() =>
                api(`${base}/programacao`, "POST", {
                  ...data,
                  version: v.version,
                }),
              )
            }
            busy={busy}
          />
        )}
      {tab === "execution" && (
        <>
          {can("execute") &&
            ["PROGRAMADA", "EM_DESLOCAMENTO"].includes(v.status) && (
              <>
                <div className="form-grid">
                  <Field label="Latitude de chegada">
                    <input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={lat}
                      onChange={(e) => setLat(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Longitude de chegada">
                    <input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={lng}
                      onChange={(e) => setLng(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <div className="action-row">
                  {v.status === "PROGRAMADA" && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => action("assumir")}
                    >
                      <Truck size={17} />
                      Iniciar deslocamento
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() =>
                      navigator.geolocation?.getCurrentPosition(
                        (p) => {
                          setLat(p.coords.latitude);
                          setLng(p.coords.longitude);
                        },
                        () =>
                          setError(
                            "GPS indisponível. Informe a localização manualmente.",
                          ),
                        { timeout: 10000 },
                      )
                    }
                  >
                    <LocateFixed size={16} />
                    Capturar GPS
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => action("iniciar", { lat, lng })}
                  >
                    <HardHat size={17} />
                    Confirmar chegada e iniciar
                  </button>
                </div>
              </>
            )}
          <h3 className="spaced">Materiais utilizados</h3>
          {v.materials.length ? (
            <TableScroll label="Tabela do registro">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Quantidade</th>
                    <th>Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {v.materials.map((m: Row) => (
                    <tr key={m.id}>
                      <td>{name(m.material_id)}</td>
                      <td>
                        {m.quantity}{" "}
                        {
                          boot.catalogs.find((c) => c.id === m.material_id)
                            ?.unit
                        }
                      </td>
                      <td>{money(m.quantity * m.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <p className="muted">Nenhum material registrado.</p>
          )}
          {can("execute") && v.status === "EM_EXECUCAO" && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                action("material", { material_id: material, quantity });
              }}
            >
              <Field label="Material">
                <select
                  required
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {boot.catalogs
                    .filter((c) => c.kind === "materiais")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.unit})
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Quantidade">
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                <Plus size={16} />
                Registrar
              </button>
            </form>
          )}
          <h3 className="spaced">Equipamentos</h3>
          {v.equipment.map((e: any) => (
            <div className="consumption-line" key={e.equipment_id}>
              <Truck size={17} />
              <span>{name(e.equipment_id)}</span>
            </div>
          ))}
          {!v.equipment.length && (
            <p className="muted">Nenhum equipamento registrado.</p>
          )}
          {can("execute") && v.status === "EM_EXECUCAO" && (
            <>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action("equipamento", { equipment_id: equipment });
                }}
              >
                <Field label="Equipamento">
                  <select
                    required
                    value={equipment}
                    onChange={(e) => setEquipment(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {boot.catalogs
                      .filter((c) => c.kind === "equipamentos")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <button className="button secondary" disabled={busy}>
                  <Plus size={16} />
                  Vincular
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action("concluir", { notes });
                }}
              >
                <div className="form-section-title">
                  <CheckCircle2 size={18} />
                  <h3>Conclusão do serviço</h3>
                </div>
                <Field label="Relato da execução">
                  <textarea
                    required
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
                <button className="button primary" disabled={busy}>
                  <Check size={17} />
                  Enviar para validação
                </button>
              </form>
            </>
          )}
          {can("validate") && v.status === "AGUARDANDO_VALIDACAO" && (
            <div className="form-actions">
              <button
                className="button primary"
                disabled={busy}
                data-guide="validate"
                onClick={() => action("validar")}
              >
                <ShieldCheck size={17} />
                Validar e concluir
              </button>
            </div>
          )}
          {((can("validate") &&
            ["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)) ||
            (can("schedule") &&
              ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(
                v.status,
              ))) && (
            <form
              data-guide="reopen"
              onSubmit={(e) => {
                e.preventDefault();
                action(
                  ["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                    ? "reabrir"
                    : "cancelar",
                  { reason },
                );
              }}
            >
              <h3 className="spaced">
                {["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                  ? "Reabrir serviço"
                  : "Cancelar ordem"}
              </h3>
              <Field label="Justificativa">
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                {["CONCLUIDA", "AGUARDANDO_VALIDACAO"].includes(v.status)
                  ? "Reabrir execução"
                  : "Cancelar ordem"}
              </button>
            </form>
          )}
        </>
      )}
      {tab === "history" && (
        <div className="timeline">
          {v.history.map((h: Row) => (
            <div key={h.id}>
              <i />
              <strong>{h.event}</strong>
              <p>
                {h.user_name} · {fmt(h.created_at)}
              </p>
              <details>
                <summary>Detalhes da alteração</summary>
                <pre>
                  {JSON.stringify(
                    {
                      anterior: h.before_value
                        ? JSON.parse(h.before_value)
                        : null,
                      novo: h.after_value ? JSON.parse(h.after_value) : null,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          ))}
          {!v.history.length && <Empty text="Nenhum evento registrado." />}
        </div>
      )}
    </Modal>
  );
}
