# Relatório de checkpoint P0/P1/P2

Data: 2026-10-02. **Entrega parcial: P0 em evolução; P1 e P2 não iniciados.** Este documento não declara conclusão do P2. A auditoria anterior às alterações está em [AUDITORIA-P0-P1-P2.md](AUDITORIA-P0-P1-P2.md).

O usuário optou por preparar testes PostgreSQL/PostGIS para execução posterior. Não houve homologação real, implantação, ativação de storage externo nem integração Waze. O gate do pedido (P0 concluído antes de P1/P2) permanece aberto. A solicitação integral P0+P1+P2 ainda não está satisfeita.

## Matriz real

| Requisito | Status | Implementação | Testes | Observações |
| --- | --- | --- | --- | --- |
| Estados e transições | ✅ IMPLEMENTADO | domain/workflow.js, imutabilidade profunda | workflow + API | Regras existentes preservadas; decisão ocorrência e execução OS distintas |
| Versionamento de ocorrência/OS | ✅ IMPLEMENTADO para edições atuais | migration 5, modules/concurrency; classificação/recusa/transições/programação/projeção | API concorrente, CAS, rollback, upgrade | Version obrigatório; 428 ausente/400 inválido/409 antiga |
| Versionamento de planos | 🟡 PARCIAL | migration 5 | CAS de plano em banco isolado | Sem API de edição; progresso é projeção dos membros |
| UX do conflito | ✅ IMPLEMENTADO nos fluxos alterados | Detail, Operator, KanbanMoveDialog | p0-browser, field, kanban | Atualizar/ver versão atual; campos locais preservados no detalhe |
| Paginação e filtros SQL | 🟡 PARCIAL | modules/listing; listas UI ocorrência/triagem/OS/auditoria/movimentos | API páginas/filtros/bbox; p0-browser | Arrays legados e consultas amplas operacionais continuam |
| Índices | ✅ ADICIONADOS; homologação pendente | migrations 6/7, GiST existente | SQLite upgrade/restart; PostgreSQL preparado | Plano de execução/carga real a verificar no banco de homologação |
| PostgreSQL/PostGIS | 🟡 PARCIAL | Adaptador/geom existentes; teste opt-in preparado | postgres.test.js NÃO EXECUTADO | URBANA_POSTGRES_TEST_URL necessário em banco isolado |
| FileStorage | ✅ IMPLEMENTADO | local/object adapter; upload/download evidência/PDF | storage/API/rollback/download | Serviço S3/MinIO não ativado nem homologado; client SDK a injetar |
| Limite de uploads | ✅ IMPLEMENTADO | modules/files/upload-limit | capacidade/finish/disconnect | Quatro simultâneos por default; 15 MB por arquivo |
| Auditoria pesquisável | ✅ IMPLEMENTADO nas entidades atuais | filtros SQL/cursor + AuditPanel | API permissão, p0-browser | Sem edição/exclusão do histórico |
| Estoque básico | ✅ PRESERVADO e melhorado | saldo/custo médio agregados SQL, histórico paginado | 105 movimentos; notas/consumo | Estoque completo P2 ainda ausente |
| Extração de PDF | ✅ CORRIGIDA | destruição do loading task em finally | PDF válido por object adapter | Bug anterior de método inexistente identificado no teste novo |
| Modularização | 🟡 PARCIAL | server/modules, src/modules/map/administration, src/shared | suite + quatro navegadores | app.js/main.tsx ainda concentram responsabilidades |
| Code splitting | ✅ IMPLEMENTADO por área | React.lazy/Suspense, mapa separado | build + UI/campo/Kanban/P0 | Entry JS 584,21 → 318,55 kB; gzip 169,97 → 95,71 kB |
| Obras e intervenções | 🔴 AUSENTE | Nenhuma entidade nova P1 | Não há testes desses domínios | Não iniciar antes do gate P0; manter relação simples ocorrência → OS |
| Relações opcionais P1 | 🔴 AUSENTE | Plano preservado e separado; nenhuma conversão | Fluxo atual preservado | projects/interventions e vínculos precisam ser implementados |
| Segmentos viários/GeoJSON amplo | 🔴 AUSENTE | Point e bbox atuais apenas | bbox de ocorrências | LineString/Polygon/MultiLineString e associações corrigíveis pendentes |
| Mapa P1/P2 e conflito territorial | 🔴 AUSENTE | Leaflet atual preservado/extraído | Mapa/heatmap atuais | Novas camadas/associação/interseção temporal não entregues |
| Capacidade estimada/duração da OS | 🔴 AUSENTE | Contagem de carga atual preservada | Dispatch existente | Sem jornada/membros ativos/duração; não anunciar capacidade real |
| WIP TEAM/SECTOR/GLOBAL | 🟡 PARCIAL | GLOBAL existente preservado | WIP/rollback atuais | TEAM/SECTOR e precedência pendentes |
| Mobility e providers | 🔴 AUSENTE | Nenhum módulo P2 criado | Não executados | Sem endpoint/token/feed inventado |
| Fontes/TTL/tipos de mobilidade | 🔴 AUSENTE | Diretriz no mestre | Não executados | REAL_TIME/HISTORICAL/ESTIMATED/SIMULATED a implementar |
| Interdições/publicação | 🔴 AUSENTE | Nenhuma entidade/fluxo externo | Não executados | Vínculos, versões, autorização e publicação auditada pendentes |
| Roteamento/alternativas/impacto | 🔴 AUSENTE | Nenhum provider ativo | Não executados | Score configurável e simulação identificada pendentes |
| Cronograma/fases/atividades | 🔴 AUSENTE | Diretriz P2 | Não executados | Datas/dependências/pesos/progresso pendentes |
| Centros de custo/previsto x realizado | 🟡 PARCIAL | Consumo e notas existentes | Estoque/custo atuais | Custo completo por obra/intervenção/OS pendente |
| Almoxarifados/reservas/transferências/inventários | 🔴 AUSENTE | Estoque básico não substitui P2 | Não há testes desses domínios | Transações e concorrência distribuída pendentes |
| Inspeções/checklists/não conformidades | 🔴 AUSENTE | Validação de OS atual preservada | Workflow atual | Fiscalização estruturada pendente |
| Medições/aprovação/reabertura | 🔴 AUSENTE | Nenhuma measurement/item | Não executados | Cálculos, imutabilidade, versão e autorização pendentes |
| Progresso físico-financeiro/séries | 🔴 AUSENTE | Dashboard operacional existente | Dashboard atual | Sem histórico de obra; não fabricar dados |
| Alertas deduplicados | 🔴 AUSENTE | Nenhum ciclo detectado/reconhecido/resolvido | Não executados | Domínios P1/P2 necessários |
| Relatórios P2 | 🔴 AUSENTE | Exportação CSV de página atual | UI atual | Arquitetura de relatórios de domínio pendente |
| Permissões granulares P2 | 🔴 AUSENTE | Seis perfis preservados | API atual | Não executar scripts auxiliares de substituição de perfis |
| UX/mobile/acessibilidade | 🟡 PARCIAL | Padrões existentes e fallback de módulos | Quatro scripts de navegador | Não constitui certificação WCAG ou avaliação com usuários |

