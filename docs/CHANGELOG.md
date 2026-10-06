# Changelog — Urbana

Registro das principais evoluções funcionais, técnicas e correções do sistema. O [contexto mestre](URBANA-CONTEXTO-MESTRE.md) explica o funcionamento atual; este arquivo registra o que mudou e a origem dos registros. Contagens de testes abaixo pertencem às respectivas verificações, não são metas ou garantias de homologação.

## 2026-10-03

### Adicionado

- Sincronização do app de campo (aditiva; clientes que não enviam os campos novos mantêm o comportamento anterior): `request_id` idempotente em `assumir`/`iniciar`/`concluir`/`devolver` (resposta `replayed: true`, sem reaplicar após reprogramação) e no registro de material; `captured_at` (hora real do trabalho offline, validada entre 30 dias atrás e 5 min à frente) em transições, material e anexos; `assumed_by`/`assumed_by_name` informativos ao assumir.
- Migration 10: coluna `evidence.captured_at` (SQLite e PostgreSQL, idempotente). Exigências de foto passam a usar `captured_at ?? created_at`.
- Códigos estruturados nos erros existentes: `BEFORE_PHOTO_REQUIRED`, `AFTER_PHOTO_REQUIRED`, `MATERIAL_REQUIRED`, `INVALID_STATUS`, `RECORD_CLOSED`, `INVALID_DUPLICATE_LINK`, `ORDER_NOT_ACCESSIBLE`, `REQUEST_ID_REUSED`, `INVALID_CAPTURED_AT`. Mensagens e status inalterados.

### Corrigido

- Vínculo de duplicidade com `request_id` é idempotente (sem auditoria repetida) e a chave não pode mais criar ocorrência nova; quem vinculou pode anexar a foto de `registro` à ocorrência alvo.
- Documentação de anexos: a resposta é `{ id }`.

## 2026-10-02

### Adicionado

- Conta master `admin@urbana.local` com acesso permanente a todos os módulos, incluindo Campo, identidade protegida e módulos não revogáveis na administração. Outros usuários mantêm as restrições por perfil.

- Onboarding e treinamento por perfil com boas-vindas, responsabilidade no fluxo, destaques reais, ajuda por tarefa, retomada, histórico de conclusão e progresso próprio por versão (migration 9). Filtra módulos e ações; não modifica dados operacionais. [Entrega e testes](ONBOARDING.md).

- Contexto de distribuição com OS abertas, chamados distintos, execução, devoluções, validações, prazos e compromissos por data; seleção explícita de equipe e exclusão da própria OS na redistribuição.
- Mapa de calor de concentração, alternância com pontos, filtros comuns e acesso aos detalhes pela lista.
- Kanban com cartão de ocorrência sem OS e cartão único por OS agrupada; cores acompanhadas de nomes, filtros, ordenação persistida, arraste com formulário, alternativa por teclado/toque e WIP global transacional.
- Decisão de recusa justificada, estado `RECUSADA`, responsável/data/histórico e retirada de filas ativas, planejamento e duplicidade.
- Planos com uma demanda, candidatos disponíveis por via/bairro/setor e emissão atômica de plano + OS.
- Documento mestre, histórico consolidado e 12 ADRs simplificados; pasta `docs/` organizada em cinco referências.

### Melhorado

- Visão geral reorganizada em seis indicadores e gráficos de evolução, estados, carga e prioridades/bairros; ações e listas individuais permaneceram nas áreas operacionais.
- Navegação lateral agrupada/recolhível e tratamento de larguras móveis.
- Triagem com “A analisar” e “Prontas para programar”, análise separada da programação, retorno preservando campos e contexto operacional opcional.
- Planejamento considera urgência, prazo original, idade e volume; exclui demandas reservadas ou já atendidas e separa setores.
- Abas/listas com navegação por teclado, foco visível e controles de movimentação do quadro sem dependência exclusiva de arraste.

### Corrigido

- Triagem e geração individual de OS enviadas juntas passam a reverter classificação se programação falhar.
- Confirmação de gravação separada de erro de atualização nos fluxos tratados; formulários podem atualizar após sucesso sem repetir operação.
- Removidas descrições desatualizadas de planejamento mínimo de duas demandas, ausência total de estoque e centralização de estados ainda futura.
- Corrigidas referências do README e da API; instruções operacionais passaram a citar migrations 1–4 e incluir PDFs de notas no backup.
- Removidas dependências de ArcGIS/busca externa de endereço; registro usa GPS/mapa e preenchimento manual.

### Técnico

