# Tarefas de melhoria do Urbana

Criado em 2026-11-11 a partir da análise do projeto. Branch de trabalho: `chore/melhorias-tecnicas`.

Os agentes compartilham o mesmo diretório de trabalho, então as tarefas rodam em **ondas**: no máximo um agente mexendo no backend (`server/`) e um no frontend (`src/`) ao mesmo tempo. Nenhum agente faz commit; a revisão e o commit ficam com o responsável pelo repositório.

Legenda de status: ⏳ pendente · 🔄 em andamento · ✅ concluída · ⚠️ concluída com ressalvas · ⏸️ aguardando decisão

## Tarefas delegadas a agentes

| # | Tarefa | Escopo de arquivos | Modelo | Onda | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | CI (GitHub Actions) + ESLint + scripts `lint`/`format` | `.github/`, `eslint.config.js`, `package.json` | Sonnet | 1 | ⚠️ |
| T2 | Pool real no PostgreSQL (transação por cliente) e migrations em arquivos numerados | `server/db.js`, `server/migrations/`, ponto de transação em `server/app.js` | Opus | 1 | ✅ |
| T3 | Dividir `src/main.tsx` (3.392 linhas) em telas, hooks e camada de API | `src/` (exceto `Operator.tsx` e `*.mjs`) | Opus | 1 | ✅ |
| T4 | Segurança: CSP/HSTS/frame-ancestors, Origin obrigatório em mutações, rate limit de login persistente, recusa de senha padrão em produção | `server/app.js`, `server/index.js`, `Caddyfile` | Opus | 2 | ⚠️ |
| T5 | Offline real no Campo: cache de OS no aparelho, fila de ações e sincronização ao reconectar | `src/Operator.tsx`, `src/field-storage.ts`, `public/sw.js` | Opus | 2 | ⚠️ |
| T6 | Operação: `/healthz` com checagem do banco, logs estruturados com request-id, limpeza de uploads órfãos, script de backup, push seguro para múltiplas instâncias | `server/`, `scripts/`, `compose*.yaml` | Sonnet | 3 | ✅ |
| T7 | Consultas amplas: agregação/paginação em SQL para painel, planejamento e Kanban | `server/planning.js`, `server/kanban.js`, `server/app.js` | Opus | 4 | ✅ |
| T8 | Dividir `server/app.js` (1.463 linhas) em rotas por domínio | `server/` | Opus | 5 | ✅ |
| T10 | Corrigir testes de navegador que já falhavam antes das mudanças (`test:ui`, `test:kanban`, `sector-browser`) e permitir outro navegador além do Edge | `tests/` | Sonnet | 3 (frontend) | ✅ |
| T11 | `request_id` e `captured_at` no lançamento de equipamento (lacuna achada pela T5) | `server/app.js`, `src/modules/field/`, `tests/` | Sonnet | 4 (após T7) | ✅ |
| T9 | Atualizar README e docs (migrations, contagem de testes, homologação PostgreSQL, mudanças das tarefas acima) | `README.md`, `docs/` | Sonnet | 6 | ✅ |

### Critérios comuns

- `npm test` e `npm run build` continuam verdes ao final de cada tarefa.
- Nenhuma regra de negócio muda; contratos da API permanecem compatíveis.
- Migrations existentes (1–10) não são editadas em conteúdo; novas são aditivas.
- Cada agente relata o que fez, o que verificou e o que não conseguiu verificar.

## Tarefas não delegadas (precisam de decisão de produto ou de pessoas)

| # | Tarefa | Por que não foi delegada | Status |
| --- | --- | --- | --- |
| P1 | Portal do cidadão e notificação ao solicitante | Define canal (e-mail, SMS, WhatsApp), LGPD e identidade visual | ⏸️ |
| P2 | Entidades de obra e intervenção (P1 do contexto mestre) | Modelo de domínio novo; exige validação com a gestão municipal | ⏸️ |
| P3 | Acessibilidade com leitor de tela e teste com usuários reais | Depende de pessoas e aparelhos físicos | ⏸️ |
| P4 | Antimalware nos uploads | Depende da infraestrutura escolhida (ClamAV, serviço externo) | ⏸️ |

## Registro de execução

_Atualizado conforme os agentes concluem._

### T1 — CI + ESLint (⚠️ concluída com ressalvas)

- Criados `eslint.config.js`, `.prettierignore` e `.github/workflows/ci.yml`; scripts `lint`, `format` e `format:check` no `package.json`.
- `npm run lint` termina sem erros, com cerca de 500 avisos; 417 são `no-explicit-any`. As regras com violações existentes foram rebaixadas para aviso, não desligadas.
- O CI roda lint, testes (com PostgreSQL/PostGIS como serviço) e build. O fluxo do PostgreSQL foi reproduzido localmente com container e passou.
- Ressalvas: o workflow ainda não rodou no GitHub; `format:check` ficou fora do CI porque 69 arquivos não estão formatados (precisa de um commit dedicado de `prettier --write`); os testes de navegador ficaram fora do CI por dependerem do Edge e não terem sido validados em runner Linux.

### T2 — Pool PostgreSQL + migrations em arquivos (✅ concluída)

