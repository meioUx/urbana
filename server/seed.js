import { randomUUID } from "node:crypto";
import { hashPassword, now } from "./domain.js";

export async function seed(db) {
  if (await db.get("SELECT id FROM users LIMIT 1")) return;
  const demo = process.env.DEMO_DATA !== "false";
  if (!demo && !process.env.ADMIN_PASSWORD)
    throw new Error("Defina ADMIN_PASSWORD ao desativar dados demonstrativos.");
  const password = process.env.ADMIN_PASSWORD || "Urbana@2026";
  if (password.length < 10)
    throw new Error("ADMIN_PASSWORD deve ter pelo menos 10 caracteres.");
  const users = [
    ["admin", "Ana Martins", "admin@urbana.local", "Administrador", null],
    ...(demo
      ? [
          ["gestor", "Carlos Oliveira", "gestor@urbana.local", "Gestor", null],
          ["triagem", "Marina Souza", "triagem@urbana.local", "Triagem", null],
          [
            "campo",
            "João Santos",
            "campo@urbana.local",
            "Equipe de Campo",
            "team-1",
          ],
          [
            "fiscal",
            "Paula Costa",
            "fiscal@urbana.local",
            "Fiscalização",
            null,
          ],
          ["consulta", "Visitante", "consulta@urbana.local", "Consulta", null],
        ]
      : []),
  ];
  for (const [id, name, email, role, team] of users)
    await db.run("INSERT INTO users VALUES(?,?,?,?,?,?)", [
      id,
      name,
      email,
      hashPassword(password),
      role,
      team,
    ]);
  const catalogs = [
    ["secretary-1", "secretarias", { name: "Secretaria de Obras" }],
    [
      "department-1",
      "departamentos",
      { name: "Departamento de Manutenção", parent_id: "secretary-1" },
    ],
    [
      "sector-1",
      "setores",
      { name: "Manutenção Viária", parent_id: "department-1" },
    ],
    [
      "sector-2",
      "setores",
      { name: "Serviços Urbanos", parent_id: "department-1" },
    ],
    [
      "team-1",
      "equipes",
      {
        name: "Equipe 01 · Pavimentação",
        sector_id: "sector-1",
        leader: "João Santos",
        members: 5,
      },
    ],
    [
      "team-2",
      "equipes",
      {
        name: "Equipe 02 · Pavimentação",
        sector_id: "sector-1",
        leader: "Pedro Lima",
        members: 4,
      },
    ],
    [
      "team-3",
      "equipes",
      {
        name: "Equipe 03 · Serviços urbanos",
        sector_id: "sector-2",
        leader: "Lucas Alves",
        members: 6,
      },
    ],
    [
      "category-1",
      "categorias",
      {
        name: "Pavimentação",
        subcategories: [
          "Buraco",
          "Afundamento",
          "Trinca",
          "Desgaste",
          "Recapeamento",
        ],
        sector_id: "sector-1",
        sla: {
          Emergencial: 24,
          Alta: 48,
          Média: 120,
          Baixa: 240,
          Programada: 360,
        },
        require_before: true,
        require_after: true,
        require_material: true,
      },
    ],
    [
      "category-2",
      "categorias",
      {
        name: "Drenagem",
        subcategories: ["Boca de lobo", "Obstrução", "Alagamento"],
        sector_id: "sector-2",
        sla: {
          Emergencial: 24,
          Alta: 48,
          Média: 120,
          Baixa: 240,
          Programada: 360,
        },
        require_before: true,
        require_after: true,
        require_material: false,
      },
    ],
    [
      "category-3",
      "categorias",
      {
        name: "Sinalização",
        subcategories: ["Placa", "Pintura viária", "Semáforo"],
        sector_id: "sector-2",
        sla: {
          Emergencial: 24,
          Alta: 24,
          Média: 120,
          Baixa: 240,
          Programada: 360,
        },
        require_before: true,
        require_after: true,
        require_material: false,
      },
    ],
    ["material-1", "materiais", { name: "CBUQ", unit: "kg", unit_cost: 0.85 }],
    [
      "material-2",
      "materiais",
      { name: "Massa asfáltica fria", unit: "kg", unit_cost: 1.9 },
    ],
    [
      "material-3",
      "materiais",
      { name: "Brita graduada", unit: "m³", unit_cost: 125 },
    ],
    [
      "equipment-1",
      "equipamentos",
      { name: "Caminhão basculante", code: "VEI-012" },
    ],
    [
      "equipment-2",
      "equipamentos",
      { name: "Rolo compactador", code: "EQP-008" },
    ],
  ];
  for (const [id, kind, data] of catalogs)
    await db.run("INSERT INTO catalogs VALUES(?,?,?)", [
      id,
      kind,
      JSON.stringify(data),
    ]);
  await db.run("INSERT INTO settings VALUES(?,?)", [
    "general",
    JSON.stringify({
      duplicate_radius: 10,
      municipality: "Balneário Camboriú",
      demo,
    }),
  ]);
  if (!demo) return;
  const locations = [
    [
      "Av. Brasil, 1450",
      "Centro",
      -26.992,
      -48.635,
      "Buraco junto à faixa de pedestres",
      "Emergencial",
    ],
    [
      "Rua 1500, 320",
      "Centro",
      -26.997,
      -48.636,
      "Afundamento na pista de rolamento",
      "Alta",
    ],
    [
      "Av. do Estado, 2800",
      "Nações",
      -26.98,
      -48.642,
      "Desgaste do pavimento próximo ao cruzamento",
      "Média",
    ],
    [
      "Rua 3100, 180",
      "Centro",
      -27.007,
      -48.626,
      "Buraco na via de acesso",
      "Alta",
    ],
    [
      "Rua Itália, 640",
      "Nações",
      -26.977,
      -48.65,
      "Reparo em pavimentação asfáltica",
      "Média",
    ],
    [
      "Av. Marginal Oeste, 950",
      "Municípios",
      -27.01,
      -48.654,
      "Trinca longitudinal no pavimento",
      "Baixa",
    ],
    [
      "Rua Corupá, 220",
      "Municípios",
      -27.018,
      -48.65,
      "Depressão próxima ao ponto de ônibus",
      "Alta",
    ],
    [
      "Av. Atlântica, 3400",
      "Centro",
      -27.004,
      -48.618,
      "Recomposição de pavimento",
      "Programada",
    ],
    ["Rua 2000, 520", "Centro", -27.0, -48.64, "Buraco após chuvas", "Média"],
    [
      "Rua 1001, 90",
      "Centro",
      -26.985,
      -48.637,
      "Reparo próximo à escola",
      "Alta",
    ],
    [
      "Rua 3700, 240",
      "Barra Sul",
      -27.013,
      -48.625,
      "Pavimento irregular",
      "Baixa",
    ],
    [
      "Rua Dom Afonso, 155",
      "Vila Real",
      -27.021,
      -48.639,
      "Buraco na esquina",
      "Emergencial",
    ],
  ];
  const states = [
    "IDENTIFICADA",
    "EM_TRIAGEM",
    "PROGRAMADA",
    "EM_EXECUCAO",
    "AGUARDANDO_VALIDACAO",
    "CONCLUIDA",
    "IDENTIFICADA",
    "PROGRAMADA",
    "EM_TRIAGEM",
    "CONCLUIDA",
    "IDENTIFICADA",
    "IDENTIFICADA",
  ];
  for (let i = 0; i < locations.length; i++) {
    const [address, neighborhood, lat, lng, description, priority] =
      locations[i];
    const id = randomUUID(),
      created = new Date(Date.now() - (i + 1) * 8 * 3600000).toISOString();
    await db.run(
      "INSERT INTO occurrences(id,code,category_id,sector_id,status,priority,lat,lng,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        `OC-2026-${String(i + 1).padStart(5, "0")}`,
        "category-1",
        "sector-1",
        states[i],
        priority,
        lat,
        lng,
        created,
        created,
        JSON.stringify({
          address,
          neighborhood,
          description,
          subcategory: i === 1 ? "Afundamento" : "Buraco",
          origin: "Fiscalização municipal",
          reference: "",
          creator_id: "admin",
          demo: true,
        }),
      ],
    );
    await db.run("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)", [
      randomUUID(),
      "occurrence",
      id,
      "admin",
      "Ocorrência demonstrativa registrada",
      null,
      JSON.stringify({ status: states[i] }),
      created,
    ]);
    if (
      [
        "PROGRAMADA",
        "EM_EXECUCAO",
        "AGUARDANDO_VALIDACAO",
        "CONCLUIDA",
      ].includes(states[i])
    ) {
      const oid = randomUUID();
      await db.run("INSERT INTO orders(id,code,sector_id,team_id,status,priority,due_at,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)", [
        oid,
        `OS-2026-${String(i + 1).padStart(5, "0")}`,
        "sector-1",
        i % 2 ? "team-1" : "team-2",
        states[i],
        priority,
        new Date(new Date(created).getTime() + 120 * 3600000).toISOString(),
        created,
        created,
        JSON.stringify({
          scheduled_at: created.slice(0, 10),
          responsible: "João Santos",
          notes: "Registro demonstrativo",
          started_at: states[i] === "PROGRAMADA" ? null : created,
          completed_at: states[i] === "CONCLUIDA" ? now() : null,
          demo: true,
        }),
      ]);
      await db.run("INSERT INTO order_occurrences VALUES(?,?)", [oid, id]);
    }
  }
}