## O que existia e o que foi alterado

### Estados

Existia máquina central correta. Arrays internos ainda mutáveis eram a fragilidade. Tornados imutáveis; duas regressões acrescentadas (isolamento e matriz completa). Sem migration/API/componentes novos nesse conjunto; regras de evidência, materiais, recusa, devolução e validação preservadas.

### Concorrência

Existia revision/etapa no Kanban e fila local, sem version. Migration 5 aditiva em ocorrência/OS/plano; CAS de escrita e erros estruturados. APIs de edição existentes passaram a exigir version. Detail/Operator/KanbanMoveDialog atualizados; triagem integrada usa triage.version. Corrida de duas edições, versão ausente/inválida, CAS direto, rollback e upgrade de banco anterior cobertos. Risco residual: numeração/WIP/estoque entre processos não homologados.

### Listagens, auditoria e estoque

Existiam listas integrais, filtros em memória, auditoria limitada a 300 e corte de movimentos após leitura integral. Módulo de filtros SQL/cursor, UI de listas em 50, AuditPanel, bbox backend, vínculos de OS consultados somente para a página; saldos agregados e movimentos paginados. Migrations 6/7 de índices. API nova: GET /almoxarifado/movimentos; listagens/auditoria existentes aceitam envelope opt-in. Testes de paginação/filtros/Unicode/datas/cursor/escopo/bbox e saldo de 105 movimentos. Pendência: migrar consumidores operacionais amplos sem truncar cartões/métricas.

