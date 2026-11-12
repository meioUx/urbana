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
      // The entry date of an order is the creation of its oldest occurrence (or of the order itself);
      // only orders whose entry date falls in the month are read, with all their occurrences in one
      // query instead of one query per order.
      const filter = `${sectorId ? "o.sector_id=? AND " : ""}COALESCE((SELECT NULLIF(MIN(c.created_at),'') FROM order_occurrences r JOIN occurrences c ON c.id=r.occurrence_id WHERE r.order_id=o.id),o.created_at) LIKE ?`;
      const args = [...(sectorId ? [sectorId] : []), `${month}%`];
      const orders = (
        await db.all(
          `SELECT o.* FROM orders o WHERE ${filter} ORDER BY o.created_at,o.id`,
          args,
        )
      ).map(unpack);
      const linked = new Map();
      for (const { link_order_id, ...row } of await db.all(
        `SELECT c.*,r.order_id AS link_order_id FROM order_occurrences r JOIN occurrences c ON c.id=r.occurrence_id WHERE r.order_id IN (SELECT o.id FROM orders o WHERE ${filter}) ORDER BY r.order_id,c.created_at,c.id`,
        args,
      )) {
        if (!linked.has(link_order_id)) linked.set(link_order_id, []);
        linked.get(link_order_id).push(unpack(row));
      }
      const categories = new Map(
        (await db.all("SELECT * FROM catalogs WHERE kind='categorias'"))
          .map(unpack)
          .map((category) => [category.id, category]),
      );
      const rows = [];
      for (const order of orders) {
        const occurrences = linked.get(order.id) || [];
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
