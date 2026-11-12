import type { Row } from "../../shared/types";

/** Exporta a página atual em CSV (separador ";", BOM UTF-8 e proteção contra fórmulas). */
export function exportCsv(page: string, data: Row[]) {
  const columns =
    page === "orders"
      ? ["code", "status", "priority", "due_at", "responsible"]
      : ["code", "address", "neighborhood", "status", "priority", "lat", "lng"];
  const cell = (v: any) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replace(/"/g, '""')}"`;
  const blob = new Blob(
    [
      "﻿" +
        [
          columns.join(";"),
          ...data.map((r) => columns.map((k) => cell(r[k])).join(";")),
        ].join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8;" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `urbana-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
