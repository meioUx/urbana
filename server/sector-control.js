import { unpack } from "./domain.js";

const serviceCodes = [
  ["boca de lobo", "BC", "Boca de lobo"],
  ["infiltr", "INF", "Infiltração"],
  ["buraco", "BU", "Buracos"],
  ["limpeza", "LI", "Limpeza"],
  ["poda", "PO", "Poda"],
  ["patrol", "PA", "Patrolar rua"],
  ["asfalto", "ASF", "Asfalto"],
  ["recape", "ASF", "Asfalto"],
  ["chuveiro", "CHU", "Chuveiro"],
  ["grelha", "GRE", "Grelha"],
  ["meio fio", "MF", "Meio-fio"],
  ["volum", "VOL", "Volumosos"],
  ["obstru", "DRE", "Drenagem"],
  ["alag", "DRE", "Drenagem"],
  ["drenag", "DRE", "Drenagem"],
];

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function serviceCode(occurrence, category) {
  const source = normalize(
    `${occurrence.subcategory} ${category?.name} ${occurrence.description}`,
  );
  const match = serviceCodes.find(([term]) => source.includes(term));
  return match
    ? { code: match[1], label: match[2] }
    : { code: "OUT", label: "Outros" };
}

export function contactChannel(occurrence) {
  const value = normalize(`${occurrence.origin} ${occurrence.requested_by}`);
  if (value.includes("ouvidoria")) return "Ouvidoria";
  if (value.includes("whats")) return "Whats";
  return "Geral";
}

export function registerSectorControl(app, db, { route, allow }) {
  app.get(
    "/api/controle-setor",
    allow("schedule"),
    route(async (req) => {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
        ? String(req.query.month)
        : new Date().toISOString().slice(0, 7);
      const sectorId = String(req.query.sector_id || "");
      const orders = (await db.all("SELECT * FROM orders ORDER BY created_at"))
        .map(unpack)
        .filter((order) => !sectorId || order.sector_id === sectorId);
      const categories = new Map(
        (await db.all("SELECT * FROM catalogs WHERE kind='categorias'"))
          .map(unpack)
          .map((category) => [category.id, category]),
      );
      const rows = [];
      for (const order of orders) {
        const occurrences = (
          await db.all(
            "SELECT c.* FROM occurrences c JOIN order_occurrences r ON r.occurrence_id=c.id WHERE r.order_id=? ORDER BY c.created_at",
            [order.id],
          )
        ).map(unpack);
        const primary = occurrences[0] || {};
        const entryDate = primary.created_at || order.created_at;
        if (entryDate.slice(0, 7) !== month) continue;
        const classification = serviceCode(
          primary,
          categories.get(primary.category_id),
        );
        rows.push({
          id: order.id,
          entry_date: entryDate,
          service_code: classification.code,
          service_label: classification.label,
          service_quantity: occurrences.length,
          order_number: order.code,
          requester: primary.requested_by || primary.origin || "—",
          address: occurrences
            .map((item) => item.address)
            .filter(Boolean)
            .join("; "),
          description:
            order.notes ||
            occurrences
              .map((item) => item.description)
              .filter(Boolean)
              .join("; "),
          contact: contactChannel(primary),
          contact_quantity: 1,
          responsible: order.responsible,
          team_id: order.team_id,
          sector_id: order.sector_id,
          completion_date: order.completed_at || null,
          completed: order.status === "CONCLUIDA" ? 1 : 0,
          status: order.status,
        });
      }
      const codes = [
        ["BC", "Boca de lobo"],
        ["DRE", "Drenagem"],
        ["INF", "Infiltração"],
        ["BU", "Buracos"],
        ["LI", "Limpeza"],
        ["PO", "Poda"],
        ["PA", "Patrolar rua"],
        ["ASF", "Asfalto"],
        ["CHU", "Chuveiro"],
        ["GRE", "Grelha"],
        ["MF", "Meio-fio"],
        ["VOL", "Volumosos"],
        ["OUT", "Outros"],
      ].map(([code, label]) => ({
        code,
        label,
        quantity: rows
          .filter((row) => row.service_code === code)
          .reduce((total, row) => total + row.service_quantity, 0),
      }));
      const contacts = ["Ouvidoria", "Geral", "Whats"].map((channel) => ({
        channel,
        quantity: rows
          .filter((row) => row.contact === channel)
          .reduce((total, row) => total + row.contact_quantity, 0),
      }));
      const totalServices = rows.reduce(
        (total, row) => total + row.service_quantity,
        0,
      );
      const completed = rows.reduce((total, row) => total + row.completed, 0);
      return {
        month,
        sector_id: sectorId || null,
        rows,
        summary: {
          orders: rows.length,
          services: totalServices,
          completed,
          completion_rate: rows.length ? completed / rows.length : 0,
          codes,
          contacts,
        },
      };
    }),
  );
}
