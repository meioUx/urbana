import test from "node:test";
import assert from "node:assert/strict";
import { parseInvoiceText } from "../server/invoices.js";

test("invoice parser produces a reviewable draft from Brazilian values", () => {
  const draft = parseInvoiceText(`
    NOTA FISCAL Nº 45678
    RAZÃO SOCIAL: Fornecedora Municipal Ltda
    EMULSÃO ASFÁLTICA RR-2C 20,000 KG 6,5000 130,00
    MASSA ASFÁLTICA ENSACADA 10,000 SC 42,0000 420,00
    VALOR TOTAL DA NOTA 550,00
  `);
  assert.equal(draft.invoice_number, "45678");
  assert.equal(draft.supplier, "Fornecedora Municipal Ltda");
  assert.equal(draft.total_value, 550);
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].purchased_quantity, 20);
  assert.equal(draft.items[0].unit_value, 6.5);
  assert.equal(draft.extraction_status, "itens_encontrados");
});

test("scanned invoice is flagged for manual review instead of inventing items", () => {
  const draft = parseInvoiceText("");
  assert.equal(draft.extraction_status, "sem_texto");
  assert.deepEqual(draft.items, []);
});
