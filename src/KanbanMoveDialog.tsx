import { useEffect, useRef, useState } from "react";
import { ArrowRight, LocateFixed, X } from "lucide-react";
import { kanbanColumns } from "./kanban-model.mjs";

export default function KanbanMoveDialog({
  card,
  move,
  boot,
  api,
  onSaved,
  onClose,
  onOpen,
}: any) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [data, setData] = useState<any>({
    category_id: card.category_id || card.occurrences[0]?.category_id || "",
    subcategory: card.subcategory || card.occurrences[0]?.subcategory || "",
    priority: card.priority,
    sector_id: card.sector_id,
    team_id: card.team_id || "",
    scheduled_at: card.scheduled_at?.slice(0, 10) || "",
    responsible: card.responsible || "",
    assigned_user_id: card.assigned_user_id || "",
    lat: "",
    lng: "",
    notes: "",
    reason: "",
  });
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const set = (key: string, value: any) =>
    setData((old: any) => ({ ...old, [key]: value }));
  const teams = boot.catalogs.filter(
    (c: any) => c.kind === "equipes" && c.sector_id === data.sector_id,
  );
  const operators = boot.operators.filter(
    (u: any) => u.team_id === data.team_id,
  );
  const source = kanbanColumns.find((c) => c.status === card.status)?.title;
  const gps = () => {
    if (!navigator.geolocation) {
      setError("GPS indisponível. Informe as coordenadas de chegada.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setData((d: any) => ({
          ...d,
          lat: p.coords.latitude,
          lng: p.coords.longitude,
        }));
        setLocating(false);
      },
      () => {
        setError(
          "Não foi possível obter o GPS. Informe as coordenadas de chegada.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  return (
    <dialog
      ref={dialog}
      className="kanban-dialog"
      aria-labelledby="kanban-move-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy && !locating) onClose();
      }}
    >
      <header>
        <div>
          <small>{card.code}</small>
          <h2 id="kanban-move-title">
            {saved
              ? "Movimentação salva"
              : `Mover para ${move.label.toLocaleLowerCase("pt-BR")}`}
          </h2>
        </div>
        <button
          type="button"
          className="icon"
          aria-label="Fechar movimentação"
          disabled={busy || locating}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <p className="kanban-transition">
        {source}
        <ArrowRight size={16} />
        {kanbanColumns.find((c) => c.status === move.status)?.title}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved ? (
        <>
          <p>
            A etapa foi salva. Atualize o quadro para exibir os dados mais
            recentes.
          </p>
          <button
            className="button primary"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSaved();
              } catch {
                setError(
                  "A atualização falhou. A movimentação já foi salva; tente atualizar novamente.",
                );
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Atualizar quadro
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              const base = `/${card.type === "order" ? "ordens-servico" : "ocorrencias"}/${card.id}`;
              let body: any = { kanban_expected_status: card.status };
              if (move.form === "triage")
                body = {
                  ...body,
                  category_id: data.category_id,
                  subcategory: data.subcategory,
                  priority: data.priority,
                  sector_id: data.sector_id,
                };
              if (move.form === "schedule")
                body = {
                  ...body,
                  team_id: data.team_id,
                  scheduled_at: data.scheduled_at,
                  responsible: data.responsible,
                  assigned_user_id: data.assigned_user_id || null,
                  notes: data.notes,
                };
              if (move.form === "location")
                body = {
                  ...body,
                  lat: Number(data.lat),
                  lng: Number(data.lng),
                };
              if (move.form === "notes") body.notes = data.notes;
              if (move.form === "reason") body.reason = data.reason;
              await api(
                move.action === "programar"
                  ? "/ordens-servico"
                  : `${base}/${move.action}`,
                "POST",
                move.action === "programar"
                  ? { ...body, occurrence_ids: [card.id] }
                  : body,
              );
              setSaved(true);
              try {
                await onSaved();
              } catch {
                setError(
                  "A movimentação foi salva, mas não foi possível atualizar o quadro.",
                );
              }
            } catch (err: any) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {move.form === "triage" && (
            <div className="form-grid">
              <label>
                Categoria
                <select
                  aria-label="Categoria"
                  required
                  value={data.category_id}
                  onChange={(e) => {
                    const cat = boot.catalogs.find(
                      (c: any) => c.id === e.target.value,
                    );
                    setData((d: any) => ({
                      ...d,
                      category_id: e.target.value,
                      subcategory: cat?.subcategories?.[0] || "",
                      sector_id: cat?.sector_id || d.sector_id,
                    }));
                  }}
                >
                  {boot.catalogs
                    .filter((c: any) => c.kind === "categorias")
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Subcategoria
                <input
                  required
                  maxLength={2000}
                  value={data.subcategory}
                  onChange={(e) => set("subcategory", e.target.value)}
                />
              </label>
              <label>
                Setor
                <select
                  aria-label="Setor"
                  required
                  value={data.sector_id}
                  onChange={(e) => set("sector_id", e.target.value)}
                >
                  {boot.catalogs
                    .filter((c: any) => c.kind === "setores")
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Prioridade
                <select
                  aria-label="Prioridade"
                  value={data.priority}
                  onChange={(e) => set("priority", e.target.value)}
                >
                  {boot.priorities.map((p: string) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {move.form === "schedule" && (
            <div className="form-grid">
              <label>
                Equipe
                <select
                  aria-label="Equipe"
                  required
                  value={data.team_id}
                  onChange={(e) => {
                    const t = teams.find((t: any) => t.id === e.target.value);
                    setData((d: any) => ({
                      ...d,
                      team_id: e.target.value,
                      responsible: t?.leader || "",
                      assigned_user_id: "",
                    }));
                  }}
                >
                  <option value="">Selecione a equipe</option>
                  {teams.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data programada
                <input
                  type="date"
                  required
                  value={data.scheduled_at}
                  onChange={(e) => set("scheduled_at", e.target.value)}
                />
              </label>
              <label>
                Responsável
                <input
                  required
                  maxLength={2000}
                  value={data.responsible}
                  onChange={(e) => set("responsible", e.target.value)}
                />
              </label>
              <label>
                Operador
                <select
                  aria-label="Operador"
                  value={data.assigned_user_id}
                  onChange={(e) => set("assigned_user_id", e.target.value)}
                >
                  <option value="">Toda a equipe</option>
                  {operators.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Orientações
                <textarea
                  maxLength={3000}
                  value={data.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </label>
            </div>
          )}
          {move.form === "location" && (
            <>
              <p>
                Confirme a chegada ao serviço. As fotos de antes exigidas pela
                categoria precisam estar anexadas.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={gps}
                disabled={locating || busy}
              >
                <LocateFixed size={16} />
                {locating ? "Obtendo localização..." : "Usar minha localização"}
              </button>
              <div className="form-grid">
                <label>
                  Latitude de chegada
                  <input
                    type="number"
                    required
                    step="any"
                    min={-90}
                    max={90}
                    value={data.lat}
                    onChange={(e) => set("lat", e.target.value)}
                  />
                </label>
                <label>
                  Longitude de chegada
                  <input
                    type="number"
                    required
                    step="any"
                    min={-180}
                    max={180}
                    value={data.lng}
                    onChange={(e) => set("lng", e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
          {move.form === "notes" && (
            <>
              <p>
                Fotos de depois e materiais exigidos precisam estar registrados
                antes de enviar para validação.
              </p>
              <label>
                Relato da execução
                <textarea
                  required
                  maxLength={2000}
                  rows={4}
                  value={data.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </label>
            </>
          )}
          {move.form === "reason" && (
            <label>
              Justificativa
              <textarea
                required
                maxLength={2000}
                rows={4}
                value={data.reason}
                onChange={(e) => set("reason", e.target.value)}
              />
            </label>
          )}
          {move.form === "confirm" && (
            <p>
              {move.action === "validar"
                ? "Confirme que você conferiu as fotos, os materiais e o resultado do serviço. A aprovação encerra a ordem e registra seu nome no histórico."
                : "Confirme o deslocamento da equipe para este serviço."}
            </p>
          )}
          {card.type === "order" &&
            ["location", "notes", "confirm"].includes(move.form) && (
              <button
                type="button"
                className="text-button"
                disabled={busy || locating}
                onClick={() => {
                  onClose();
                  onOpen(card.type, card.id, "execution");
                }}
              >
                Abrir fotos, materiais e detalhes
              </button>
            )}
          <footer>
            <button
              type="button"
              className="button secondary"
              disabled={busy || locating}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy || locating}>
              {busy ? "Salvando..." : "Confirmar movimentação"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