- Migrations 1–10 movidas sem alteração de SQL para `server/migrations/001…010-*.js`; `server/db.js` ganhou um runner que exige numeração contínua. As migrations 1 (`schema.sql` + PostGIS) e 9 (marcador) são repetíveis, como já eram na prática.
- No PostgreSQL, leituras usam o pool e cada transação usa um cliente dedicado via `db.transaction(fn)` com `AsyncLocalStorage`; `pool.on('error')` impede a queda do processo. `BEGIN`/`COMMIT` avulsos por `db.exec` passam a ser recusados nesse dialeto.
- A fila serial de mutações foi mantida de propósito: WIP, numeração de códigos e saldo de estoque dependem dela enquanto não houver lock distribuído. GETs sem escrita saem da fila no PostgreSQL.
- Verificado: suíte SQLite verde; 73 de 73 com PostgreSQL/PostGIS real em container; migração sobre cópias de banco SQLite existente e de um banco "legado" produziu esquema e dados idênticos aos do código antigo.
- Pontos de atenção: GETs no PostgreSQL agora leem em READ COMMITTED fora da fila (um GET com várias consultas pode ver um commit entre elas); as suítes de API só rodam em SQLite, no PostgreSQL houve apenas um smoke HTTP; pool com o padrão de 10 conexões, sem configuração.

### T4 — Segurança (⚠️ concluída com ressalvas)

- Cabeçalhos em `server/security.js`: CSP estrita em produção (sem `unsafe-inline`), `X-Frame-Options: DENY`, `Permissions-Policy`, COOP e HSTS quando `SECURE_COOKIE=true`. Em desenvolvimento a CSP é afrouxada para o Vite. `public/offline.html` teve o estilo inline movido para `public/offline.css`.
- Mutações agora exigem `Origin` igual ao `Host` ou `Sec-Fetch-Site: same-origin`; erros `ORIGIN_REQUIRED` e `ORIGIN_FORBIDDEN`. Clientes de API fora do navegador precisam enviar `Origin`.
- Rate limit de login persistido na tabela `login_attempts` (migration 11), mesma política de 10 falhas por IP em 15 minutos. Nova variável `TRUST_PROXY` (definida como `1` no `compose.yaml`) para o IP real atrás do Caddy.
- Em `--production` com `HOST` fora de loopback ou `SECURE_COOKIE=true`, o servidor recusa subir com `DEMO_DATA` ligado ou com contas na senha `Urbana@2026`.
- `Caddyfile`: limite de corpo de 20 MB e remoção do cabeçalho `Server`.
- Verificado: 81 testes (79 passam, 2 pulados sem PostgreSQL; 81 de 81 com PostgreSQL real); build; curl em modo produção; seis testes de navegador em Chrome sem violação de CSP.
- Ressalvas: `compose.local.yaml` ganhou a chave `URBANA_ALLOW_INSECURE_DEMO: "true"` para continuar subindo com dados de demonstração — decisão pendente do responsável; `VITE_MAP_TILE_URL` passa a ser necessária também em tempo de execução; não testado em Edge, nem com Docker/Caddy reais; três testes de navegador (`browser.mjs`, `kanban-browser.mjs`, `sector-browser.mjs`) falham também sem as mudanças da T4 — a conferir junto com a T3.

### T3 — Divisão de `src/main.tsx` (✅ concluída)

- `src/main.tsx` caiu de 3.392 para 326 linhas. As telas foram para `src/modules/<área>/`, os utilitários para `src/shared/` e o estado do shell para hooks em `src/modules/workspace/`. O código foi movido sem reescrita; textos, classes e atributos de acessibilidade ficaram iguais.
- O chunk de entrada caiu de 331 para 281 kB (gzip de 99,6 para 88,4 kB); detalhe, formulários e telas administrativas passaram a ser carregados sob demanda. O CSS de entrada ficou idêntico.
- Verificado em Chrome (o Edge não está instalado nesta máquina): `test:map`, `test:authorization`, `test:onboarding` e `test:field` passam.
- `test:ui`, `test:kanban` e `sector-browser` falham do mesmo jeito com o código original do último commit, portanto já estavam quebrados antes: contagem de cartões desatualizada, recarga de página sem fallback de SPA no servidor de teste e grupo de menu não expandido. Viraram a tarefa T10.
- Pontos de atenção: `Detail.tsx` ainda tem 900 linhas; um teste do Kanban falhou uma vez em oito execuções, com cara de corrida com a atualização automática de 15 s.

### T6 — Operação (✅ concluída)

- `/healthz` consulta o banco com timeout de 2 s e responde 503 `{"ok":false}` em falha.
- `server/logger.js`: JSON por linha em produção, texto em desenvolvimento, nível por `LOG_LEVEL`; middleware com `X-Request-Id`, método, rota, status, duração e usuário, sem corpo, cookies ou tokens. Todos os `console.*` do servidor foram trocados.
- Uploads órfãos: `npm run uploads:cleanup` (com `--dry-run`), só para storage local, carência de 24 h e recusa de rodar com banco sem referências. O agendamento no processo existe, mas vem desligado (`UPLOAD_SWEEP_INTERVAL_HOURS`).
- Backup: `npm run backup` gera pasta com carimbo de data, banco (`VACUUM INTO` no SQLite, `pg_dump` no PostgreSQL), arquivos e `manifest.json` com SHA-256; retenção por `BACKUP_KEEP` (padrão 14). O `Dockerfile` passou a copiar os dois scripts.
- Push: reivindicação atômica de cada job com lease de 5 minutos, sem migration nova; entrega pelo menos uma vez.
- Verificado: 105 testes (103 passam, 2 pulados sem PostgreSQL; 105 de 105 com PostgreSQL real), lint sem erros, build.
- Não verificado: `pg_dump` do host (cliente 15 contra servidor 17; validado só por dentro do container) e restauração completa do dump; imagem Docker não construída; duas instâncias reais (simulado com duas pools no mesmo processo). A imagem do app não traz cliente PostgreSQL, então o backup desse banco roda no host ou em outro container.

