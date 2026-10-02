# Auditoria P0/P1/P2

Data: 2026-10-02. Fotografia anterior às alterações desta execução. Referência: URBANA-CONTEXTO-MESTRE.md; contratos API.md; decisões DECISIONS.md. Inspeção de server/, src/, shared/, tests/, schema.sql, migrations 1–4 em db.js, package.json e arquivos de implantação. Alterações documentais anteriores no diretório de trabalho serão preservadas. Ausência de migrations/ é organização existente, não ausência de migrations.

## P0

### State machine
Status: ✅ IMPLEMENTADO.
Arquivos: server/domain/workflow.js, server/app.js, tests/workflow.test.js, tests/api.test.js.
Problemas: LOW — Object.freeze protege mapas, mas não os arrays internos de transições; consumidor pode modificar regras globais. Ocorrências têm estados de decisão e projeção da OS, não máquina de execução independente. Reprogramação possui guardas próprias.
Ação necessária: preservar regras/evidências/permissões; tornar tabelas profundamente imutáveis; testar estados terminais, isolamento e tabela completa.

### Concorrência e UX
Status: 🟡 PARCIAL.
Arquivos: server/db.js, server/schema.sql, server/app.js, server/kanban.js, src/main.tsx, src/Operator.tsx.
Problemas: HIGH — nenhuma version em ocorrência/OS/plano; fila local não impede edição com tela antiga nem múltiplos processos. revision e kanban_expected_status protegem somente o quadro.
Ação necessária: migration aditiva, comparação na escrita e 409 VERSION_CONFLICT; preservar formulários e fornecer atualização explícita. Testar duas versões e rollback.

### Paginação, filtros, índices e consultas
Status: ⚠ PROBLEMA.
Arquivos: server/app.js, server/inventory.js, server/planning.js, server/schema.sql, src/main.tsx.
Problemas: HIGH — listas completas, filtros de ocorrência após leitura, OS sem filtros equivalentes; MEDIUM — mapa/proximidade/painel/planejamento amplos; almoxarifado lê tudo para cortar 100; audit limita 300 sem pesquisa. Índices existentes cobrem status/localização/equipe/histórico, mas não todos os filtros e relações inversas.
Ação necessária: filtros SQL, cursor estável criado_em/id, limites, índices compostos e clientes paginados; não reduzir silenciosamente cartões/métricas do quadro.

### PostgreSQL/PostGIS, transactions e rollback
Status: 🟡 PARCIAL.
Arquivos: server/db.js, server/schema.sql, server/app.js, compose.yaml, tests/api.test.js.
Problemas: HIGH — PostgreSQL/PostGIS real não homologado. Adaptador e geom Point/GiST existem. Fila/transações preservam rollback local; não comprovam concorrência distribuída ou portabilidade completa.
Ação necessária: testes isolados em banco real, migrations sobre dados existentes, consultas/rollback/índices espaciais; registrar indisponibilidade de infraestrutura se constatada, sem afirmar homologação.

### Storage
Status: ⚠ PROBLEMA.
Arquivos: server/app.js, server/invoices.js.
Problemas: HIGH — Multer, downloads, assinatura e limpeza dependem diretamente do disco em uploads/invoices. Arquivo pode ficar órfão entre disco e commit.
Ação necessária: FileStorage local e adaptador de object storage injetável, integração com ambos os fluxos; preservar nomes existentes, autorização, tipos e tamanho.

### Auditoria
Status: 🟡 PARCIAL.
Arquivos: server/app.js, server/schema.sql, tests/api.test.js.
Problemas: MEDIUM — consulta administrativa sem filtros/cursor; histórico imutável pela API já existe.
Ação necessária: entity_type/entity_id/user_id/event/from/to/cursor/limit e testes de autorização/páginas.

### Modularização e code splitting
Status: 🟡 PARCIAL.
Arquivos: src/main.tsx, componentes extraídos, server/app.js e módulos existentes.
Problemas: MEDIUM — entrypoints grandes; LOW — bundle documentado 584,21 kB, a medir novamente. Módulos importados estaticamente.
Ação necessária: extração incremental e React.lazy/Suspense por área; registrar antes/depois; preservar desktop/campo/teclado.