- Estados/transições centralizados em `server/domain/workflow.js`, preservando decisão da ocorrência e projeção da execução da OS; testes de transições válidas e inválidas.
- Commit `b45baaa` registra Kanban, planejamento e painel operacional. A verificação daquela entrega registrou **34 testes de regras/API aprovados** e build TypeScript/Vite aprovado; alerta de bundle inicial acima de 500 kB permaneceu.
- Auditoria inicial de 2026-10-02 registrou **31 testes**, build e testes de UI/campo/Kanban aprovados. É uma fotografia anterior à centralização de estados; não prova que os achados continuem todos atuais.
- Registros intermediários de evolução mencionam 19 testes para distribuição e 23 para recusa; testes de navegador cobriram heatmap/filtros/zoom, seleção de equipe, rollback, justificativas, arraste, teclado/toque e layout móvel. As seções de evolução não traziam datas individuais; foram agrupadas nesta data de consolidação, sem atribuir uma data de entrega não comprovada.
- Migração documental: contexto funcional/arquitetural, UX e regras do Kanban foram verificados e incorporados ao mestre; diagnóstico histórico e auditoria foram resumidos aqui; decisões/diretrizes foram registradas em ADRs. Nenhuma funcionalidade P0/P1/P2 foi implementada nesta tarefa.
- Validação da consolidação: `npm.cmd test` com 34 testes aprovados e `npm.cmd run build` aprovado; bundle manteve 584,21 kB e o aviso acima de 500 kB. Testes de navegador não foram reexecutados nesta alteração exclusivamente documental; seus resultados anteriores permanecem identificados como históricos.

### Divergências reconciliadas na consolidação

| Origem | Descrição anterior | Comportamento confirmado no código | Decisão documental |
| --- | --- | --- | --- |
| Mestre / auditoria inicial | Centralização da state machine ainda pendente; ausência de contrato único | `server/domain/workflow.js` já define estados e transições, usado pelas rotas | Marcar como implementado; manter achado como histórico anterior |
| Contextos / README / análise histórica | Não há estoque ou somente saída básica; estoque mínimo/reposição inteiramente futuros | `server/inventory.js` e `server/invoices.js` implementam entradas/saídas, saldo, mínimo, sugestão, extração e confirmação de notas | Descrever estoque como parcial, preservar reservas/transferências/inventário completo no roadmap |
| README / auditoria sobre API antiga | Plano exige 2–100 demandas; API atual já havia sido corrigida para 1–100 | `createPlan` aceita 1–100, mesmo setor, estados iniciais e ausência de plano/OS | Corrigir README, complementar contrato e mestre sem repetir achado como falha atual da API |
| Implantação | Atualização automática menciona somente migrations 2 e 3 | Banco aplica 1–4; versão 4 cria notas, itens e movimentos | Listar quatro versões e compatibilidade; não anunciar versões futuras |
| Análise histórica / Kanban | Quadro não move por arraste; contexto chama a coluna “Pronta para programar” | Há arraste real com formulário; `shared/kanban.mjs` ainda usa título “Em triagem” | Histórico relata evolução; mestre descreve ação atual e diferença de rótulo |
| Kanban | Entregas descritas genericamente como OS validadas em 30 dias | `flowMetrics` exige estado atual CONCLUIDA e data no período | Explicitar que reabertas saem da contagem; não afirmar histórico imutável de validações |
| Análise histórica do mapa | Busca externa de endereço permanece em mapa/panorama | `AddressSearch` e GIS removidos; entrada manual/GPS/mapa vigente | Preservar remoção no histórico e documentar localização atual |
| Mestre | PostGIS listado entre integrações futuras | Adaptador já cria ponto `geom`/GiST, mas não foi homologado em instância real | Marcar suporte como parcial; geometrias ampliadas e vias permanecem P1 |
| Artefatos de permissões / scripts | Código auxiliar sugere overrides e três novos perfis | App usa seis perfis; helpers/formulário/scripts não estão integrados e `openDatabase` termina na migration 4 | Registrar como não integrado, sem executar scripts ou afirmar novas permissões ativas |
| Auditoria / mestre | Versões 5/6/7 propostas e locking/paginação como evolução | Não há `version` geral nem paginação; Kanban tem `revision`/etapa esperada | Manter diretrizes planejadas e numeração como hipótese a confirmar |
| Contextos / análise de setor | Visão de setor descrita como capacidade e referências genéricas a “obra” | Controle mensal consolida OS/serviços/contatos; planos são operacionais | Distinguir contagem de capacidade e plano de entidades futuras de obra/intervenção |

### Conteúdo recuperado antes da remoção

