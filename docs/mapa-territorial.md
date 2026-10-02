# Mapa territorial Urbana

Implementada a rota `/mapa`, acessível por **Abrir mapa completo ↗** no mapa atual, com retorno ao sistema, filtros flutuantes recolhíveis (240 ms, respeitando movimento reduzido), contador de filtros ativos e popup operacional responsivo.

## Arquivos desta alteração

- `src/main.tsx`: navegação, reutilização dos filtros e consulta ao GeoJSON existente.
- `src/modules/map/GeoMap.tsx`: popup Leaflet, seleção por teclado, Escape e cache curto de resumos.
- `src/modules/map/TerritorialView.tsx`: viewport dedicada e painel flutuante.
- `src/modules/map/OperationalPopup.tsx`: resumo e fotografias sob demanda.
- `src/modules/map/territorial.css`: layout, animação e responsividade.
- `server/app.js`: novo GET `/api/mapa/ocorrencias/:id/resumo` autenticado.
- `tests/api.test.js`: contrato, permissões, evidências e datas reais da OS.
- `tests/territorial-browser.mjs`: rota, filtros, teclado, cenários de dados ausentes/fotos/equipe, heatmap e responsividade.
- `package.json`: inclui a nova interface em `test:map`.
- `docs/mapa-territorial.md`: este relatório.

As alterações prévias em `shared/kanban.mjs`, `src/TeamKanban.tsx` e `tests/kanban-browser.mjs` foram preservadas.

## Reutilização e dados

Reutilizados `GeoMap`, Leaflet, `heatLayer`, provider/configuração e política de tiles, cores do workflow, campos e estados dos filtros, bootstrap/catálogos, cliente API, GeoJSON e regras existentes de acesso à OS. A rota GeoJSON mantém suporte a bbox. Não houve mudança de state machine, permissões ou vínculo ocorrência → OS.

| Campo | Origem |
|---|---|
| Identificação da OS | `orders.code` da OS ligada via `order_occurrences` |
| Endereço | `occurrences.address` do ponto selecionado |
| Início | `orders.started_at`, registrado ao iniciar execução |
| Atendimento | `orders.finished_at`, registrado ao enviar o serviço executado para validação; na ausência, `orders.scheduled_at` |
| Finalização | `orders.completed_at`, registrado na validação; na ausência, `orders.due_at` como previsão explicitamente identificada |
| Equipe | Catálogo de equipes pelo `orders.team_id`; omitida se ausente |
| Antes | Evidência de imagem da OS com estágio `antes`, do ciclo vigente |
| Depois | Evidência de imagem da OS com estágio `depois`, posterior ao início/reabertura/reprogramação vigentes |

Não se usa data de cadastro como execução. Datas ausentes aparecem como travessão. Sem OS disponível, o card identifica a ocorrência e informa a ausência de OS. Havendo múltiplas OS acessíveis, são exibidas separadamente, sem escolher uma arbitrariamente. As fotos são selecionadas pela evidência mais recente de cada estágio; fotos de registro da ocorrência não são tratadas como evidência de execução da OS.

## API e performance

O endpoint GeoJSON não foi enriquecido com detalhes ou fotos. O novo endpoint de resumo retorna somente o endereço e campos operacionais das OS acessíveis, além de URLs autenticadas dos anexos. Binários são buscados pelo navegador apenas para o popup aberto. Resumos têm cache de 30 segundos, limitado a 20 pontos, incluindo deduplicação de buscas pendentes e descarte de falhas. A página dedicada não carrega dashboard, planejamento ou detalhes de todas as OS.

Filtros consultam o GeoJSON com debounce de 200 ms, sem reload e descartando respostas obsoletas. O mapa não é recriado ao filtrar; tiles e overlays seguem a implementação existente. A atualização periódica mantém os dados territoriais; respostas idênticas não recriam os marcadores. Não há prefetch de tiles.

## Validação executada

- `npm.cmd run build`: aprovado (TypeScript e Vite).
- `npm.cmd test`: 50 aprovados, zero falhas, um ignorado por ausência de `URBANA_POSTGRES_TEST_URL`.
- `npm.cmd run test:map`: aprovado, incluindo teste original de provider/atribuição/camadas/heatmap/tiles indisponíveis e a nova interface territorial.
- `npm.cmd run test:kanban`: aprovado, sem erros de console.
- `npm.cmd run test:ui`: falhou em `tests/browser.mjs:106`, contagem de cartões do Kanban (13 encontrados, 11 esperados). Não atribuído ao mapa; a suíte geral não pode ser declarada aprovada.
- `npm.cmd run test:field`: iniciado e interrompido após ficar aguardando `navigator.serviceWorker.ready`; o fixture compartilhado define `serviceWorkers: "block"`. Não validado.
- `git diff --check`: aprovado.

Inspecionada visualmente a captura mobile do novo popup. Capturas de desenvolvimento ficam em `test-results/territorial-mobile.png` e `test-results/territorial-desktop.png`; tiles e fotos são fixtures de teste, não dados adicionados ao produto.