### Storage e banco

Existia disco/Multer acoplado; FileStorage local e object adapter por injeção agora atendem evidências/PDFs. Compensação de arquivos após rollback e limite de uploads simultâneos; contratos e arquivos históricos preservados. Provider, path traversal, autorização de download, falha da auditoria e PDF válido cobertos. PDF.js tinha limpeza incorreta; corrigida conforme biblioteca instalada. PostgreSQL/PostGIS real preparado em teste isolado com duas conexões; não executado por escolha/configuração do ambiente. Queda abrupta ainda pode deixar órfão.

### Módulos e bundle

Existiam componentes extraídos, mas importados estaticamente. Mapa/AuditPanel/shared e módulos backend extraídos; telas lazy com Suspense por área. JS inicial final 318,55 kB (95,71 kB gzip) contra 584,21 kB (169,97 kB gzip): redução de 45,5% no entry. O código total distribuído não foi removido; chunks carregam quando usados. Não há microserviços ou reescrita.

## Validação verificada

| Comando real | Resultado |
| --- | --- |
| npm.cmd test | 44 testes; 43 aprovados, 0 falhas, 1 PostgreSQL/PostGIS não executado |
| npm.cmd run build | TypeScript/Vite aprovados; entry 318,55 kB, sem aviso acima de 500 kB |
| npm.cmd run test:ui | Aprovado desktop/mobile; sem erros de console |
| npm.cmd run test:field | Aprovado rascunho/reenvio/atribuição/execução/validação; sem erros de console |
| npm.cmd run test:kanban | Aprovado drag/teclado/toque/ordenação/WIP/permissão/evidência; sem erros de console |
| node tests/p0-browser.mjs | Aprovado páginas 50/1, conflito preservando formulário, atualização explícita e pesquisa de auditoria |

Banco existente em data/ não foi iniciado/migrado por estes comandos. Testes usam diretórios/bancos temporários. Migrations 1–4 preservadas; nenhuma auditoria apagada, validação removida ou teste desabilitado. Teste PostgreSQL tem condição explícita de configuração, não uma falsa aprovação.

## Riscos, dívidas e próxima fase

1. Homologar PostgreSQL/PostGIS executando o teste preparado em banco isolado, conforme DEPLOYMENT.md.
2. Eliminar consultas amplas de painel/planejamento/quadro e leitores legados sem truncar cartões/métricas; medir planos de execução e carga.
3. Homologar estoque/WIP/numeração em múltiplos processos antes de escalar; versão de edição não resolve esses invariantes globais.
4. Homologar SDK/bucket real e reconciliação de órfãos se object storage for escolhido. Não houve ativação externa.
5. Continuar extrações incrementais e recuperação de erro de carregamento/sessão; avaliar acessibilidade com usuários/tecnologias assistivas.
6. Só depois de fechar P0, iniciar P1 na ordem solicitada: obra/intervenção → vias/GIS → capacidade/duração/WIP → mapa/conflitos. P2 continua dependente desses domínios.

**Próxima fase recomendada: fechar P0.** Não há aceite completo de P0, P1 ou P2 nesta entrega.