| Fonte consolidada | Informação preservada | Destino |
| --- | --- | --- |
| Contexto funcional | Jornadas, pessoas, módulos, origem demonstrativa, SLA, duplicidade, acessibilidade, limites e integrações | Contexto mestre, seções 1–11 |
| Arquitetura | Entidades/N:N/JSON, projeção de estados, permissões, segurança, fila/transações, arquivos órfãos, campo e push | Contexto mestre, seções 2–3 e 8–10; ADRs |
| UX | Guardar triagem/programar depois, recusa/devolução, contexto opcional, rollback, feedback e teclado | Contexto mestre, seções 2 e 4–5; correções históricas neste arquivo |
| Kanban | Cartões, arraste/formulários, ordenação, WIP global, conflitos, métricas, filtros, navegação e revisão diária | Contexto mestre, seções 4 e 6; API |
| Análise/evolução | Painel, feedback, distribuição, heatmap, Kanban, decisão/recusa e verificações | Este histórico; regras atuais incorporadas ao mestre |
| Auditoria P0/P1 | Achados, preservação de invariantes, prioridades, migrations e critérios de evolução | Este histórico; limitações/roadmap no mestre; ADRs 9 e 12 |
| Mestre anterior | Especificações de obras/intervenções, GIS, mobilidade, cronograma, custos, medições, inspeção e P0–P3 | Contexto mestre, seções 1 e 11–13; ADRs |

### Auditoria histórica preservada

Achados **HIGH** da auditoria: ausência de locking geral, listagens integrais, estado ainda disperso naquele momento e storage direto por Multer. **MEDIUM:** auditoria limitada a 300 sem filtros, PostgreSQL/PostGIS sem homologação, migrations embutidas/documentação incompleta, concentração em arquivos grandes e consultas amplas de mapa/proximidade/painel. **LOW:** documentação divergente e bundle acima de 500 kB. Não foi identificado BLOCKER ou CRITICAL nos percursos cobertos. As medições históricas de `src/main.tsx` (3.457 linhas) e `server/app.js` (1.310) não são medidas permanentes da base atual.

Sequência proposta: centralizar estados → versionamento/conflitos → paginação/filtros/auditoria → storage/homologação → extração de módulos/code splitting → P1 opcional → mapa/WIP por escopo. A primeira etapa foi posteriormente implementada. As migrations sugeridas 5 (versões/índices), 6 (P1) e 7 (WIP por escopo) não foram aplicadas nem reservadas; confirmar numeração antes da execução. Preservar compatibilidade, auditoria, duplicidade/idempotência, evidências, relações setor/equipe/operador e rollback em cada evolução.

## 2026-10-01

### Adicionado

- Filas operacionais com contagens e acesso a triagem, devoluções, validação e vencidos na versão do painel avaliada à época; guia de andamento e requisitos por categoria.

### Melhorado

- Mensagens específicas distinguindo envio, validação e encerramento; feedback persistente no detalhe e avisos acessíveis nos componentes tratados.

### Corrigido

- Falha de atualização após gravação confundida com falha de envio; orientação para verificar resultado quando a rede não permite confirmá-lo.
- Atualização automática silenciosa: aviso de falha, última atualização e recuperação manual.
- Almoxarifado preso em carregamento após erro inicial e divergência entre contador/fila de triagem.

### Técnico

- Análise realizada por leitura de código e testes, sem observação de usuários municipais reais.
- Registro da análise: 17 testes de regras/API aprovados, build aprovado, UI em 1440 × 1000 / 390 × 844 e campo aprovados, sem erros JavaScript capturados nos dois testes de navegador; captura de painel revisada.
- Pontos de evolução registrados: feedback uniforme em todos os formulários, concorrência, recuperação de sessão preservando dados, paginação/code splitting, validação com usuários e homologação/restauração em produção.

## 2026-09-29

### Técnico

- Primeiro commit do repositório (`f2a0f15`), identificado no histórico Git como versão inicial de gestão de manutenção urbana. Não há cronologia individual comprovada para todos os módulos introduzidos antes das avaliações posteriores.

## Checkpoint P0 — state machine (2026-10-02)

### Corrigido

- Arrays de transições agora são imutáveis; consumidores não podem alterar regras globais. Fluxos de ocorrência/OS e projeção preservados.

### Técnico

- Auditoria inicial em AUDITORIA-P0-P1-P2.md, com classificação e severidade dos requisitos.
- Dois testes de regressão: isolamento/imutabilidade e matriz completa de transições.
- Validação atual: 36 testes aprovados, build aprovado, test:ui/test:field/test:kanban aprovados, sem erros de console. Bundle antes das extrações: 584,21 kB JS (169,97 kB gzip).
- Nenhuma migration, API ou componente alterado nesta fase. P0 ainda não concluído; concorrência, paginação, storage e homologação continuam pendentes.