### T5 — Offline real no Campo (⚠️ concluída com ressalvas)

- IndexedDB `urbana-field` versão 2, com migração aditiva: stores `session`, `cache` (tarefas e detalhe das OS por usuário) e `outbox` (fila de ações com `request_id` e `captured_at`), além dos `drafts` existentes.
- Todas as ações do ciclo podem ser feitas sem rede, com validação local das regras do servidor, estado otimista e painel "Pendências de envio". A sincronização dispara ao reconectar, ao voltar ao app, a cada 15 s, pelo botão "Enviar agora" e por Background Sync quando existe.
- Falha de rede ou 5xx: nova tentativa com espera crescente. 401: a fila pausa e pede login. Outros 4xx: a ação fica rejeitada com motivo, e o operador escolhe reenviar ou descartar; só as ações seguintes da mesma OS esperam.
- Service worker `v3`: HTML pela rede primeiro, assets com hash em cache, nenhuma resposta de `/api` no Cache Storage.
- Verificado: build, lint sem erros, `tests/field-outbox.test.js` (14), `tests/field-offline-browser.mjs` (ciclo completo offline em Chrome), `test:field` e `test:onboarding`.
- Ressalvas: (1) como `main.tsx` chama `/api/bootstrap` antes de carregar o Campo, o service worker responde esse único GET quando não há rede, o pedido vem de `/campo` e existe sessão de Campo salva — decisão pendente entre manter isso ou fazer o boot offline no `main.tsx`; (2) o endpoint de equipamento não aceita `request_id` nem `captured_at` (virou T11); (3) foi criada a seção "Equipamentos utilizados" na tela de execução, que não existia; (4) só o perfil Equipe de Campo abre offline; (5) nada testado em aparelho real, iOS não tem Background Sync e pode apagar dados após 7 dias sem uso se o app não estiver instalado; (6) fotos de até 15 MB ficam no IndexedDB sem compressão.

### T7 — Consultas amplas (✅ concluída)

- Respostas JSON idênticas byte a byte em todos os endpoints alterados; nenhum contrato mudou e nenhum índice novo foi necessário (a última migration continua sendo a 11).
- Medido num banco SQLite de 40 mil ocorrências e 29 mil OS: `/api/controle-setor` caiu de 29.051 consultas para 5 (701 → 187 ms); `/api/ocorrencias/proximas` de 198 para 1 ms; checagem de duplicidade de 210 para 21 ms; `/api/dashboard` de 2.050 para 616 ms. `/api/planejamento` e `/api/campo` tinham crescimento cúbico (166 s e 345 s com 5 mil ocorrências) e passaram a 1,0 s e 0,4–0,6 s com 40 mil.
- As contagens de WIP do Kanban viraram um `GROUP BY` no banco.
- Novo `tests/query-equivalence.test.js` compara as implementações antigas com o HTTP real, em SQLite e PostgreSQL.
- Verificado: 121 testes (118 passam, 3 pulados sem PostgreSQL; 121 de 121 com PostgreSQL real), lint sem erros.
- Não verificado: benchmark de volume em PostgreSQL; build e testes de navegador.
- Propostas que mudam contrato, não feitas: painel devolver só agregados em vez de todas as OS e ocorrências (33 MB por carga com 40 mil registros); paginar planos encerrados; limitar `/api/campo` de gestão às OS abertas; endpoint próprio de cartões para o Kanban.

### T11 — Idempotência do lançamento de equipamento (✅ concluída)

- `POST /api/ordens-servico/:id/equipamento` aceita `request_id` e `captured_at` opcionais, no mesmo padrão do material: reenvio devolve `{ok:true, replayed:true}` sem nova auditoria; chave reutilizada em outra OS dá 409 `REQUEST_ID_REUSED`. Sem migration nova.
- A fila offline do Campo passou a enviar os dois campos nessa ação. `docs/API.md` atualizado nesse endpoint.
- Verificado: 122 testes (119 passam, 3 pulados sem PostgreSQL; 122 de 122 com PostgreSQL real), lint sem erros, build e `tests/field-offline-browser.mjs` em Chrome.

### T10 — Testes de navegador (✅ concluída)

- Novo `tests/support/browser.mjs`: a variável `URBANA_BROWSER_CHANNEL` escolhe o navegador (`msedge` por padrão, `chrome` ou `chromium`). Scripts novos no `package.json`: `test:sector`, `test:p0`, `test:field-offline` e `test:browser`, que roda todas as suítes em sequência.
- As três falhas antigas eram testes defasados, não bugs do app: o Kanban passou a mostrar a coluna Concluídas sempre (commit d182d60); o módulo aberto passou a vir da URL (commit 809dcde) e o servidor de teste não tinha o fallback de SPA da produção; "Controle do setor" fica no grupo recolhido "Operações". Os testes foram atualizados para afirmar o comportamento atual, com contagens calculadas pela API.
- A intermitência do Kanban era uma leitura imediata do DOM; virou espera por condição.
- Verificado em Chrome: todas as nove suítes verdes, `test:kanban` 10 de 10 seguidas, `test:ui` 5 de 5.

