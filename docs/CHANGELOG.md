# Changelog — Urbana

Registro das principais evoluções funcionais, técnicas e correções do sistema. O [contexto mestre](URBANA-CONTEXTO-MESTRE.md) explica o funcionamento atual; este arquivo registra o que mudou e a origem dos registros. Contagens de testes abaixo pertencem às respectivas verificações, não são metas ou garantias de homologação.

## 2026-11-12 — segunda rodada

Segunda série de tarefas (R1 a R8, mais o ajuste do app móvel R10a), na mesma branch `chore/melhorias-tecnicas`, nada commitado. Resolve os itens que a primeira série deixou em aberto e acrescenta obras e intervenções, o portal do cidadão e a auditoria de acessibilidade. O registro das tarefas está em [TAREFAS-MELHORIAS.md](TAREFAS-MELHORIAS.md). Execução ainda em Node 22.20.0; ver "Não verificado e pendências" ao fim desta entrada.

### Mudanças incompatíveis

- **`GET /api/dashboard` devolve só agregados** (R4). Saíram `orders`, `occurrences`, `materials`, `byNeighborhood` e `byCategory`; entraram contadores e séries calculados no banco, com `?tz=` (fuso IANA, padrão `UTC`) para a evolução de 90 dias. Quem lia as listas pelo painel precisa usar `GET /api/ordens-servico`, `GET /api/ocorrencias` ou os resumos abaixo. A interface foi migrada.
- **`GET /api/planejamento` devolve só os planos abertos em `plans`**, mais o campo novo `closed_plans` (número de planos encerrados); os encerrados passaram a `GET /api/planejamento/encerrados` (paginado).
- **`GET /api/campo` para perfis de gestão (conta master)** traz só as OS abertas. Para a Equipe de Campo nada mudou (respostas idênticas byte a byte; é o contrato do app móvel).
- **Clientes sem `Origin` (app nativo)** passaram a depender do cabeçalho `X-Urbana-Client` (abaixo). Não muda nada para navegadores nem para quem já envia `Origin`.
- Um caminho de `/api` que não corresponde a nenhuma rota passou a responder 404 (antes, 403 `Módulo não autorizado.`) para usuário autenticado. Rotas reais de módulo não liberado continuam 403.

### Segurança e uploads

