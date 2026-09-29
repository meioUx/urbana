import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";

export const inventoryStages = ["registro", "triagem", "execucao", "validacao", "outros"];
export const stageLabels = {
  registro: "Registro da ocorrência",
  triagem: "Triagem e planejamento",
  execucao: "Execução do serviço",
  validacao: "Validação e encerramento",
  outros: "Outros",
};
const currencyPattern = /\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+[.,]\d{2,4}/g;
const decimal = (value) => {
  const raw = String(value || "").trim();
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw) || 0;
};

export function parseInvoiceText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = lines.join("\n");
  const after = (pattern) => {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) return "";
    const inline = lines[index].replace(pattern, "").replace(/^\s*[:\-]?\s*/, "");
    return inline || lines[index + 1] || "";
  };
  let totalValue = 0;
  const totalIndex = lines.findIndex((line) => /VALOR TOTAL (?:DA NOTA|DA NF|DOS PRODUTOS)/i.test(line));
  for (const line of totalIndex < 0 ? [] : lines.slice(totalIndex, totalIndex + 3)) {
    const values = line.match(currencyPattern) || [];
    if (values.length) totalValue = decimal(values.at(-1));
    if (totalValue) break;
  }
  const items = [];
  for (const line of lines) {
    if (/TOTAL|IMPOSTO|BASE DE C[ÁA]LCULO|FRETE|DESCONTO/i.test(line)) continue;
    const values = [...line.matchAll(currencyPattern)];
    if (values.length < 2) continue;
    const unitValue = decimal(values.at(-2)[0]);
    const productTotal = decimal(values.at(-1)[0]);
    const prefix = line.slice(0, values.at(-2).index).trim();
    const quantityMatch = prefix.match(/(?:^|\s)(\d+(?:[.,]\d{1,4})?)\s*(UN|UND|UNID|KG|T|M|M2|M²|M3|M³|L|LT|PC|PÇ|CX|SC|SACO)?\s*$/i);
    if (!quantityMatch || !unitValue || !productTotal) continue;
    const quantity = decimal(quantityMatch[1]);
    const description = prefix.slice(0, quantityMatch.index).replace(/^\d+\s+/, "").trim();
    if (!description || !quantity || Math.abs(quantity * unitValue - productTotal) > Math.max(2, productTotal * 0.08)) continue;
    items.push({ description: description.slice(0, 300), purchased_quantity: quantity, used_quantity: 0, unit: (quantityMatch[2] || "UN").toUpperCase(), unit_value: unitValue, product_total: productTotal, stage: "execucao", material_id: null });
  }
  const invoiceMatch = joined.match(/(?:N(?:OTA)?\s*(?:FISCAL)?\s*(?:N[º°O.]|NÚMERO|NUMERO)?\s*[:\-]?\s*)(\d{1,20})/i);
  return {
    supplier: after(/(?:NOME\s*\/\s*)?RAZ[ÃA]O SOCIAL|EMITENTE/i).slice(0, 200),
    invoice_number: invoiceMatch?.[1] || "",
    issue_date: "",
    total_value: totalValue || items.reduce((sum, item) => sum + item.product_total, 0),
    items,
    extraction_status: !text.trim() ? "sem_texto" : items.length ? "itens_encontrados" : "revisao_manual",
  };
}

async function extractPdf(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], value: item.str.trim() });
    }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((cell) => cell.value).join(" ")).join("\n"));
  }
  await pdf.destroy();
  return pages.join("\n");
}

const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  material_id: z.string().nullable().optional(),
  stage: z.enum(inventoryStages),
  purchased_quantity: z.number().positive().max(1e9),
  used_quantity: z.number().min(0).max(1e9),
  unit: z.string().trim().min(1).max(20),
  unit_value: z.number().min(0).max(1e9),
  product_total: z.number().min(0).max(1e11),
});