### T8 — Divisão de `server/app.js` (✅ concluída)

- `server/app.js` caiu de 1.499 para 79 linhas e ficou só com a composição. Infraestrutura compartilhada em `server/http/` (`route.js`, `auth.js`, `errors.js`, `records.js`, `schemas.js`); rotas por domínio em `server/routes/` (`health`, `auth`, `bootstrap`, `occurrences`, `orders`, `attachments`, `catalogs`, `admin`, `dashboard`). Os módulos antigos (`planning`, `kanban`, `field` etc.) não mudaram de lugar.
- A tabela de rotas (77 rotas) e as respostas por perfil ficaram idênticas antes e depois; `tests/route-table.test.js` fixa ordem, handlers e a marca de escrita de cada rota.
- Verificado: 123 testes (120 passam, 3 pulados sem PostgreSQL; 122 de 122 com PostgreSQL real antes do teste novo), lint sem erros, build, nove suítes de navegador em Chrome e servidor em modo produção.
- Problemas encontrados e não corrigidos: no upload de evidência, a validação de coordenadas roda antes da checagem de localização ausente, então a mensagem "Informe a localização da evidência." nunca aparece (`server/routes/attachments.js`, linhas 141–145); caminhos desconhecidos em `/api` respondem 403 "Módulo não autorizado." em vez de 404 para usuário autenticado.

### Mudança de plano na T9

A T9 estava prevista para Haiku. Como a documentação passou a cobrir segurança, implantação, backup e offline, onde um erro tem custo, ela roda em Sonnet.

### T9 — README e documentação (✅ concluída)

- Atualizados `README.md` e, em `docs/`, `DEPLOYMENT.md`, `API.md`, `URBANA-CONTEXTO-MESTRE.md`, `CHANGELOG.md` (entrada de 2026-11-12), `DECISIONS.md` (ADR-016 a ADR-023), `MAP-TILES.md`, `ONBOARDING.md` e `AUTORIZACAO.md`.
- Divergências que o agente encontrou ao conferir o registro contra o código: o Prettier acusa 135 arquivos fora do padrão (a T1 mediu 69, antes dos arquivos novos); o lint tem 504 avisos, 424 de `no-explicit-any`; não existe trava por perfil no offline do Campo, apenas o cenário testado é o da Equipe de Campo.
- Não tocado: `docs/mapa-territorial.md` ainda cita `server/app.js` e `src/main.tsx` como os arquivos da entrega original; o contexto mestre (§3) diz que gestores e administradores não entram em `/campo`, mas a conta master entra — texto anterior, mantido.

### Verificação final (2026-11-12)

- `npm test`: 123 testes, 120 passam, 3 pulados sem PostgreSQL. Com PostgreSQL/PostGIS em container local: 123 de 123.
- `npm run build`: ok. `npm run lint`: 0 erros, 504 avisos.
- Suítes de navegador: última execução completa (nove suítes, Chrome) ao final da T8; depois dela só a documentação mudou.
- Nada foi commitado. São 50 arquivos rastreados alterados e os arquivos novos, todos na branch `chore/melhorias-tecnicas`.

### Decisões pendentes do responsável

1. Manter o desvio do service worker para `GET /api/bootstrap` offline ou fazer o boot offline em `src/main.tsx` (ADR-020).
2. Manter `URBANA_ALLOW_INSECURE_DEMO` no `compose.local.yaml`.
3. As quatro propostas da T7 que mudam contrato da API (painel só com agregados é a de maior ganho).
4. Corrigir os dois problemas antigos achados na T8 (mensagem de localização no upload; 403 em vez de 404 em `/api`).
5. Commit dedicado de `prettier --write` para depois ligar `format:check` no CI.
6. As tarefas P1–P4 da tabela "não delegadas".

---

## Segunda rodada (2026-11-12)

Pedido: executar com agentes os seis itens da lista "Decisões pendentes do responsável" e depois verificar o app móvel `../urbana-campo` (Expo/React Native, consome esta API).

Achado ao preparar a rodada: o app móvel usa axios nativo e **não envia o cabeçalho `Origin`**. Com a regra da T4, todas as mutações dele, inclusive o login, seriam recusadas com 403 `ORIGIN_REQUIRED`. A correção entrou na R2.

Escolhas feitas onde havia decisão em aberto (podem ser revistas):
- Item 2: a chave `URBANA_ALLOW_INSECURE_DEMO` fica no `compose.local.yaml`, porque o app móvel é testado contra o backend local pelo IP da rede, o que exige `HOST` fora de loopback.
- Portal do cidadão: registro público e acompanhamento por protocolo, sem canal externo de notificação (e-mail, SMS ou WhatsApp ficam para depois).
- Antimalware: integração opcional com ClamAV (`clamd`), desligada por padrão.
- Acessibilidade: auditoria automatizada e correções; teste com pessoas e leitores de tela reais continua pendente.

