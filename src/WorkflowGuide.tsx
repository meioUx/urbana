import { CheckCircle2, ChevronRight } from "lucide-react";

const steps = ["Analisar demanda", "Programar atendimento", "Executar serviço", "Conferir e encerrar"];
const stage: Record<string, number> = { IDENTIFICADA: 0, EM_TRIAGEM: 1, PROGRAMADA: 2, EM_DESLOCAMENTO: 2, EM_EXECUCAO: 2, DEVOLVIDA: 1, AGUARDANDO_VALIDACAO: 3, CONCLUIDA: 3 };
const guidance: Record<string, string> = {
  IDENTIFICADA: "A triagem deve conferir categoria, prioridade e setor responsável antes da programação.",
  EM_TRIAGEM: "Triagem concluída. A demanda está pronta para programar: escolha equipe, responsável e data. Use Planejamento se precisar comparar obras ou reunir demandas da mesma via.",
  PROGRAMADA: "A equipe deve conferir a programação, registrar a chegada e atender às exigências de evidência antes de iniciar.",
  EM_DESLOCAMENTO: "Registre as coordenadas de chegada e a foto anterior ao serviço quando exigida pela categoria.",
  EM_EXECUCAO: "Registre materiais, evidências e relato. O envio para validação ainda depende da análise da gestão ou fiscalização.",
  DEVOLVIDA: "A gestão deve analisar a justificativa da devolução e reprogramar a equipe ou o operador.",
  AGUARDANDO_VALIDACAO: "A gestão ou fiscalização deve conferir fotos, materiais e relato, e validar ou solicitar correção.",
  CONCLUIDA: "Serviço validado e encerrado. Consulte o histórico e as evidências para conferir o resultado.",
  CANCELADA: "Registro cancelado. Consulte a justificativa no histórico antes de abrir uma nova demanda.",
  RECUSADA: "Demanda recusada na triagem. A justificativa, o responsável e a data permanecem registrados no histórico.",
};

export default function WorkflowGuide({ value, catalogs, onEvidence }: any) {
  const current = stage[value.status];
  const order = value.type === "order";
  const categories = order ? (value.occurrences || []).map((o: any) => catalogs.find((c: any) => c.id === o.category_id)).filter(Boolean) : [];
  const afterSince = [value.started_at, value.reopened_at, value.reprogrammed_at, value.created_at].filter(Boolean).sort().at(-1);
  const photo = (name: string) => (value.evidence || []).some((e: any) => e.stage === name && e.mime?.startsWith("image/") && e.created_at >= (name === "antes" ? value.reprogrammed_at || value.created_at : afterSince));
  const checks = order && ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"].includes(value.status) ? [
    ...(value.status !== "EM_EXECUCAO" && categories.some((c: any) => c.require_before) ? [{ label: "Foto antes de iniciar", done: photo("antes"), evidence: true }] : []),
    ...(value.status === "EM_EXECUCAO" && categories.some((c: any) => c.require_after) ? [{ label: "Foto após o serviço", done: photo("depois"), evidence: true }] : []),
    ...(value.status === "EM_EXECUCAO" && categories.some((c: any) => c.require_material) ? [{ label: "Material utilizado registrado", done: !!value.materials?.length, evidence: false }] : []),
  ] : [];
  return <section className="workflow-guide" aria-label="Andamento e próximo passo">
    {current !== undefined && <ol className="workflow-steps">{steps.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} className={index < current ? "done" : index === current ? "current" : ""}><span>{index < current ? <CheckCircle2 size={15}/> : index + 1}</span>{label}</li>)}</ol>}
    <strong>{["CONCLUIDA", "CANCELADA", "RECUSADA"].includes(value.status) ? "Resultado" : "Próximo passo"}</strong>
    <p>{guidance[value.status]}</p>
    {checks.length > 0 && <ul className="workflow-checks">{checks.map((check) => <li key={check.label}><span>{check.done ? "✓ Registrado" : "Pendente"} · {check.label}</span>{!check.done && check.evidence && <button type="button" className="text-button" onClick={onEvidence}>Anexar foto <ChevronRight size={15}/></button>}</li>)}</ul>}
    {order && value.status === "CONCLUIDA" && value.validated_by && <p>Validado por {value.validated_by}.</p>}
  </section>;
}
