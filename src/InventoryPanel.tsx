import { useEffect, useState } from "react";
import "./inventory.css";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, FileText, ShoppingCart } from "lucide-react";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value || 0);
const statusLabel: Record<string, string> = { sem_estoque: "Sem estoque", baixo: "Abaixo do mínimo", repor: "Comprar", adequado: "Adequado" };

export default function InventoryPanel({ api, catalogs, readOnly = false }: { readOnly?: boolean; api: (path: string, method?: string, body?: any) => Promise<any>; catalogs: any[] }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [movement, setMovement] = useState({ material_id: "", type: "entrada", quantity: 1, unit_cost: 0, notes: "" });
  const [movementCursor,setMovementCursor] = useState("");
  const [movementBack,setMovementBack] = useState<string[]>([]);
  const [movementPage,setMovementPage] = useState<any>({has_more:false});
  const loadMovements = async (cursor="") => {const result=await api("/almoxarifado/movimentos?limit=50"+(cursor?"&cursor="+encodeURIComponent(cursor):""));setMovementPage(result);setData((old:any)=>old?{...old,movements:result.items}:old);};
  const load = async () => { const [result,page] = await Promise.all([api("/almoxarifado"),api("/almoxarifado/movimentos?limit=50")]); setData({...result,movements:page.items});setMovementPage(page);setMovementCursor("");setMovementBack([]);setError(""); };
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  const materials = data?.materials || [];
  const totalValue = materials.reduce((sum: number, item: any) => sum + item.stock_value, 0);
  const purchaseValue = materials.reduce((sum: number, item: any) => sum + item.suggested_purchase * item.average_cost, 0);
  if (!data) return error ? <div className="notice error" role="alert">{error}<button className="button secondary" onClick={() => { setError(""); load().catch((e) => setError(e.message)); }}>Tentar novamente</button></div> : <p className="muted" role="status">Carregando almoxarifado...</p>;
  return <div className="inventory-module">
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="notice" role="status">{success}</p>}
    <div className="inventory-kpis">
      <article><Boxes/><span><small>Valor em estoque</small><strong>{money(totalValue)}</strong></span></article>
      <article><AlertTriangle/><span><small>Itens para repor</small><strong>{materials.filter((item: any) => item.suggested_purchase > 0).length}</strong></span></article>
      <article><ShoppingCart/><span><small>Compra sugerida · 3 meses</small><strong>{money(purchaseValue)}</strong></span></article>
    </div>
    <div className="section-heading"><div><h2>Almoxarifado</h2><p className="muted">Saldo, consumo dos últimos 90 dias e cobertura projetada.</p></div></div>
    <div className="table-scroll"><table><thead><tr><th>Material</th><th>Saldo</th><th>Custo médio</th><th>Consumo · 90 dias</th><th>Estoque mínimo</th><th>Compra sugerida · 3 meses</th><th>Situação</th></tr></thead>
      <tbody>{materials.map((item: any) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{quantity(item.stock)} {item.unit}</td><td>{money(item.average_cost)}</td><td>{quantity(item.consumed_90_days)} {item.unit}</td><td>{quantity(item.minimum_stock)} {item.unit}</td><td><strong>{quantity(item.suggested_purchase)} {item.unit}</strong><small className="cell-note">{money(item.suggested_purchase * item.average_cost)}</small></td><td><span className={`stock-status ${item.status}`}>{statusLabel[item.status]}</span></td></tr>)}</tbody>
    </table></div>
    {!readOnly && <form className="inventory-adjustment" onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); setSuccess(""); try { await api("/almoxarifado/movimentos", "POST", movement); setSuccess("Movimento registrado. O saldo foi atualizado no almoxarifado."); setMovement({ material_id: "", type: "entrada", quantity: 1, unit_cost: 0, notes: "" }); try { await load(); } catch { setError("O movimento foi salvo, mas o saldo exibido não foi atualizado. Atualize a página antes de registrar outro movimento."); } } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>
      <div className="section-heading"><div><h2>Ajuste manual</h2><p className="muted">Use para inventário inicial, correções e saídas sem ordem de serviço.</p></div></div>
      <div className="form-grid">
        <label>Material<select required value={movement.material_id} onChange={(e) => setMovement({ ...movement, material_id: e.target.value })}><option value="">Selecione</option>{catalogs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Movimento<select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label>
        <label>Quantidade<input required min="0.001" step="0.001" type="number" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: Number(e.target.value) })}/></label>
        <label>Custo unitário<input required min="0" step="0.01" type="number" value={movement.unit_cost} onChange={(e) => setMovement({ ...movement, unit_cost: Number(e.target.value) })}/></label>
        <label className="wide">Motivo<input required value={movement.notes} onChange={(e) => setMovement({ ...movement, notes: e.target.value })} placeholder="Ex.: inventário inicial ou correção de contagem"/></label>
      </div><button className="button primary" disabled={busy}>{movement.type === "entrada" ? <ArrowDownToLine size={17}/> : <ArrowUpFromLine size={17}/>} {busy ? "Salvando..." : "Registrar movimento"}</button>
    </form>}
    <section aria-label="Histórico de movimentos"><div className="section-heading recent"><h2>Movimentos de estoque</h2></div><div className="form-actions"><button className="button secondary" disabled={busy||!movementBack.length} onClick={async()=>{setBusy(true);try{const cursor=movementBack.at(-1)||"";await loadMovements(cursor);setMovementCursor(cursor);setMovementBack(movementBack.slice(0,-1));}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>Anterior</button><span role="status">Página {movementBack.length+1}</span><button className="button secondary" disabled={busy||!movementPage.has_more} onClick={async()=>{setBusy(true);try{await loadMovements(movementPage.next_cursor);setMovementBack([...movementBack,movementCursor]);setMovementCursor(movementPage.next_cursor);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>Próxima</button></div><div className="table-scroll"><table><thead><tr><th>Data</th><th>Material</th><th>Tipo</th><th>Quantidade</th><th>Usuário / motivo</th></tr></thead><tbody>{data.movements.map((row:any)=><tr key={row.id}><td>{new Date(row.created_at).toLocaleString("pt-BR")}</td><td>{materials.find((m:any)=>m.id===row.material_id)?.name||row.material_id}</td><td>{row.type==="entrada"?"Entrada":"Saída"}</td><td>{quantity(row.quantity)}</td><td>{row.user_name} · {row.notes}</td></tr>)}</tbody></table></div>{!data.movements.length&&<p>Nenhum movimento registrado.</p>}</section>
    <div className="section-heading recent"><h2>Notas fiscais recentes</h2></div>
    <div className="inventory-feed">{data.invoices.map((invoice: any) => <a key={invoice.id} href={`/api/notas-fiscais/${invoice.id}/arquivo`} target="_blank" rel="noreferrer"><FileText size={20}/><span><strong>NF {invoice.invoice_number || "em conferência"} · {invoice.supplier || invoice.original_name}</strong><small>{invoice.order_code} · {invoice.status} · {money(invoice.total_value)}</small></span></a>)}</div>
  </div>;
}