## Checkpoint P0 — concorrência (2026-10-02)

### Adicionado

- Migration 5 aditiva: version em ocorrências, OS e planos; módulo de concorrência com comparação na escrita.
- 409 VERSION_CONFLICT estruturado; 428 VERSION_REQUIRED e 400 INVALID_VERSION.
- Atualização explícita após conflito no detalhe/campo, preservando relato e campos locais.

### Alterado

- Contrato de classificação/recusa/transições/programação: version obrigatório; triagem integrada envia triage.version. UI e fixtures atualizados. Inserts de OS usam colunas explícitas.

### Técnico

- 38 testes aprovados, build aprovado e UI/campo/Kanban aprovados sem erros de console. Corrida de duas edições, CAS no banco, migration/reinício e rollback cobertos. Nenhuma migration antiga editada.
- Plano não possui edição e progresso ? projeção; estoque/WIP/numeração não homologados entre processos. P0 continua aberto.

## Checkpoint P0 — listagens SQL (2026-10-02)

### Adicionado

- Migration 6: índices de filtros, paginação, auditoria e vínculos inversos.
- Módulo listing: filtros SQL, cursor created_at/id, validação de datas/limites/cursor e bbox. Listas UI de ocorrências/triagem/OS usam 50 por página e exportação da página; pesquisa paginada da auditoria extraída em AuditPanel.

### Técnico

- Testes de cursor sem duplicação, filtros Unicode, wildcard literal, bbox e autorização. Contrato legado preservado; painel/planejamento/kanban ainda usam conjuntos amplos e exigem evolução antes de concluir escalabilidade P0.

## Checkpoint P0 — storage e homologação preparada (2026-10-02)

### Adicionado

- FileStorage com save/get/delete/exists, provider local e adaptador de object storage injetável; evidências e notas usam a mesma abstração. Caminhos uploads/invoices existentes preservados.
- Limpeza compensatória dos arquivos após rollback (incluindo falha de auditoria/commit), mantidas autorização, assinatura, tipos e limite de 15 MB.
- Teste opt-in PostgreSQL/PostGIS isolado: migrations, geometria/GiST, filtros/paginação, CAS em duas conexões, rollback e reinício. Não conecta implicitamente a DATABASE_URL.

### Técnico

- 41 testes aprovados e 1 teste PostgreSQL/PostGIS não executado por ausência de URBANA_POSTGRES_TEST_URL, conforme escolha do usuário para execução posterior. Build e UI/campo/Kanban aprovados. Storage externo não foi ativado/homologado.
- Sem nova migration nesta fase. Limite: queda do processo entre storage e commit ainda pode deixar órfão; limpeza compensatória cobre falhas tratadas, não transação distribuída.

## Checkpoint P0 — módulos e estoque (2026-10-02)

### Alterado

- Mapa extraído, rótulos/cores compartilhados, lazy loading por área com fallback acessível. Entry JS 584,21 → 318,01 kB; gzip 169,97 → 95,51 kB.
- Saldo e custo médio calculados no SQL sobre todo histórico. GET de movimentos e histórico UI paginados em 50; legacy limita 100 no SQL.

### Adicionado

- Migration 7 com índices de paginação/OS/nota em movimentos.
- Testes de saldo e paginação com 105 movimentos; upgrade de instalação anterior ao versionamento; provider externo injetado cobrindo PDF/evidência/rollback; navegador P0 para páginas e formulário em conflito.

### Corrigido

- PDF válido era recusado porque extração chamava destroy no PDFDocumentProxy, sem esse método na versão instalada; agora loading task é destruído em finally.
- Lista não exibe registros da tela anterior enquanto consulta nova carrega. Testes de navegador aguardam filtros/chunks e registram espera de resposta antes da ação.

### Validação final desta revisão

- 44 testes: 43 aprovados, 0 falhas, 1 PostgreSQL/PostGIS não executado por configuração ausente, conforme execução posterior solicitada.
- Build TypeScript/Vite aprovado: entry JS final 318,55 kB (95,71 kB gzip), contra 584,21 kB (169,97 kB gzip) antes da revisão, redução de 45,5% no JS de entrada.
- test:ui, test:field, test:kanban e node tests/p0-browser.mjs aprovados sem erros de console. P0 browser verifica navegação 50/1, edição concorrente, preservação/atualização explícita do formulário e pesquisa por entidade na auditoria.
- Limite de uploads concorrentes antes do Multer, com 429 UPLOAD_BUSY, evita acúmulo ilimitado de buffers antes da fila de banco.
- Nenhuma fase P1/P2 anunciada como entregue. RELATORIO-P0-P1-P2.md registra checkpoint parcial e pendências.