### Testes e checkpoint
Status: 🟡 PARCIAL.
Arquivos: tests/*.test.js e browser.mjs/field-browser.mjs/kanban-browser.mjs.
Problemas: suite cobre fluxo, evidências, permissões, idempotência, WIP e rollback; não cobre funcionalidades ausentes. Resultados históricos não são validação desta execução.
Ação necessária: executar test/build/test:ui/test:field/test:kanban por checkpoint, adicionar regressões relevantes. P0 não concluído até homologação e suite verde.

## P1

### Obras, intervenções e relacionamentos
Status: 🔴 AUSENTE.
Arquivos: server/schema.sql, server/db.js, server/planning.js, src/PlanningPanel.tsx.
Problemas: HIGH — projects/interventions não existem; plano é operacional, não obra. Palavras na UI não comprovam entidades.
Ação necessária: entidades canônicas opcionais, migrations, serviços, API/UI, permissões, auditoria, versões; manter Ocorrência → OS independente e não converter planos automaticamente.

### Vias, geometria, associação e bbox
Status: 🟡 PARCIAL.
Arquivos: server/db.js, server/app.js, shared/planning.mjs, src/heat-layer.ts.
Problemas: HIGH — road_segments ausente; só Point/lat/lng, agrupamento textual; consultas sem viewport. GeoJSON de pontos já existe.
Ação necessária: vias/geometrias amplas, vínculo corrigível, bbox/PostGIS, filtros e camadas individuais, debounce/cache; conservar Leaflet.

### Capacidade, duração e WIP por escopo
Status: 🟡 PARCIAL.
Arquivos: src/DispatchContext.tsx, src/dispatch-model.mjs, server/kanban.js, shared/kanban.mjs.
Problemas: HIGH — carga por contagem não calcula jornada/duração; duração estimada e WIP TEAM/SECTOR ausentes. WIP GLOBAL transacional já existe.
Ação necessária: capacidade estimada por membros/horas/dias/OS, estimated_duration_minutes e origem; resolução TEAM → SECTOR → GLOBAL e testes de precedência/ocupação.

### Mapa e possíveis conflitos territoriais
Status: 🔴 AUSENTE (camadas P1 e análise).
Arquivos: src/main.tsx, server/app.js.
Problemas: MEDIUM — pontos/heatmap existentes não são mapa de obras/intervenções/vias nem análise de período/interseção.
Ação necessária: camadas e análise explícita de possível conflito, sem inferir conflito operacional real.

### Validação P1
Status: 🔴 AUSENTE para novos domínios.
Ação necessária: testes de entidades/vínculos opcionais/geometria/bbox/capacidade/WIP/permissões/conflitos e suite completa após estabilizar P0.

## P2

### Mobilidade, providers, fontes, TTL, interdições e publicação
Status: 🔴 AUSENTE.
Arquivos: nenhum módulo mobility/road_closures vigente; docs mestre seção 12.
Problemas: HIGH — nenhum domínio/camada/API. Não há credencial/documentação Waze fornecida.
Ação necessária: providers backend, metadados REAL_TIME/HISTORICAL/ESTIMATED/SIMULATED, caches TTL, interdições versionadas/vínculos opcionais; publicação autorizada/auditada e Waze desativado sem contrato válido.

### Rotas alternativas, impacto e score
Status: 🔴 AUSENTE.
Ação necessária: routing provider, alternativas, impacto estimado configurável e simulação identificada; nenhuma rota fictícia em produção.

### Cronograma, fases, atividades e progresso ponderado
Status: 🔴 AUSENTE.
Ação necessária: domínio sobre projects, datas/pesos/dependências válidas, progresso calculado e auditado; transações e conflitos.

### Custos, estoque completo e centros de custo
Status: 🟡 PARCIAL.
Arquivos: server/inventory.js, server/invoices.js, consumo e movimentos no esquema, src/InventoryPanel.tsx, src/InvoicePanel.tsx.
Problemas: HIGH — reservas/transferências/inventários/almoxarifados múltiplos/centros de custo ausentes. Custo histórico de consumo e notas/entradas/saídas já existem; totais da nota não têm conciliação completa.
Ação necessária: completar sobre estruturas atuais, não duplicar consumo; transações de reserva/consumo/transferência e testes de saldo/rollback.

### Fiscalização, checklists e não conformidades
Status: 🟡 PARCIAL.
Arquivos: validação/reabertura da OS em server/app.js.
Problemas: HIGH — não há inspections/templates/checklists/non_conformities; validar OS não substitui fiscalização estruturada.
Ação necessária: inspeção com fotos/GPS/parecer, resultados/prazos/resolução e transação com não conformidades.

### Medições e aprovação/rejeição
Status: 🔴 AUSENTE.
Ação necessária: measurements/items, cálculos consistentes, quantidades acumuladas/contratuais, workflow/permissões/versão; aprovação imutável e reabertura justificada/auditada.

### Dashboard físico-financeiro, séries e alertas
Status: 🟡 PARCIAL.
Arquivos: server/app.js, src/OperationsDashboard.tsx.
Problemas: MEDIUM — painel atual é operacional de OS; não existe dashboard de obra, séries de progresso nem ciclo deduplicado de alertas.
Ação necessária: físico/financeiro separados, histórico apenas real; atraso/custo/estoque/medição/NC/interdição/conflitos/impacto e detected/acknowledged/resolved.

### Relatórios, permissões e UX
Status: 🟡 PARCIAL.
Arquivos: server/domain.js, src/main.tsx, src/Operator.tsx e componentes existentes.
Problemas: MEDIUM — seis perfis vigentes, granularidade futura não integrada; CSV frontend não é arquitetura de relatórios P2. Não há novos fluxos.
Ação necessária: mapear permissões por domínio no servidor, relatórios usando serviços existentes; componentes compartilhados, foco/labels/texto/teclado/mobile e alternativa a arraste.

### Validação P2
Status: 🔴 AUSENTE para novos domínios.
Ação necessária: happy path, validação, permissão, conflito, rollback, paginação/concorrência/estado inválido. Avançar apenas após checkpoints P0/P1 verdes.

## Decisões e limites

Preservar state machine existente, relação N:N, SLA desde identificação, foto por ciclo, materiais conforme regra atual, restrições de setor/equipe/operador, audit imutável, notas e idempotência. Não editar migrations 1–4. Não executar scripts auxiliares de troca de perfis. Não houve evidência de BLOCKER/CRITICAL nos percursos já cobertos; isso depende da execução atual. Entregas serão registradas em checkpoints com resultados verificáveis, sem marcar P1/P2 concluídos por documentação.

## Checkpoint 1 ? estados

Concluído em 2026-10-02: regras profundamente imutáveis e matriz completa de regressão. 36 testes, build e três scripts de navegador aprovados. Sem migration/API/UI nova. Demais achados permanecem abertos.

## Checkpoint 2 — concorrência operacional

Migration 5 e CAS em classificação/recusa/transições/programação/projeção; version obrigatório nos payloads de edição. UI transmite version e permite atualizar preservando campos. 38 testes, build e três scripts de navegador aprovados. APIs alteradas, nenhuma nova; componentes Detail/Operator/KanbanMoveDialog atualizados. Planos recebem version, sem nova API de edição. Persistem riscos de concorrência distribuída de estoque, WIP e geração de códigos. Próxima fase: paginação/filtros/índices.

## Checkpoint 3 — listagens

Filtros SQL/cursor/limit em ocorrência, OS e auditoria; bbox no GeoJSON. Migration 6 com índices aditivos. Listas de ocorrência/triagem/OS e AuditPanel paginados; exportação explicita página. 39 testes de regras/API e build aprovados. Consulta integral legado/painel/planejamento/quadro permanece: escalabilidade P0 PARCIAL; não truncar silenciosamente métricas/cartões. Próxima etapa: storage e preparação da homologação PostgreSQL/PostGIS autorizada para execução posterior.

## Checkpoint 4 — storage e homologação preparada

FileStorage local/object injetável integrado a evidências e notas; rollback limpa arquivos nos erros tratados. Dois testes de provider/API/rollback; teste PostgreSQL/PostGIS preparado conforme usuário solicitou execução posterior. 41 aprovados, 1 não executado; build/UI/campo/Kanban aprovados. Sem migration/API nova, contratos de upload preservados. Homologação real permanece pendente; não marcar P0 concluído nem avançar P1/P2 enquanto gate estiver aberto.

## Checkpoint 5 — módulos e revisão final P0

GeoMap/AuditPanel/shared extraídos; áreas carregadas sob demanda. Entry JS reduzido 584,21 → 318,01 kB (45,6%); gzip 169,97 → 95,51 kB. Saldo/custo médio de estoque agregados SQL, movimentos paginados e migration 7. Achado adicional HIGH corrigido: PDF válido falhava na limpeza PDF.js por uso de método inexistente; teste de extração/download incluído. Permanecem consultas amplas de painel/planejamento/quadro e homologação real PostgreSQL/PostGIS; P0 PARCIAL, P1/P2 AUSENTES conforme auditoria inicial. Não anunciar conclusão dessas fases.

## Resultado final do checkpoint

44 testes: 43 aprovados/0 falhas/1 PostgreSQL/PostGIS não executado; build aprovado; UI/campo/Kanban/P0-browser aprovados sem erros de console. Entry JS final: 318,55 kB (95,71 kB gzip). Gate permanece aberto por homologação e consultas amplas; P1/P2 não iniciados. Migrations 5/6/7 aplicadas apenas em bancos temporários dos testes nesta execução; banco municipal/local existente não foi inicializado nem migrado por estes checks. Relatório detalhado em RELATORIO-P0-P1-P2.md.