| # | Tarefa | Item | Modelo | Onda | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Boot offline do Campo em `src/main.tsx` e remoção do desvio do service worker | 1 | Opus | 1 (frontend) | ✅ |
| R2 | Dois problemas antigos (mensagem de localização no upload; 404 em `/api`) + cliente nativo sem `Origin` + nota no `compose.local.yaml` | 2, 4 | Opus | 1 (backend) | ✅ |
| R3 | Antimalware opcional nos uploads (ClamAV) | 6 (P4) | Sonnet | 2 (backend) | ✅ |
| R4 | Mudanças de contrato da T7: painel só com agregados, planos encerrados paginados, `/api/campo` de gestão limitado, endpoint de cartões do Kanban | 3 | Opus | 3 | ✅ |
| R5 | Entidades de obra e intervenção (P1 do contexto mestre) | 6 (P2) | Opus | 4 | ✅ |
| R6 | Portal do cidadão: registro público e acompanhamento por protocolo | 6 (P1) | Opus | 5 | ✅ |
| R7 | Acessibilidade: auditoria automatizada e correções | 6 (P3) | Sonnet | 6 | ✅ |
| R8 | `prettier --write` no repositório e `format:check` no CI | 5 | Haiku | 7 | ✅ |
| R9 | Atualizar README e documentação com a segunda rodada | — | Sonnet | 8 | ✅ |
| R10a | Ajustar o app `../urbana-campo` ao servidor novo: cabeçalho `X-Urbana-Client`, novos códigos de erro, equipamento idempotente (branch `chore/compat-servidor-novo` naquele repositório) | — | Sonnet | paralelo | ✅ |
| R10b | Verificar o app `../urbana-campo` contra o servidor final rodando no Docker local | — | Opus | 9 | ⚠️ |

### Registro da segunda rodada

#### R2 — Problemas antigos e cliente nativo (✅ concluída)

- Upload de evidência: a checagem de localização ausente roda antes da validação, então "Informe a localização da evidência." aparece. De quebra, `lat=""` deixava de ser aceito como coordenada 0.
- `/api`: caminho que não corresponde a nenhuma rota registrada responde 404 para usuário autenticado; rota real de módulo não liberado continua 403 e anônimo continua 401. A lista de rotas é derivada do próprio roteador.
- Cliente nativo: mutação sem `Origin` e sem `Sec-Fetch-Site` é aceita somente com o cabeçalho `X-Urbana-Client`. Com `Origin` ou `Sec-Fetch-Site` presentes, o cabeçalho é ignorado e valem as regras de antes.
- O app móvel precisa enviar `X-Urbana-Client` (um ponto: o `axios.create` em `urbana-campo/src/api.ts`). Instalações antigas recebem 403 `ORIGIN_REQUIRED` em toda mutação, inclusive no login; os itens da fila offline ficam retidos com erro, sem se perder.
- `compose.local.yaml`: comentário explicando a chave `URBANA_ALLOW_INSECURE_DEMO`.
- Verificado: 126 testes (123 passam, 3 pulados sem PostgreSQL), PostgreSQL real, lint sem erros, build e curl contra o servidor em modo produção reproduzindo login, mutação e upload sem `Origin`.
- Não verificado: o app móvel real em aparelho; o cookie `SameSite=Strict`/`Secure` no armazenamento nativo atrás de HTTPS real.

#### R1 — Boot offline do Campo no app (✅ concluída)

- `src/modules/workspace/useWorkspaceData.ts`: se `/api/bootstrap` não responde (sem rede, timeout de 15 s ou 502/503/504) e a rota é `/campo`, o app inicia o Campo com a sessão salva no IndexedDB. Revalida ao voltar a rede, ao voltar à tela e a cada 15 s; 401 marca sessão expirada e pausa a fila.
- `public/sw.js` (versão `v4`) não toca mais em nenhuma resposta de `/api`.
- Defeito achado e corrigido: o logout pelo menu de gestão e pelo aviso de acesso não apagava a sessão salva, então um gestor podia ser reaberto offline depois de sair.
- Perfil de gestão offline em `/campo`: o Campo abre; "Voltar ao painel de gestão" mostra "Sem conexão com o servidor" em vez do login.
- Chunk de entrada: 280,9 → 283,2 kB (gzip 88,35 → 89,09 kB). ADR-020 reescrita como aceita.
- Verificado em Chrome: `test:field-offline` (duas vezes), `test:field`, `test:onboarding`, `test:authorization`, `test:ui`; build; lint sem erros.
- Não verificado: troca do service worker v3 para v4 em aparelho que já tem o v3; aparelhos reais; `test:kanban`, `test:map`, `test:sector` e `test:p0` não foram rodados nesta tarefa.

#### R3 — Antimalware opcional (✅ concluída)