- Mutações sem `Origin` e sem `Sec-Fetch-Site` são aceitas somente com `X-Urbana-Client: <nome>` (1 a 64 caracteres `A-Z a-z 0-9 . _ / -`, começando por letra ou dígito); com `Origin` ou `Sec-Fetch-Site` presentes o cabeçalho é ignorado e valem as regras anteriores. Erros `ORIGIN_REQUIRED` e `ORIGIN_FORBIDDEN` inalterados (R2; [ADR-026](DECISIONS.md)). **Aviso de implantação:** publique o app `urbana-campo` com o cabeçalho **antes** de colocar este backend em produção; instalações antigas recebem 403 `ORIGIN_REQUIRED` em toda mutação, inclusive no login (detalhes em [DEPLOYMENT](DEPLOYMENT.md#clientes-nativos-e-o-app-urbana-campo)).
- Upload de evidência sem localização: a checagem de localização ausente passou a rodar antes da validação de coordenadas, então "Informe a localização da evidência." aparece (400); `lat=""` deixou de ser aceito como coordenada 0 (R2).
- **Antimalware opcional com ClamAV** (R3; [ADR-027](DECISIONS.md)): `server/modules/files/clamav.js` fala o protocolo `INSTREAM` do `clamd` por TCP, sem dependência nova; `upload-scan.js` aplica a política nos uploads de evidência, de nota fiscal e da foto do portal, depois das checagens baratas e antes de gravar. Desligado sem `CLAMAV_HOST`. Arquivo infectado: 422 `MALWARE_DETECTED`, nada salvo, evento de auditoria sem o nome da assinatura (que vai só para o log). `clamd` fora do ar ou lento: 503 `SCAN_UNAVAILABLE` no modo `closed` (padrão) ou arquivo aceito com aviso no log no modo `open`. Variáveis `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `CLAMAV_FAIL_MODE`, `CLAMAV_STREAM_MAX_BYTES`; serviço `clamav` no profile `antimalware` do `compose.yaml`. `/healthz` não depende do `clamd`.
- `compose.local.yaml`: a chave `URBANA_ALLOW_INSECURE_DEMO` foi mantida, com comentário, porque o app móvel é testado contra o backend local pelo IP da rede (decisão tomada nesta rodada, a revisar).

### Consultas e contratos agregados

- Novos, só leitura (R4): `GET /api/ocorrencias/resumo` (contagem por estado; `bairros=1` acrescenta a lista de bairros), `GET /api/ordens-servico/resumo` (contagem por equipe e estado), `GET /api/kanban/cartoes` (cartões em projeção mínima, com `counts` do quadro completo) e `GET /api/planejamento/encerrados`.
- A área de gestão deixou de baixar as listas completas a cada 15 s; cada tela busca o que usa. Num banco SQLite sintético de 40 mil ocorrências: carga da Visão geral de 1.520 ms e 78,6 MB para 120 ms e 12,4 KB; `/dashboard` de 33,5 MB para 5,4 KB; Kanban de 33,4 MB para 5,8 MB; `/campo` de gestão de 29,1 MB para 4,5 MB. Equivalência dos números do painel provada em `tests/query-equivalence.test.js` (SQLite e PostgreSQL) e em três fusos.
- Decisões de produto tomadas na implementação, a revisar ([ADR-028](DECISIONS.md)): o Kanban mostra as Concluídas dos últimos 30 dias por padrão, com seletor de período, e uma coluna recortada não pode ser reordenada; planos encerrados em páginas de 20, dos mais recentes para os mais antigos; a aba de histórico do `/campo` de gestão mostra só OS abertas; o mapa de "Nova ocorrência" mostra só ocorrências em andamento; `byNeighborhood` e `byCategory` saíram do painel.

### Obras e intervenções

- Migration 12 (aditiva): `projects`, `interventions`, tabelas de vínculo e `intervention_conflict_reviews`; geometria em GeoJSON validado com caixa envolvente e, no PostgreSQL, coluna gerada com índice GiST. Nenhuma tabela existente mudou; vincular não grava nada em ocorrência nem em OS (R5; [ADR-024](DECISIONS.md)).
- Módulo e ação `works` (`/obras`, "Obras e intervenções"): Administrador e Gestor escrevem; Fiscalização e Consulta leem; a migration não libera o módulo a nenhum usuário existente (só a conta master o recebe).
- 24 rotas em `server/routes/works.js` (`/api/intervencoes` e `/api/obras`), máquina de estados própria (`server/domain/works.js`), `version` obrigatória, `request_id` na criação, paginação por cursor, `bbox`, auditoria e detecção de conflito espacial e temporal (aviso, não bloqueio, com registro de avaliação). Contrato em [API](API.md#obras-e-intervenções).
- Interface em `src/modules/works/` (listas, formulários, detalhe, editor de geometria por cliques no mapa com alternativa textual) e camada de intervenções no mapa territorial, carregada sob demanda e só para quem tem o módulo.
- Fora desta entrega: trechos de via e associação espacial automática, documentos da obra, capacidade estimada e WIP por setor/equipe, vínculo a ativos, intervenções no detalhe da ocorrência/OS; do P2, cronograma, custos, medições, fiscalização de obra e interdições.

### Portal do cidadão

- Registro público de demanda e acompanhamento por protocolo, **desligado por padrão** (R6; [ADR-025](DECISIONS.md)). Rotas `GET /api/publico/catalogo`, `POST /api/publico/demandas` e `POST /api/publico/acompanhar`, páginas `/portal` e `/portal/acompanhar` (entrada separada do Vite, sem framework, que não carrega a área autenticada). Liga em Administração > Configurações (`GET/PATCH /api/settings/portal`); `URBANA_PUBLIC_PORTAL=off` vence a configuração. Desligado, tudo sob `/api/publico` responde 404.
- Migration 13 (aditiva): `portal_tracking` (só hashes) e `portal_rate_limits` (IP como hash, com expiração), mais as linhas `portal` e `portal_secret` em `settings`.
- A demanda entra como ocorrência `IDENTIFICADA` com origem "Portal do cidadão", registrada pelo usuário de sistema `system-portal-cidadao` (perfil `Sistema`), que não consegue autenticar e não aparece na administração. O código de acompanhamento (16 caracteres, cerca de 79 bits) é mostrado uma única vez; só o SHA-256 é guardado.
- O cidadão vê protocolo, categoria, bairro e seis etapas públicas; número inexistente e código errado respondem igual. A recusa ganhou `public_reason` opcional, com textos fixos.
- Contra abuso: 10 criações por hora por IP, 30 consultas a cada 15 minutos por IP, teto global de 30 demandas por hora, campo isca e tempo mínimo de 5 s. Sem CAPTCHA.

### Campo offline

- O Campo abre sem rede a partir da sessão salva no IndexedDB (R1; [ADR-020](DECISIONS.md) reescrita como aceita). Em `src/modules/workspace/useWorkspaceData.ts`, se `/api/bootstrap` não responde (sem rede, tempo de 15 s ou 502/503/504) e a rota é `/campo`, o app inicia com a sessão salva e revalida ao voltar a rede, ao voltar à tela e a cada 15 s; 401 marca a sessão como expirada e pausa a fila.
- O service worker passou a `v4` e **não toca mais em nenhuma resposta de `/api`**; a exceção para `GET /api/bootstrap` da primeira série foi removida.
- Defeito corrigido: o logout pelo menu de gestão e pelo aviso de acesso não apagava a sessão salva, então um gestor podia ser reaberto offline depois de sair.

### Acessibilidade

- Auditoria automatizada com `@axe-core/playwright` (única dependência de desenvolvimento nova): `npm run test:a11y` (`tests/a11y-browser.mjs`, `tests/support/a11y.mjs`), incluída em `test:browser`. Regras WCAG 2.1 A/AA e boas práticas; falha em violação `serious` ou `critical`. Cobre 110 estados de tela (55 por viewport, 1440x900 e 390x844) em gestão, Campo e portal, com modais, erros, estados vazios e portal desligado; complementa com teclado, alvo de toque de 24 px, reflow a 320 px, zoom de texto a 200%, `prefers-reduced-motion`, `lang` e título da aba. Relatórios em `test-results/a11y-report.json` e `a11y-targets.json`.
- Resultado: 2.381 nós com violação antes (2.260 de contraste), 0 depois, sem regra desativada nem exceção registrada. Correções: tokens de cor de texto em `:root` de `src/styles.css`, `inkColor()` para selos de status, nomes acessíveis e `role="group"`, landmarks e link "Ir para o conteúdo", título da aba por tela, tabelas rolando com foco (`TableScroll`), hook `useModalDialog` que devolve o foco, alvos de toque de 24 px, reflow do Almoxarifado a 320 px, remoção de `role="status"` da linha que atualiza a cada 15 s.
- **Não é certificação WCAG.** Ver "Não verificado e pendências".

### Qualidade, formatação e CI

- `npm run format:check` agora roda no CI, logo depois do lint (R8; [ADR-023](DECISIONS.md) atualizada). O repositório foi formatado com `npm run format` (188 arquivos fora do padrão antes, 0 depois; 106 arquivos rastreados tocados); sem mudança de regras do Prettier. `docs/TAREFAS-MELHORIAS.md` está no `.prettierignore`. Convém manter a formatação em commit próprio, para não poluir a revisão.
- **Contagens:** `npm test` roda **184 testes: 179 aprovados, 5 não executados** (exigem `URBANA_POSTGRES_TEST_URL`: dois em `tests/postgres.test.js` e um em cada um de `query-equivalence`, `works` e `portal`). Segundo o registro da R6, com PostgreSQL/PostGIS real foram 184 de 184; essa execução não foi repetida na revisão da documentação. **Treze migrations** (1 a 13). **Doze suítes de navegador** em `npm run test:browser` (`test:ui`, `test:field`, `test:field-offline`, `test:kanban`, `test:map`, `test:authorization`, `test:onboarding`, `test:sector`, `test:p0`, `test:works`, `test:portal`, `test:a11y`), em Chrome, escolhido por `URBANA_BROWSER_CHANNEL`. Lint com 0 erros e 546 avisos (453 de `no-explicit-any`; eram 504 ao fim da primeira série, o aumento vem do código novo). Tabela de rotas de 110 registros (eram 77), fixada por `tests/route-table.test.js`. Depois do Prettier e da inclusão do portal e das obras, `server/app.js` tem 173 linhas e `src/main.tsx` 712 (eram 79 e 326 ao fim da T8, antes da formatação).

### App móvel `urbana-campo` (R10a)

- O app (repositório irmão, branch `chore/compat-servidor-novo`, sem commit) passou a enviar `X-Urbana-Client: urbana-campo/<versão>` em todas as chamadas, tratar `ORIGIN_REQUIRED`/`ORIGIN_FORBIDDEN` como "atualize o app" (sem rejeitar itens da fila), `MALWARE_DETECTED` como erro definitivo e `SCAN_UNAVAILABLE` como tentável, e a enviar `request_id` e `captured_at` no lançamento de equipamento (idempotente). O APK existente no repositório do app é de build antigo e não funciona contra este servidor.

### Não verificado e pendências

- Nada desta rodada foi verificado no **GitHub Actions real**, em **aparelho físico**, no **Edge**, com a **imagem Docker** do app em produção, atrás de **Caddy/HTTPS real** nem com **Node 24** (a máquina local tem Node 22.20.0; `Dockerfile` e CI usam 24). Os testes de navegador rodaram só em Chrome headless no macOS.
- Acessibilidade: sem leitor de tela (NVDA, VoiceOver), aparelhos reais, contraste de elementos não textuais, espaçamento de texto e orientação; o axe deixou 250 nós como "incompletos" (sem decisão automática, a maioria em controles do mapa e elementos sobrepostos). Marcadores do mapa (16 px) ficam abaixo de 24 px em agrupamento denso; o texto de 10 px em `.text-button` merece revisão.
- Antimalware: o teste com `clamd` real rodou em container emulado em amd64 (a imagem oficial não tem arm64); o scan roda dentro da fila serial de escritas, então um `clamd` travado segura as escritas por até o tempo limite (10 s por padrão). `compose.yaml` repassa ao app só `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` e `CLAMAV_FAIL_MODE`; `CLAMAV_STREAM_MAX_BYTES` exigiria acrescentar a variável ao bloco `environment`.
- Portal: sem CAPTCHA; um robô que troque de IP pode esgotar o teto global e bloquear cidadãos por até uma hora; o hash de IPv4 é só pseudonimização (o espaço de endereços é pequeno), não anonimização; o texto padrão de consentimento (LGPD) precisa de revisão jurídica antes de ligar o portal; localização obrigatória (quem não tem GPS nem consegue usar o mapa não envia); o portal não respeita o limite de WIP do Kanban.
- Desempenho: o Kanban ainda leva cerca de 3,7 s para desenhar 12 mil cartões abertos; `GET /api/mapa/ocorrencias` segue sem paginação.
- Service worker: a troca da versão `v3` para a `v4` não foi observada num aparelho que já tinha a `v3`.
- App móvel: nada rodou em aparelho ou emulador; o cookie `SameSite=Strict`/`Secure` no armazenamento nativo atrás de HTTPS real não foi verificado.
- Do P2 de obras, o que está fora de escopo continua fora (ver acima).

## 2026-11-12 — primeira série

Série de melhorias técnicas (branch `chore/melhorias-tecnicas`). Nenhuma regra de negócio mudou; os contratos HTTP permanecem compatíveis, exceto a exigência de `Origin` nas mutações (abaixo). Execução em Node 22.20.0; ver "Não verificado" ao fim. **Esta entrada descreve o estado ao fim da primeira série;** vários itens abaixo foram resolvidos ou alterados na [segunda rodada](#2026-11-12--segunda-rodada) (exigência de `Origin`, exceção do service worker, propostas de contrato agregado, `format:check` no CI e os dois problemas "achados e não corrigidos").

### Segurança

- Cabeçalhos em `server/security.js`: CSP estrita em produção, sem `unsafe-inline` (o estilo de `public/offline.html` foi movido para `offline.css`), `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` e, com `SECURE_COOKIE=true`, HSTS de um ano e `upgrade-insecure-requests`. `VITE_MAP_TILE_URL` passou a ser necessária também em tempo de execução, para liberar o host dos tiles em `img-src`.
- **Mudança de contrato:** mutações exigem `Origin` igual ao `Host` ou `Sec-Fetch-Site: same-origin`; 403 `ORIGIN_REQUIRED` / `ORIGIN_FORBIDDEN`. Clientes fora do navegador precisam enviar `Origin`.
- Limite de login persistido na tabela `login_attempts` (migration 11), com a mesma política de 10 falhas por IP em 15 minutos; nova variável `TRUST_PROXY` (`1` no `compose.yaml`).
- Em `--production`, com `HOST` fora de loopback ou `SECURE_COOKIE=true`, o servidor recusa subir com `DEMO_DATA` ligado, `ADMIN_PASSWORD` de demonstração ou contas na senha `Urbana@2026`; `compose.local.yaml` ganhou `URBANA_ALLOW_INSECURE_DEMO: "true"` (decisão pendente do responsável).
- `Caddyfile`: corpo limitado a 20 MB e cabeçalho `Server` removido.

### Banco e estrutura do código

- Migrations 1–10 movidas, sem alterar o SQL, para `server/migrations/001…010-*.js`; o executor em `server/db.js` exige numeração contínua. Migrations 1 e 9 são repetíveis. Conferido em cópias de um banco SQLite existente e de um banco legado: esquema e dados idênticos.
- PostgreSQL com pool e transação por cliente (`db.transaction`); fila serial de escrita mantida; `GET` fora da fila (leitura em `READ COMMITTED`).
- `server/app.js` de 1.499 para 79 linhas: infraestrutura em `server/http/`, rotas por domínio em `server/routes/`; tabela de 77 rotas idêntica, fixada por `tests/route-table.test.js`.
- `src/main.tsx` de 3.392 para 326 linhas: telas em `src/modules/<área>/`, utilitários em `src/shared/`, hooks do shell em `src/modules/workspace/`. Chunk de entrada de 331 para 281 kB (gzip de 99,6 para 88,4 kB); detalhe, formulários e administração carregam sob demanda.

### Campo offline

- IndexedDB `urbana-field` versão 2 (migração aditiva): `session`, `cache` (tarefas e detalhe das OS por usuário) e `outbox` (fila de ações com `request_id` e `captured_at`), além dos rascunhos. Todo o ciclo da OS pode ser feito sem rede, com validação local, estado otimista e painel "Pendências de envio"; sincronização ao reconectar, ao voltar ao app, a cada 15 s, por "Enviar agora" e por Background Sync quando existe. Falha de rede/5xx repete com espera crescente; 401 pausa e pede login; outro 4xx rejeita a ação com o motivo (reenviar ou descartar).
- Service worker `v3`: HTML pela rede primeiro, arquivos com hash em cache, nenhuma resposta de `/api` no Cache Storage; exceção deliberada para `GET /api/bootstrap` sem rede em páginas `/campo` com sessão salva.
- Seção "Equipamentos utilizados" criada na tela de execução. `POST /api/ordens-servico/:id/equipamento` passou a aceitar `request_id` e `captured_at` (reenvio devolve `{ok:true, replayed:true}`; chave em outra OS: 409 `REQUEST_ID_REUSED`), sem migration.

### Operação

- `/healthz` consulta o banco (limite de 2 s) e responde 503 `{"ok":false}` em falha.
- `server/logger.js`: JSON por linha em produção, texto em desenvolvimento, `LOG_LEVEL`/`LOG_FORMAT`; `X-Request-Id` em toda resposta; sem corpo, cookies ou tokens nos logs; os `console.*` do servidor foram substituídos.
- `npm run backup`: pasta com carimbo UTC, banco (`VACUUM INTO` no SQLite, `pg_dump` no PostgreSQL), `uploads/`, `invoices/` e `manifest.json` com SHA-256; retenção por `BACKUP_KEEP` (padrão 14). O `Dockerfile` copia os dois scripts; a imagem não traz o cliente PostgreSQL.
- `npm run uploads:cleanup` (com `--dry-run`) e varredura agendada `UPLOAD_SWEEP_INTERVAL_HOURS` (desligada por padrão), só storage local, carência de 24 h, recusa com banco sem referências.
- Push: reivindicação atômica de cada job com concessão de 5 minutos (sem migration), entrega pelo menos uma vez; as escritas continuam serializadas por processo.

### Consultas amplas

- `/api/controle-setor`, `/api/ocorrencias/proximas`, checagem de duplicidade, `/api/dashboard`, `/api/planejamento` e `/api/campo` passaram a agregar em SQL; contagens de WIP do Kanban viraram `GROUP BY`. Respostas JSON idênticas byte a byte; nenhum índice novo.
- Num banco SQLite sintético de 40 mil ocorrências e 29 mil OS: `/api/controle-setor` de 29.051 para 5 consultas (701 → 187 ms); `proximas` de 198 para 1 ms; duplicidade de 210 para 21 ms; `/api/dashboard` de 2.050 para 616 ms; `/api/planejamento` e `/api/campo` de 166 s e 345 s (5 mil ocorrências, crescimento cúbico) para 1,0 s e 0,4–0,6 s (40 mil). Novo `tests/query-equivalence.test.js` compara as implementações antigas com o HTTP real, em SQLite e PostgreSQL.
- Não feito, por mudar contrato: painel só com agregados (hoje 33 MB por carga com 40 mil registros), paginar planos encerrados, limitar `/api/campo` de gestão às OS abertas e endpoint próprio de cartões do Kanban.

### Qualidade e testes

- ESLint (`npm run lint`), Prettier (`format`, `format:check`) e `.github/workflows/ci.yml` (lint, testes com PostgreSQL/PostGIS como serviço e build). Lint: zero erros e 504 avisos, 424 de `no-explicit-any`; regras com violações existentes rebaixadas para aviso, não desligadas.
- `tests/support/browser.mjs` e `URBANA_BROWSER_CHANNEL` (`msedge` por padrão, `chrome` ou `chromium`); scripts `test:sector`, `test:p0`, `test:field-offline` e `test:browser` (as nove suítes em sequência).
- Corrigidos testes de navegador que já falhavam antes (`test:ui`, `test:kanban`, `sector-browser`): estavam defasados (coluna Concluídas sempre visível, módulo vindo da URL sem fallback de SPA no servidor de teste, grupo de menu recolhido); a intermitência do Kanban era uma leitura imediata do DOM e virou espera por condição.
- Novos testes: segurança, `/healthz` e logs, backup, órfãos, push, fila offline do Campo (14), consultas, tabela de rotas e navegador offline. **`npm test`: 123 testes, 120 aprovados, nenhuma falha e 3 não executados** (sem `URBANA_POSTGRES_TEST_URL`); últimas execuções registradas contra PostgreSQL real: 122 de 122 (antes do teste de rotas). Nove suítes de navegador aprovadas em Chrome.

### Documentação

- README e documentos de `docs/` atualizados (migrations 1–11, contagem de testes, scripts, CI, offline, segurança, backup); ADR-016 a ADR-023.

### Não verificado e pendências

- O workflow de CI não foi executado no GitHub; 135 arquivos estão fora do padrão Prettier (a T1 registrou 69; a contagem de 2026-11-12 inclui, por exemplo, 30 arquivos de `src/modules/` e 7 de `server/routes/`; o conjunto inclui também arquivos Markdown) e `format:check` e os testes de navegador ficaram fora do CI.
- Nada foi testado em aparelho real nem em Edge; iOS sem Background Sync e com possível apagamento dos dados do site após cerca de sete dias sem uso. Fotos de até 15 MB ficam no IndexedDB sem compressão; registrar nova ocorrência continua exigindo rede.
- Imagem Docker da aplicação e Caddy real não foram exercitados; duas instâncias reais não foram testadas (simulado com duas pools no mesmo processo); benchmark de volume em PostgreSQL não foi feito.
- `pg_dump` do host (só validado dentro do container do banco) e restauração de um dump PostgreSQL não foram testados.
- Problemas achados e não corrigidos: a mensagem "Informe a localização da evidência." nunca aparece no upload de evidência (validação de coordenadas roda antes, `server/routes/attachments.js`); caminho desconhecido em `/api` responde 403 "Módulo não autorizado." em vez de 404 para usuário autenticado.
- A verificação usou Node 22.20.0; o projeto pede Node 24+ (`Dockerfile`, CI).

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

| Origem                                 | Descrição anterior                                                                    | Comportamento confirmado no código                                                                                                 | Decisão documental                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Mestre / auditoria inicial             | Centralização da state machine ainda pendente; ausência de contrato único             | `server/domain/workflow.js` já define estados e transições, usado pelas rotas                                                      | Marcar como implementado; manter achado como histórico anterior                                  |
| Contextos / README / análise histórica | Não há estoque ou somente saída básica; estoque mínimo/reposição inteiramente futuros | `server/inventory.js` e `server/invoices.js` implementam entradas/saídas, saldo, mínimo, sugestão, extração e confirmação de notas | Descrever estoque como parcial, preservar reservas/transferências/inventário completo no roadmap |
| README / auditoria sobre API antiga    | Plano exige 2–100 demandas; API atual já havia sido corrigida para 1–100              | `createPlan` aceita 1–100, mesmo setor, estados iniciais e ausência de plano/OS                                                    | Corrigir README, complementar contrato e mestre sem repetir achado como falha atual da API       |
| Implantação                            | Atualização automática menciona somente migrations 2 e 3                              | Banco aplica 1–4; versão 4 cria notas, itens e movimentos                                                                          | Listar quatro versões e compatibilidade; não anunciar versões futuras                            |
| Análise histórica / Kanban             | Quadro não move por arraste; contexto chama a coluna “Pronta para programar”          | Há arraste real com formulário; `shared/kanban.mjs` ainda usa título “Em triagem”                                                  | Histórico relata evolução; mestre descreve ação atual e diferença de rótulo                      |
| Kanban                                 | Entregas descritas genericamente como OS validadas em 30 dias                         | `flowMetrics` exige estado atual CONCLUIDA e data no período                                                                       | Explicitar que reabertas saem da contagem; não afirmar histórico imutável de validações          |
| Análise histórica do mapa              | Busca externa de endereço permanece em mapa/panorama                                  | `AddressSearch` e GIS removidos; entrada manual/GPS/mapa vigente                                                                   | Preservar remoção no histórico e documentar localização atual                                    |
| Mestre                                 | PostGIS listado entre integrações futuras                                             | Adaptador já cria ponto `geom`/GiST, mas não foi homologado em instância real                                                      | Marcar suporte como parcial; geometrias ampliadas e vias permanecem P1                           |
| Artefatos de permissões / scripts      | Código auxiliar sugere overrides e três novos perfis                                  | App usa seis perfis; helpers/formulário/scripts não estão integrados e `openDatabase` termina na migration 4                       | Registrar como não integrado, sem executar scripts ou afirmar novas permissões ativas            |
| Auditoria / mestre                     | Versões 5/6/7 propostas e locking/paginação como evolução                             | Não há `version` geral nem paginação; Kanban tem `revision`/etapa esperada                                                         | Manter diretrizes planejadas e numeração como hipótese a confirmar                               |
| Contextos / análise de setor           | Visão de setor descrita como capacidade e referências genéricas a “obra”              | Controle mensal consolida OS/serviços/contatos; planos são operacionais                                                            | Distinguir contagem de capacidade e plano de entidades futuras de obra/intervenção               |

### Conteúdo recuperado antes da remoção

| Fonte consolidada  | Informação preservada                                                                                          | Destino                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Contexto funcional | Jornadas, pessoas, módulos, origem demonstrativa, SLA, duplicidade, acessibilidade, limites e integrações      | Contexto mestre, seções 1–11                                        |
| Arquitetura        | Entidades/N:N/JSON, projeção de estados, permissões, segurança, fila/transações, arquivos órfãos, campo e push | Contexto mestre, seções 2–3 e 8–10; ADRs                            |
| UX                 | Guardar triagem/programar depois, recusa/devolução, contexto opcional, rollback, feedback e teclado            | Contexto mestre, seções 2 e 4–5; correções históricas neste arquivo |
| Kanban             | Cartões, arraste/formulários, ordenação, WIP global, conflitos, métricas, filtros, navegação e revisão diária  | Contexto mestre, seções 4 e 6; API                                  |
| Análise/evolução   | Painel, feedback, distribuição, heatmap, Kanban, decisão/recusa e verificações                                 | Este histórico; regras atuais incorporadas ao mestre                |
| Auditoria P0/P1    | Achados, preservação de invariantes, prioridades, migrations e critérios de evolução                           | Este histórico; limitações/roadmap no mestre; ADRs 9 e 12           |
| Mestre anterior    | Especificações de obras/intervenções, GIS, mobilidade, cronograma, custos, medições, inspeção e P0–P3          | Contexto mestre, seções 1 e 11–13; ADRs                             |

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