export function registerInvoices(app, db, helpers) {
  const { route, allow, audit, fail, accessOrder, now } = helpers;
  const folder = resolve(process.env.DATA_DIR || "data", "invoices");
  mkdirSync(folder, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({ destination: folder, filename: (_req, _file, callback) => callback(null, `${randomUUID()}.pdf`) }),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/pdf"),
  });
  const hydrate = async (invoice) => invoice ? ({ ...invoice, ...JSON.parse(invoice.data || "{}"), data: undefined, items: await db.all("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position", [invoice.id]) }) : null;

  app.post("/api/ordens-servico/:id/notas-fiscais/extrair", allow("schedule"), upload.single("file"), route(async (req) => {
    if (!req.file) fail(400, "Selecione uma nota fiscal em PDF.");
    const order = await accessOrder(req, req.params.id);
    if (readFileSync(req.file.path).subarray(0, 5).toString() !== "%PDF-") { unlinkSync(req.file.path); fail(400, "O arquivo enviado não é um PDF válido."); }
    let rawText;
    try { rawText = await extractPdf(req.file.path); }
    catch { unlinkSync(req.file.path); fail(400, "Não foi possível ler este PDF. Verifique se ele não está protegido ou corrompido."); }
    const parsed = parseInvoiceText(rawText);
    const id = randomUUID();
    await db.run("INSERT INTO invoices(id,order_id,status,supplier,invoice_number,issue_date,total_value,filename,original_name,user_id,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [id, order.id, "RASCUNHO", parsed.supplier, parsed.invoice_number, null, parsed.total_value, req.file.filename, req.file.originalname, req.user.id, now(), JSON.stringify({ extraction_status: parsed.extraction_status, raw_text: rawText.slice(0, 200000) })]);
    for (const [position, item] of parsed.items.entries()) await db.run("INSERT INTO invoice_items(id,invoice_id,material_id,stage,description,purchased_quantity,used_quantity,unit,unit_value,product_total,position) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), id, null, item.stage, item.description, item.purchased_quantity, item.used_quantity, item.unit, item.unit_value, item.product_total, position]);
    await audit(req, "invoice", id, "Nota fiscal enviada para conferência", null, { order_id: order.id, original_name: req.file.originalname, extraction_status: parsed.extraction_status });
    return hydrate(await db.get("SELECT * FROM invoices WHERE id=?", [id]));
  }, true));

  app.post("/api/notas-fiscais/:id/confirmar", allow("schedule"), route(async (req) => {
    const invoice = await db.get("SELECT * FROM invoices WHERE id=?", [req.params.id]);
    if (!invoice) fail(404, "Nota fiscal não encontrada.");
    await accessOrder(req, invoice.order_id);
    if (invoice.status === "CONFIRMADA") fail(409, "Esta nota fiscal já foi confirmada.");
    const data = z.object({ supplier: z.string().trim().min(1).max(200), invoice_number: z.string().trim().min(1).max(40), issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), total_value: z.number().min(0).max(1e11), items: z.array(itemSchema).min(1).max(200) }).parse(req.body);
    for (const item of data.items) {
      if (item.used_quantity > item.purchased_quantity) fail(400, "A quantidade aplicada na OS não pode superar a quantidade comprada.");
      if (item.material_id && !(await db.get("SELECT id FROM catalogs WHERE id=? AND kind='materiais'", [item.material_id]))) fail(400, "Um dos materiais vinculados não existe.");
    }
    if (await db.get("SELECT id FROM invoices WHERE status='CONFIRMADA' AND supplier=? AND invoice_number=? AND id<>?", [data.supplier, data.invoice_number, invoice.id])) fail(409, "Já existe uma nota confirmada com este fornecedor e número.");
    await db.run("DELETE FROM invoice_items WHERE invoice_id=?", [invoice.id]);
    for (const [position, item] of data.items.entries()) await db.run("INSERT INTO invoice_items(id,invoice_id,material_id,stage,description,purchased_quantity,used_quantity,unit,unit_value,product_total,position) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), invoice.id, item.material_id || null, item.stage, item.description, item.purchased_quantity, item.used_quantity, item.unit, item.unit_value, item.product_total, position]);
    await db.run("UPDATE invoices SET status='CONFIRMADA',supplier=?,invoice_number=?,issue_date=?,total_value=?,data=? WHERE id=?", [data.supplier, data.invoice_number, data.issue_date || null, data.total_value, JSON.stringify({ ...JSON.parse(invoice.data || "{}"), confirmed_at: now(), confirmed_by: req.user.name }), invoice.id]);
    for (const item of data.items) if (item.material_id && item.purchased_quantity > 0) {
      await db.run("INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), item.material_id, invoice.order_id, invoice.id, "entrada", item.purchased_quantity, item.unit_value, "aquisicao", `NF ${data.invoice_number} · ${data.supplier}`, req.user.id, now()]);
      if (item.used_quantity > 0) await db.run("INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), item.material_id, invoice.order_id, invoice.id, "saida", item.used_quantity, item.unit_value, item.stage, `Aplicação direta da NF ${data.invoice_number} na OS`, req.user.id, now()]);
    }
    await audit(req, "invoice", invoice.id, "Nota fiscal confirmada e entrada lançada", { status: invoice.status }, { status: "CONFIRMADA", order_id: invoice.order_id });
    return hydrate(await db.get("SELECT * FROM invoices WHERE id=?", [invoice.id]));
  }, true));

  app.get("/api/notas-fiscais/:id/arquivo", route(async (req, res) => {
    const invoice = await db.get("SELECT * FROM invoices WHERE id=?", [req.params.id]);
    if (!invoice) fail(404, "Nota fiscal não encontrada.");
    await accessOrder(req, invoice.order_id);
    res.type("application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"${String(invoice.original_name).replace(/[\"\r\n]/g, "")}\"`);
    res.sendFile(resolve(folder, invoice.filename));
  }));
  return { hydrateInvoice: hydrate };
}
