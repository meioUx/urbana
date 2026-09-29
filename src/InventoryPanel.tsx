import { useEffect, useState } from "react";
import "./inventory.css";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, FileText, ShoppingCart } from "lucide-react";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value || 0);
const statusLabel: Record<string, string> = { sem_estoque: "Sem estoque", baixo: "Abaixo do mínimo", repor: "Comprar", adequado: "Adequado" };

export default function InventoryPanel({ api, catalogs }: { api: (path: string, method?: string, body?: any) => Promise<any>; catalogs: any[] }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [movement, setMovement] = useState({ material_id: "", type: "entrada", quantity: 1, unit_cost: 0, notes: "" });
  const load = () => api("/almoxarifado").then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const materials = data?.materials || [];
  const totalValue = materials.reduce((sum: number, item: any) => sum + item.stock_value, 0);
  const purchaseValue = materials.reduce((sum: number, item: any) => sum + item.suggested_purchase * item.average_cost, 0);
  if (!data) return <p className="muted">Carregando almoxarifado...</p>;
  return <div className="inventory-module">
    {error && <p className="form-error">{error}</p>}
    <div className="inventory-kpis">
      <article><Boxes/><span><small>Valor em estoque</small><strong>{money(totalValue)}</strong></span></article>
      <article><AlertTriangle/><span><small>Itens para repor</small><strong>{materials.filter((item: any) => item.suggested_purchase > 0).length}</strong></span></article>
      <article><ShoppingCart/><span><small>Compra sugerida · 3 meses</small><strong>{money(purchaseValue)}</strong></span></article>
    </div>
    <div className="section-heading"><div><h2>Almoxarifado</h2><p className="muted">Saldo, consumo dos últimos 90 dias e cobertura projetada.</p></div></div>
    <div className="table-scroll"><table><thead><tr><th>Material</th><th>Saldo</th><th>Custo médio</th><th>Consumo · 90 dias</th><th>Estoque mínimo</th><th>Compra sugerida · 3 meses</th><th>Situação</th></tr></thead>
      <tbody>{materials.map((item: any) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{quantity(item.stock)} {item.unit}</td><td>{money(item.average_cost)}</td><td>{quantity(item.consumed_90_days)} {item.unit}</td><td>{quantity(item.minimum_stock)} {item.unit}</td><td><strong>{quantity(item.suggested_purchase)} {item.unit}</strong><small className="cell-note">{money(item.suggested_purchase * item.average_cost)}</small></td><td><span className={`stock-status ${item.status}`}>{statusLabel[item.status]}</span></td></tr>)}</tbody>
    </table></div>
    <form className="inventory-adjustment" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await api("/almoxarifado/movimentos", "POST", movement); setMovement({ material_id: "", type: "entrada", quantity: 1, unit_cost: 0, notes: "" }); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>
      <div className="section-heading"><div><h2>Ajuste manual</h2><p className="muted">Use para inventário inicial, correções e saídas sem ordem de serviço.</p></div></div>
      <div className="form-grid">
        <label>Material<select required value={movement.material_id} onChange={(e) => setMovement({ ...movement, material_id: e.target.value })}><option value="">Selecione</option>{catalogs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Movimento<select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label>
        <label>Quantidade<input required min="0.001" step="0.001" type="number" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })}/></label>
        <label>Custo unitário<input required min="0" step="0.01" type="number" value={movement.unit_cost} onChange={(e) => setMovement({ ...movement, unit_cost: Number(e.target.value) })}/></label>
        <label className="wide">Motivo<input required value={movement.notes} onChange={(e) => setMovement({ ...movement, notes: e.target.value })} placeholder="Ex.: inventário inicial ou correção de contagem"/></label>
      </div><button className="button primary" disabled={busy}>{movement.type === "entrada" ? <ArrowDownToLine size={17}/> : <ArrowUpFromLine size={17}/>} {busy ? "Salvando..." : "Registrar movimento"}</button>
    </form>
    <div className="section-heading recent"><h2>Notas fiscais recentes</h2></div>
    <div className="inventory-feed">{data.invoices.map((invoice: any) => <a key={invoice.id} href={`/api/notas-fiscais/${invoice.id}/arquivo`} target="_blank" rel="noreferrer"><FileText size={20}/><span><strong>NF {invoice.invoice_number || "em conferência"} · {invoice.supplier || invoice.original_name}</strong><small>{invoice.order_code} · {invoice.status} · {money(invoice.total_value)}</small></span></a>)}</div>
  </div>;
}