- `server/modules/files/clamav.js` fala o protocolo `INSTREAM` do `clamd` só com `node:net`; `upload-scan.js` aplica a política nos dois fluxos (evidência e nota fiscal), depois das checagens baratas e antes de persistir.
- Desligado sem `CLAMAV_HOST`. Ligado: arquivo infectado → 422 `MALWARE_DETECTED`, nada salvo, evento de auditoria sem o nome da assinatura (que vai só para o log); clamd fora do ar → 503 `SCAN_UNAVAILABLE` no modo `closed` (padrão) ou aceita com aviso no modo `open`.
- `compose.yaml`: serviço `clamav` no profile opcional `antimalware`. Variáveis `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `CLAMAV_FAIL_MODE`, `CLAMAV_STREAM_MAX_BYTES`. `/healthz` não depende do clamd.
- Verificado: 18 testes novos com clamd falso (144 no total, 141 passam, 3 pulados sem PostgreSQL), lint sem erros e teste real com `clamav/clamav:stable` em container (emulado em amd64, pois a imagem oficial não tem arm64): limpo aceito, infectado recusado, sem sobras no storage.
- Pontos de atenção: o scan roda dentro da fila serial de escritas, então um clamd travado segura as escritas por até 10 s; o frontend e o app móvel precisam tratar 422 `MALWARE_DETECTED` como falha definitiva e 503 `SCAN_UNAVAILABLE` como tentável — a conferir na R10.

#### R10a — Ajustes no app `urbana-campo` (✅ concluída; branch `chore/compat-servidor-novo` naquele repositório, sem commit)

- `X-Urbana-Client: urbana-campo/<versão>` em todas as chamadas (valor atual `urbana-campo/1.0.0`, lido de `app.json`).
- 403 `ORIGIN_REQUIRED`/`ORIGIN_FORBIDDEN` para a sincronização e mostra "atualize o app", sem marcar itens como rejeitados; 422 `MALWARE_DETECTED` é erro definitivo com opção de tirar a foto de novo; 503 `SCAN_UNAVAILABLE` é tentado de novo.
- Equipamento passa a enviar `request_id` e `captured_at`. Upload sem coordenadas válidas é recusado no próprio aparelho; foto tirada com falha de GPS na tela de Envios deixa de ficar órfã.
- Inventário dos 13 endpoints que o app consome comparado com o servidor: sem outras incompatibilidades. O app não usa push nem os perfis de gestão de `/api/campo`.
- Verificado: `npx tsc --noEmit` sem erros; `npx expo lint` com 0 erros e 6 avisos antigos; classificação de erros e envio do cabeçalho validados por script com o axios real contra o middleware real do servidor.
- Ressalvas: `npx expo lint` instala o ESLint e reescreve `package.json`/`package-lock.json` por conta própria; o agente reverteu, então o repositório continua sem configuração de lint versionada. `npx expo-doctor` aponta sete pacotes Expo com patch atrás do esperado pelo SDK 57. O APK existente no repositório é de build antigo e não funciona contra o servidor novo. Nada rodou em aparelho ou emulador.
- Atenção para a R10b: `.maestro/run-e2e.sh` executa `docker compose down -v`, que apaga o volume do banco local; a verificação usará um projeto Compose separado para não tocar nos dados existentes.

#### R4 — Mudanças de contrato da T7 (✅ concluída)

- `GET /api/dashboard` devolve só agregados calculados no banco (com `?tz=`); saíram `orders`, `occurrences`, `materials`, `byNeighborhood` e `byCategory`. Novos, só leitura: `/api/ocorrencias/resumo`, `/api/ordens-servico/resumo`, `/api/kanban/cartoes` e `/api/planejamento/encerrados` (paginado). `/api/planejamento` traz só planos abertos e a contagem de encerrados. `/api/campo` para administrador traz só OS abertas; para a Equipe de Campo nada mudou (respostas idênticas byte a byte).
- Frontend: a área de gestão deixou de baixar as listas completas a cada 15 s; cada tela busca o que usa.
- Medido em SQLite com 40 mil ocorrências: carga da Visão geral de 1.520 ms e 78,6 MB para 120 ms e 12,4 KB; `/dashboard` de 33,5 MB para 5,4 KB; Kanban de 33,4 MB para 5,8 MB; `/campo` de gestão de 29,1 MB para 4,5 MB.
- Verificado: 148 testes (145 passam, 3 pulados sem PostgreSQL; 148 de 148 com PostgreSQL real), equivalência dos números do painel em três fusos, lint sem erros, build e nove suítes de navegador em Chrome. Sem migration nova.
- Decisões de produto tomadas pelo agente, a revisar: Kanban mostra Concluídas dos últimos 30 dias por padrão, com seletor de período, e coluna recortada não pode ser reordenada; planos encerrados em páginas de 20, dos mais recentes para os mais antigos; aba de histórico do `/campo` de gestão mostra só OS abertas; mapa de "Nova ocorrência" mostra só ocorrências em andamento; `byNeighborhood` e `byCategory` removidos do painel.
- Pendente: o Kanban ainda leva 3,7 s para desenhar cerca de 12 mil cartões abertos; `/api/mapa/ocorrencias` segue sem paginação.

#### R5 — Obras e intervenções (✅ concluída no escopo P1 parcial)

- Migration 12 (aditiva): `interventions`, `projects`, tabelas de vínculo e `intervention_conflict_reviews`; geometria em GeoJSON validado com caixa envolvente e, no PostgreSQL, coluna gerada com índice GiST. Nenhuma tabela existente mudou; vínculos não gravam nada em ocorrência nem em OS.
- Máquina de estados própria (`server/domain/works.js`): PLANEJADA, EM_ANDAMENTO, PARALISADA, CONCLUIDA, CANCELADA; paralisar, cancelar e reabrir exigem motivo; obra só conclui com as intervenções concluídas ou canceladas.
- 24 rotas em `server/routes/works.js`, com auditoria, `version` obrigatório, `request_id` na criação, paginação por cursor, bbox e detecção de conflito espacial e temporal (aviso, não bloqueio, com registro de avaliação).
- Módulo `works` (`/obras`): Administrador e Gestor escrevem; Fiscalização e Consulta leem. A migration não libera o módulo a nenhum usuário existente; só a conta master o recebe.
- Interface em `src/modules/works/`: listas, formulários, detalhe, editor de geometria por cliques no mapa com alternativa textual, e camada de intervenções no mapa territorial.
- Verificado: 162 testes (158 passam, 4 pulados sem PostgreSQL; 162 de 162 com PostgreSQL real), lint sem erros, build (chunk de entrada 285 kB), dez suítes de navegador em Chrome incluindo a nova `test:works`, e a migration 12 sobre cópias de bancos SQLite e PostgreSQL existentes.
- Decisões de produto do agente, a revisar: N:N entre intervenção e ocorrência/OS, e no máximo uma obra por intervenção ou OS; obra sem geometria própria; exclusão só em PLANEJADA; conflito = períodos previstos sobrepostos e geometrias a até 15 m; item de menu no nível principal.
- Fora desta entrega (P1): trechos de via e associação espacial automática, documentos da obra, capacidade estimada e WIP por setor/equipe, vínculo a ativos, mostrar as intervenções no detalhe da ocorrência/OS. P2 não tocado: cronograma, custos, medições, fiscalização de obra, interdições.

#### R6 — Portal do cidadão (✅ concluída; portal desligado por padrão)

- Rotas públicas em `server/routes/portal.js` sob `/api/publico` (`GET /catalogo`, `POST /demandas`, `POST /acompanhar`), registradas antes da sessão e fora do `moduleAccess`; com o portal desligado respondem 404. Configuração em Administração > Configurações (`GET/PATCH /api/settings/portal`); `URBANA_PUBLIC_PORTAL=off` vence a configuração.
- Migration 13 (aditiva): `portal_tracking` (só hashes) e `portal_rate_limits` (IP como hash, com expiração).
- A demanda entra como ocorrência a triar com origem "Portal do cidadão", registrada por um usuário técnico `system-portal-cidadao` que não consegue autenticar. O código de acompanhamento tem cerca de 79 bits, é mostrado uma única vez e só o hash é guardado.
- O acompanhamento mostra protocolo, categoria, bairro e seis etapas públicas (Recebida, Em análise, Programada, Em execução, Concluída, Não atendida); número inexistente e código errado respondem igual. Recusa ganhou `public_reason` opcional com textos fixos.
- Contra abuso: 10 criações por hora por IP, 30 consultas a cada 15 minutos por IP, teto global de 30 demandas por hora, campo isca e tempo mínimo de 5 s; sem CAPTCHA.
- Páginas `/portal` e `/portal/acompanhar` numa entrada separada do Vite, sem framework (18,9 kB de JS; o mapa só baixa ao abrir). O chunk da área autenticada não cresceu.
- Verificado: 184 testes (179 passam, 5 pulados sem PostgreSQL; 184 de 184 com PostgreSQL real), lint sem erros, build, onze suítes de navegador em Chrome (duas rodadas) e curl em modo produção.
- Decisões do agente, a revisar: localização obrigatória (quem não tem GPS e não consegue usar o mapa não envia); prioridade inicial Média; o portal não respeita o limite de WIP do Kanban; AGUARDANDO_VALIDACAO aparece como "Em execução"; texto LGPD padrão a ser ajustado pelo jurídico; foto reduzida no navegador, o que remove o EXIF.
- Riscos que continuam: um robô que troca de IP pode esgotar o teto global e bloquear cidadãos por até uma hora; o hash de IPv4 é só pseudonimização; não testado com leitor de tela, em aparelho físico nem atrás de Caddy/HTTPS.

#### R7 — Acessibilidade: auditoria automatizada e correções (✅ concluída, sem commit)

- Ferramenta: `@axe-core/playwright` (única devDependency nova), `tests/a11y-browser.mjs` e `tests/support/a11y.mjs`, script `test:a11y` incluído em `test:browser`. Regras WCAG 2.1 A/AA mais boas práticas; falha em violação `serious`/`critical`. Relatórios em `test-results/a11y-report.json` e `a11y-targets.json`. Suíte leva cerca de 3 min 15 s.
- Cobertura: 110 estados de tela (55 por viewport, 1440x900 e 390x844) em gestão, Campo e portal, incluindo modais, erros, estados vazios e portal desligado.
- Resultado do axe: 2.381 nós com violação antes (2.260 de contraste), 0 depois. Nenhuma regra desativada e nenhuma exceção registrada.
- Correções: tokens de cor de texto em `:root` de `src/styles.css` (`--muted`, `--ink-*`), `inkColor()` em `src/shared/workflow.ts` para selos de status, nomes acessíveis e `role="group"`, landmarks (`<main>` no login, link "Ir para o conteúdo"), título da aba por tela, `TableScroll` focável em 12 tabelas, hook `useModalDialog` devolvendo o foco, alvos de toque de 24 px, reflow do Almoxarifado a 320 px, remoção de `role="status"` na linha que atualiza a cada 15 s.
- Verificações adicionais sem falha: teclado (ordem, foco visível, armadilhas, Escape), zoom de texto a 200% (emulado por viewport), reflow a 320x568, `prefers-reduced-motion`.
- Verificação: `npm test` 184 testes, 179 passam, 5 pulados (conferido pelo orquestrador); o agente relata build, lint com 0 erros e as doze suítes de navegador verdes em Chrome. Chunk de entrada: 283,50 → 285,72 kB.
- Não é certificação WCAG. Pendente de avaliação humana: leitor de tela real (NVDA, VoiceOver), aparelhos físicos, contraste de elementos não textuais, espaçamento de texto e orientação. Marcadores do mapa (16 px) ficam abaixo de 24 px em agrupamento denso; só relatado. Texto de 10 px em `.text-button` merece revisão. Rodou só em Chrome headless no macOS.

#### R8 — Prettier no repositório e `format:check` no CI (✅ concluída, sem commit)

- `prettier --check .` acusava 188 arquivos; depois de `npm run format`, 0. Sem mudança de regras (o projeto usa o padrão do Prettier).
- `docs/TAREFAS-MELHORIAS.md` entrou no `.prettierignore` por ser registro mantido à mão.
- `.github/workflows/ci.yml` ganhou o passo "Formatação" (`npm run format:check`) logo depois do lint.
- Verificação feita pelo orquestrador depois do agente: `format:check` limpo, `npm test` 184 testes / 179 passam / 5 pulados, lint com 0 erros, build ok.
- Observação: o `npm run format` do agente deixou 4 arquivos de fora na primeira passada (formatados em seguida, causa não identificada). A mudança de formatação toca 106 arquivos rastreados; convém ficar em commit próprio para não poluir a revisão.

#### R9 — README e documentação da segunda rodada (✅ concluída, sem commit)

- Atualizados: `README.md`, `docs/API.md`, `DEPLOYMENT.md`, `URBANA-CONTEXTO-MESTRE.md`, `CHANGELOG.md` (entrada "2026-11-12 — segunda rodada", mudanças incompatíveis marcadas), `DECISIONS.md`, `AUTORIZACAO.md`, `ONBOARDING.md`, `MAP-TILES.md`, `mapa-territorial.md` e um aviso de data no topo de `RELATORIO-P0-P1-P2.md`.
- ADRs novos: 024 (obras e intervenções), 025 (portal do cidadão), 026 (`X-Urbana-Client`), 027 (ClamAV, falha fechada por padrão), 028 (contratos agregados da R4). ADR-023 reescrita (`format:check` no CI).
- `format:check` passa; links relativos conferidos por script.
- Fatos levantados pelo agente: `compose.yaml` não repassa `CLAMAV_STREAM_MAX_BYTES` nem `URBANA_PUBLIC_PORTAL` ao contêiner; lint está em 0 erros e 546 avisos; depois do Prettier `server/app.js` tem 173 linhas e `src/main.tsx` 712 (mesmo código, quebras de linha diferentes); tabela de rotas com 110 registros; o axe deixa 250 nós "incompletos" (sem decisão automática, sobretudo no mapa); o texto padrão de consentimento do portal não define prazo de retenção.

#### R10b — Verificação do `urbana-campo` contra o servidor no Docker local (⚠️ parcial)

- Servidor subiu em projeto Compose isolado (`urbana-r10b`, volumes próprios, depois removido); `/healthz` 200 e migrations 1 a 13 aplicadas. Volumes `urbana_urbana_pg` e `urbana_urbana_files` intactos.
- Contrato por script Node usando os módulos reais do app (`api.ts`, `uploadEvidence`, `classifyError` etc.): 71 de 71 verificações passaram — regra de origem e `X-Urbana-Client`, login, bootstrap, `/campo`, ações da OS com idempotência e conflito de versão, material, equipamento idempotente, evidência com e sem GPS, ocorrência e duplicidade, antimalware (clamd falso: 422 e 503), sessão. Nenhum defeito de compatibilidade no app.
- Estático: `tsc --noEmit` ok; `npm run lint` com 0 erros e 6 avisos antigos. O app não tem testes unitários.
- Defeito achado no servidor (D1): o `Dockerfile` não copiava `portal.html`, e o build da imagem falhava desde a R6 (`Could not resolve entry module "portal.html"`). Corrigido pelo orquestrador; `docker build` conferido.
- Não executado: APK novo no emulador e fluxos Maestro. O build Android local parou com `No space left on device` (restavam 313 MB; hoje cerca de 3,5 GB livres, 99% de uso). Ficam sem verificar telas, câmera, GPS, SQLite, fila offline de ponta a ponta e o cookie `SameSite=Strict` no cookie store nativo.

#### Ajustes do orquestrador depois da R9 e da R10b

- `Dockerfile`: `portal.html` incluído no `COPY` do estágio de build (D1).
- `compose.yaml`: o serviço `app` passou a receber `URBANA_PUBLIC_PORTAL` e `CLAMAV_STREAM_MAX_BYTES`; sem isso o botão de emergência do portal não funcionava em implantação por Compose. `DEPLOYMENT.md`, README e contexto mestre ajustados.

### Estado final da segunda rodada (2026-11-12)

- `npm test` com PostgreSQL/PostGIS real: 184 testes, 184 passam, 0 pulados. Sem PostgreSQL: 179 passam e 5 pulados.
- `npm run lint`: 0 erros, 546 avisos. `npm run format:check`: limpo. `npm run build`: ok. `docker build` da imagem: ok.
- Nada foi commitado em nenhum dos dois repositórios.
- `URBANA_BROWSER_CHANNEL=chrome npm run test:browser` (doze suítes, incluindo `test:a11y`): saída 0, conferido pelo orquestrador depois de todos os ajustes.
