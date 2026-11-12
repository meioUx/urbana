# Urbana · Gestão de Manutenção Municipal

Aplicação web para registrar demandas, programar ordens de serviço, acompanhar execução e validação municipal e, opcionalmente, planejar obras e intervenções e receber demandas do cidadão. React + TypeScript no frontend, Express com sessão autenticada no backend e SQLite local ou adaptador PostgreSQL/PostGIS.

O fluxo operacional é **Demanda → Triagem → Programação → Execução → Validação → Conclusão**. Uma ocorrência representa a demanda; uma Ordem de Serviço (OS) organiza seu atendimento e pode reunir mais de uma ocorrência.

## Recursos disponíveis

| Área                        | Funcionalidades                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visão geral                 | Indicadores agregados no banco e acompanhamento de estados, prioridades, bairros, prazos e carga das equipes                                                                                                                                                                |
| Ocorrências e triagem       | Registro com localização e evidências, identificação de duplicidade, classificação, recusa justificada e filas A analisar / Prontas para programar                                                                                                                          |
| Programação e OS            | Seleção de equipe do mesmo setor, atribuição para equipe ou operador, consulta da carga e acompanhamento do atendimento                                                                                                                                                     |
| Planejamento                | Priorização por urgência, prazo, idade e volume; planos de ação com uma ou mais demandas e emissão de plano + OS na mesma transação                                                                                                                                         |
| Obras e intervenções        | Obras e intervenções com geometria no mapa, período, situação, vínculos opcionais a ocorrências e OS e aviso de conflito de local e prazo (`/obras`; módulo liberado por usuário; [contexto](docs/URBANA-CONTEXTO-MESTRE.md#obras-e-intervenções--implementado-p1-parcial)) |
| Kanban                      | Cartões de demanda e OS agrupada, filtros, ordenação compartilhada, limites WIP e movimentação por arraste, teclado ou toque                                                                                                                                                |
| Mapa territorial            | Pontos e mapa de calor, filtros, lista de atendimentos, acesso aos detalhes e evidências e camada opcional de intervenções                                                                                                                                                  |
| Campo (`/campo`)            | Minhas tarefas, assumir atendimento, chegada, fotos antes/depois, materiais, equipamentos, relato, envio para análise e devolução justificada; funciona sem rede com fila de envio ([limites](#campo-sem-rede))                                                             |
| Análise de campo            | Conferência de relato e evidências, validação e reabertura com motivo                                                                                                                                                                                                       |
| Equipes e controle do setor | Estrutura das equipes, carga registrada e acompanhamento dos serviços e contatos do setor                                                                                                                                                                                   |
| Materiais e equipamentos    | Almoxarifado, notas fiscais com revisão antes da confirmação, movimentações de estoque e consumo relacionado às OS                                                                                                                                                          |
| Administração               | Usuários, perfis, liberações individuais de módulos, cadastros, configurações e auditoria                                                                                                                                                                                   |
| Ajuda e onboarding          | Boas-vindas por perfil, treinamento contextual e tutoriais individuais acessíveis pela Ajuda                                                                                                                                                                                |
| Portal do cidadão           | Registro público de demanda e acompanhamento por protocolo e código (`/portal`), **desligado por padrão**, sem login e sem notificação externa ([riscos e decisões](#portal-do-cidadão))                                                                                    |

As regras operacionais continuam obrigatórias: triagem prepara a demanda; gestão programa; campo executa; **Enviar para análise** deixa a OS em **Aguardando validação**. Gestão/fiscalização confere antes da conclusão definitiva. Devolução exige justificativa e reabertura exige motivo. Algumas exigências de fotos, materiais e equipamentos dependem da categoria.

## Executar

Requer **Node.js 24 ou superior** (é a versão do `Dockerfile` e do CI; o `package.json` não declara `engines`). No PowerShell, utilize `npm.cmd` quando a política local bloquear `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Acesse http://127.0.0.1:3000. Para desenvolvimento com atualização automática, use `npm.cmd run dev`. `PORT` escolhe a porta; `HOST` é `127.0.0.1` por padrão. Variáveis de `.env` são carregadas na inicialização; consulte [.env.example](.env.example).

Na primeira execução, o banco e o seed são criados. Os exemplos usam Balneário Camboriú como referência geográfica e não representam demandas reais.

| Perfil de demonstração               | E-mail                | Senha inicial |
| ------------------------------------ | --------------------- | ------------- |
| Administrador / master de manutenção | admin@urbana.local    | Urbana@2026   |
| Gestor                               | gestor@urbana.local   | Urbana@2026   |
| Triagem                              | triagem@urbana.local  | Urbana@2026   |
| Equipe de Campo                      | campo@urbana.local    | Urbana@2026   |
| Fiscalização                         | fiscal@urbana.local   | Urbana@2026   |
| Consulta                             | consulta@urbana.local | Urbana@2026   |

`ADMIN_PASSWORD` substitui a senha inicial das contas criadas pelo seed, sem redefinir usuários existentes. Para instalação real, use banco novo, `DEMO_DATA=false`, senha própria e HTTPS com `SECURE_COOKIE=true`, seguindo [Implantação](docs/DEPLOYMENT.md).

**A demonstração é só local.** Com `npm start` (`--production`), o servidor **recusa subir** quando `HOST` não é loopback ou `SECURE_COOKIE=true` e, ao mesmo tempo, `DEMO_DATA` não é `false`, `ADMIN_PASSWORD` é a senha de demonstração ou alguma conta ainda aceita `Urbana@2026`. A recusa vale para o servidor que pode ser alcançado fora do computador; `HOST=127.0.0.1` continua servindo a demonstração. Só o ambiente local de homologação (`compose.local.yaml`, `HOST=0.0.0.0` por HTTP) usa a exceção explícita `URBANA_ALLOW_INSECURE_DEMO=true`, ignorada quando `SECURE_COOKIE=true`; nunca a defina num servidor público. O ambiente local com PostgreSQL/PostGIS e dados de demonstração (`docker compose -f compose.local.yaml up -d --build`) está descrito em [Implantação](docs/DEPLOYMENT.md#ambiente-local-com-postgresqlpostgis-desenvolvimento-e-homologação).

## Atualizar uma instalação existente

Faça backup consistente do banco e dos arquivos antes da atualização. Com o código atualizado:

```powershell
npm.cmd ci
npm.cmd run build
```

Encerre o processo anterior do Urbana e inicie novamente com `npm.cmd start`. O servidor precisa reiniciar para carregar as novas regras e aplicar as migrations; recompilar a interface não atualiza um backend que já está em execução. Depois, atualize a página e confira login, módulos e operação.

As migrations **1–13** ficam em arquivos numerados em `server/migrations/` e são verificadas na inicialização (a numeração precisa ser contínua; migrations já publicadas não são editadas, novas são aditivas). A migration **8** inicializa as liberações individuais de módulos dos usuários existentes; a **9** registra as tabelas de progresso e eventos do onboarding; a **10** acrescenta `evidence.captured_at` (hora de captura das evidências em campo); a **11** cria `login_attempts`, onde fica o limite de tentativas de login; a **12** cria as tabelas de obras e intervenções (e **não** libera o módulo `works` a nenhum usuário existente); a **13** cria as tabelas do portal do cidadão (desligado por padrão). Liberações comuns não são redefinidas a cada login ou reinício. A conta master mantém sua exceção permanente.

Sem `DATABASE_URL`, os registros ficam em `data/urban.sqlite`; anexos em `data/uploads` e PDFs de notas em `data/invoices`. Não remova esses dados ao atualizar. Trocar `DATABASE_URL` não transfere registros nem arquivos automaticamente. `npm run backup` gera uma cópia consistente do banco e dos arquivos (SQLite online; PostgreSQL exige `pg_dump` compatível com o servidor). Consulte [backup, atualização e restauração](docs/DEPLOYMENT.md).

Clientes de API fora do navegador (scripts, `curl`, app nativo) precisam enviar, nas requisições que alteram dados, o cabeçalho `Origin` igual ao `Host` **ou** `X-Urbana-Client: <nome>` (cliente sem `Origin`, como o app `urbana-campo`); sem um dos dois a API responde 403 `ORIGIN_REQUIRED`. Veja a [API](docs/API.md).

> **Aviso de implantação:** publique a versão do app `urbana-campo` que envia `X-Urbana-Client` **antes** de colocar este backend em produção; instalações antigas do app recebem 403 `ORIGIN_REQUIRED` em toda mutação, inclusive no login. Detalhes em [Implantação](docs/DEPLOYMENT.md#clientes-nativos-e-o-app-urbana-campo).

**Mudanças incompatíveis da API** nesta versão (painel só com agregados, planejamento só com planos abertos, `/api/campo` de gestão só com OS abertas, 404 para caminho desconhecido em `/api`): ver o [Changelog](docs/CHANGELOG.md#2026-11-12--segunda-rodada). Quem consome a API fora da interface precisa se adaptar.

## Autorização e conta master

Somente Administradores podem criar usuários, alterar perfis e gerenciar módulos. O módulo **Obras e intervenções** (`works`) é liberado por usuário: Administrador e Gestor escrevem, Fiscalização e Consulta leem. Existe ainda o perfil técnico `Sistema`, só do usuário que registra as demandas do portal do cidadão, que não faz login ([Autorização](docs/AUTORIZACAO.md)). Para contas comuns, o perfil define as ações permitidas e os módulos liberados definem as áreas acessíveis. Liberar um módulo não concede poderes de outro perfil. O menu, as rotas diretas e a API aplicam essas regras.

A conta **`admin@urbana.local`**, com perfil Administrador, é o **acesso master de manutenção**:

- Todos os módulos do catálogo ficam permanentemente disponíveis, incluindo `/campo` e novos módulos adicionados ao catálogo.
- A conta pode executar as ações desses módulos, mantendo autenticação, auditoria e todas as validações operacionais.
- Remover liberações persistidas não retira seu acesso; ao salvar a conta, todos os módulos são mantidos.
- E-mail e perfil são protegidos na gestão de usuários; os módulos aparecem marcados e bloqueados para remoção.

Essa é a exceção às restrições comuns. Outros Administradores não executam OS em Campo; `/campo` e execução são exclusivos da Equipe de Campo para as demais contas. Consulta permanece somente leitura para dados operacionais, podendo salvar seu próprio progresso de treinamento.

Usuários comuns sem módulos recebem **Sem módulos disponíveis**, com orientação para procurar o Administrador. Não há tour automático nesse estado. A [documentação de autorização](docs/AUTORIZACAO.md) contém a matriz, os contratos e as regras de persistência.

## Onboarding e Ajuda

No primeiro acesso à versão atual do treinamento, o Urbana apresenta nome, perfil, fluxo geral e responsabilidade do usuário. O percurso usa até seis etapas nas telas reais, explicando o que conferir, qual ação faz o trabalho avançar, para quem ele segue e como tratar exceções.

| Perfil          | Processo ensinado                                                    |
| --------------- | -------------------------------------------------------------------- |
| Administrador   | Configurar, estruturar, criar usuários, liberar acessos e acompanhar |
| Gestor          | Priorizar, programar, distribuir, acompanhar e resolver exceções     |
| Triagem         | Receber, analisar, classificar e encaminhar                          |
| Equipe de Campo | Receber, assumir, chegar, executar, registrar e enviar               |
| Fiscalização    | Receber, conferir informações/evidências, validar ou reabrir         |
| Consulta        | Pesquisar, localizar, consultar e acompanhar                         |

**Ajuda → Como usar o Urbana** permite repetir o percurso ou abrir um tutorial individual. O conteúdo considera perfil, módulos e ações autorizadas. O treinamento não cria registros, altera OS ou envia evidências para avançar; sem registro aplicável, explica a área vazia correspondente.

O progresso fica em `user_onboarding`, por usuário, versão e tutorial. A versão atual é **1**: é possível pular, retomar e concluir. Pular não significa concluir; repetir preserva a primeira conclusão. Eventos internos ficam em `onboarding_events`, sem serviço externo de analytics e sem tornar a telemetria obrigatória.

A interface é carregada sob demanda. No celular, o tutorial usa cartão inferior com controles visíveis e espaço para a ação destacada. Há navegação por teclado, controle e restauração de foco, Escape, rótulos acessíveis e respeito a movimento reduzido. Veja [arquitetura, persistência, arquivos e testes do onboarding](docs/ONBOARDING.md).

## Experimentar a operação

1. Registre uma ocorrência com localização, origem, categoria e foto.
2. Conclua a triagem e programe uma OS com equipe do mesmo setor.
3. Abra `/campo` com operador autorizado; assuma a tarefa, registre chegada e foto anterior quando exigida, e inicie o serviço.
4. Informe materiais/equipamentos exigidos, foto posterior e relato; envie para análise.
5. Como gestão/fiscalização, confira o resultado e valide ou reabra com motivo.

Exemplos em etapas avançadas não incluem fotos reais. Crie um registro novo para verificar o ciclo completo. Planejamento, Kanban e almoxarifado complementam esse fluxo.

## Obras e intervenções

Módulo opcional `/obras` (migration 12): intervenções (trecho, área ou ativo, com geometria desenhada no mapa, período previsto, responsável e situação) e obras que as reúnem, com vínculos opcionais a ocorrências e OS e aviso (não bloqueio) de conflito de local e prazo entre intervenções. Uma manutenção simples continua sem obra nem intervenção, e vincular não altera ocorrência nem OS. Administrador e Gestor cadastram; Fiscalização e Consulta leem; **a migration não libera o módulo a usuários existentes**, então o Administrador o concede em Administração. Escopo P1 parcial: **não há** trechos de via, associação espacial automática, documentos, cronograma, custos, medições nem fiscalização de obra, e as escolhas de modelo aguardam validação da gestão municipal. Veja [ADR-024](docs/DECISIONS.md), a [API](docs/API.md#obras-e-intervenções) e o [contexto mestre](docs/URBANA-CONTEXTO-MESTRE.md#obras-e-intervenções--implementado-p1-parcial).

## Portal do cidadão

Registro público de demandas (`/portal`) e acompanhamento por protocolo e código (`/portal/acompanhar`), sem login (migration 13). **Vem desligado**: o Administrador o liga em Administração > Configurações, e `URBANA_PUBLIC_PORTAL=off` o desliga à força, com precedência sobre a configuração (desligado, `/api/publico/*` e as páginas respondem 404). A demanda entra como ocorrência a triar, registrada por um usuário técnico que não faz login; o cidadão recebe um protocolo e um código de acompanhamento (mostrado uma única vez; só o hash é guardado) e vê apenas seis etapas públicas, nunca dados pessoais, endereço, fotos ou o motivo interno de uma recusa. Contra abuso há limites por IP e globais, campo isca e tempo mínimo de preenchimento (padrões: 10 registros por hora por IP, 30 consultas a cada 15 minutos por IP, 30 demandas por hora no total).

**Riscos e pendências antes de ligar em produção:** não há CAPTCHA (um robô que troque de IP pode esgotar o teto global e bloquear cidadãos por até uma hora); o hash de IP é só pseudonimização; o **texto de consentimento (LGPD) padrão precisa de revisão jurídica**; a localização é obrigatória; não houve teste com leitor de tela, em aparelho físico nem atrás de Caddy/HTTPS real. Não há notificação por e-mail, SMS ou WhatsApp. Veja [ADR-025](docs/DECISIONS.md), a [API](docs/API.md#portal-do-cidadão-rotas-públicas) e a [operação](docs/DEPLOYMENT.md#portal-do-cidadão).

## Antimalware opcional

Os uploads (evidências, PDFs de nota fiscal e a foto do portal) podem ser verificados por um ClamAV (`clamd`). Desligado sem `CLAMAV_HOST`. Para ligar com o Compose: `CLAMAV_HOST=clamav` e `docker compose --profile antimalware up -d` (o `clamd` leva alguns minutos para baixar as assinaturas na primeira subida). Arquivo infectado: 422 `MALWARE_DETECTED`; `clamd` indisponível: 503 `SCAN_UNAVAILABLE` no modo `closed` (padrão) ou arquivo aceito com aviso no log em `CLAMAV_FAIL_MODE=open`. Variáveis `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `CLAMAV_FAIL_MODE` e `CLAMAV_STREAM_MAX_BYTES` em [.env.example](.env.example); detalhes e limites em [Implantação](docs/DEPLOYMENT.md#antimalware-opcional-clamav) e [ADR-027](docs/DECISIONS.md).

## Mapas e uso móvel

O mapa Leaflet usa **OpenStreetMap por padrão**, com atribuição dos colaboradores. URL, atribuição e zoom do provider podem ser configurados antes do build. A grade local sem cartografia exige configuração explícita de `VITE_MAP_TILE_URL=/map-development-tile.svg`. Consulte [configuração e diagnóstico dos tiles](docs/MAP-TILES.md).

GPS/mapa e endereço manual localizam registros; não há integração ArcGIS. GPS e câmera dependem de permissão do dispositivo. Web Push exige configuração e validação real do aparelho conforme [Implantação](docs/DEPLOYMENT.md). Se o mapa-base não for o OpenStreetMap, `VITE_MAP_TILE_URL` precisa estar definida também quando o servidor executa, porque a política de segurança de conteúdo libera apenas esse endereço para imagens.

### Campo sem rede

`/campo` abre sem rede depois de usado uma vez com conexão e trabalha com os dados guardados no aparelho (IndexedDB `urbana-field`, separado por usuário). Sem rede, o próprio app abre o Campo a partir da **sessão salva** quando `/api/bootstrap` não responde (o service worker não toca em `/api`; ver [ADR-020](docs/DECISIONS.md)):

- **Leitura:** a lista de tarefas e o detalhe das ordens ativas são guardados a cada atualização com rede; sem rede, o app mostra a última cópia e a hora em que ela foi salva. O service worker (`v4`) guarda o HTML e os arquivos do build; nenhuma resposta de `/api` vai para o Cache Storage.
- **Ações:** assumir, iniciar (chegada com GPS), concluir, devolver, material, equipamento e fotos podem ser feitos sem rede. O app aplica no aparelho as mesmas exigências do servidor (foto antes/depois, material, relato, motivo), mostra o estado otimista e lista as ações no painel **Pendências de envio**. Cada ação leva `request_id` e `captured_at` (hora real do trabalho).
- **Envio:** ao reconectar, ao voltar ao app, a cada 15 segundos, em **Enviar agora** e por Background Sync nos navegadores que o têm. Falha de rede ou erro 5xx repete com espera crescente; 401 pausa a fila e pede novo login; outro erro 4xx deixa a ação **rejeitada**, com o motivo, e o operador escolhe reenviar ou descartar (só as ações seguintes da mesma OS esperam).
- **Sessão:** ao voltar a rede, ao voltar à tela e a cada 15 s o app revalida; 401 marca a sessão como expirada e pausa a fila. **Logout** (inclusive o da gestão) apaga a sessão offline e o cache de OS do usuário; a fila e os rascunhos permanecem no aparelho.

Limitações reais: login e a primeira abertura exigem rede; **registrar uma nova ocorrência continua exigindo rede** (o rascunho é guardado e o reenvio é manual); o cenário previsto e testado é o da Equipe de Campo; fotos de até 15 MB ficam no IndexedDB sem compressão; o iOS não tem Background Sync (o envio acontece com o app aberto) e pode apagar os dados do site após cerca de sete dias sem uso se o app não estiver instalado na Tela de Início; limpar os dados do navegador apaga a fila e os rascunhos. **Verificado apenas em Chrome headless (Playwright) e em testes unitários da fila; nada foi testado em aparelho real nem em Edge**, e a troca do service worker `v3` para o `v4` num aparelho que já tinha o `v3` não foi observada. O app móvel `urbana-campo` é um repositório à parte.

## Testes

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
# Testes de navegador: precisam do build atualizado e de um navegador Chromium.
npm.cmd run test:browser
```

`npm test` roda `tests/*.test.js` (API, regras, persistência, segurança, fila offline, backup, obras, portal, antimalware): **184 testes, dos quais 179 passam sem configuração e 5 exigem PostgreSQL** (`URBANA_POSTGRES_TEST_URL`). `npm run test:browser` roda em sequência as **doze** suítes de navegador, que também podem ser chamadas uma a uma:

| Script               | Cobertura                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `test:ui`            | Fluxo geral em desktop e celular (`tests/browser.mjs`)                                     |
| `test:field`         | Campo em celular: rascunho, reenvio sem duplicação, atribuição, revisão                    |
| `test:field-offline` | Ciclo completo de uma OS sem rede e sincronização ao reconectar                            |
| `test:kanban`        | Quadro, WIP, filtros e movimentação                                                        |
| `test:map`           | Mapa, mapa de calor e visão territorial                                                    |
| `test:authorization` | Módulos, perfis e conta master                                                             |
| `test:onboarding`    | Onboarding e Ajuda nos seis perfis                                                         |
| `test:sector`        | Controle do setor                                                                          |
| `test:p0`            | Paginação, filtros e listas do checkpoint P0                                               |
| `test:works`         | Obras e intervenções: listas, formulários, editor de geometria, conflitos e camada no mapa |
| `test:portal`        | Portal do cidadão: registro, acompanhamento, portal desligado e limites                    |
| `test:a11y`          | Auditoria automatizada de acessibilidade (axe), ver abaixo; leva cerca de 3 min 15 s       |

Os scripts de navegador usam o Microsoft Edge por padrão; **o Edge deixou de ser obrigatório**: defina `URBANA_BROWSER_CHANNEL=chrome` (ou `chromium`) para usar outro navegador, por exemplo `$env:URBANA_BROWSER_CHANNEL = "chrome"` no PowerShell ou `URBANA_BROWSER_CHANNEL=chrome npm run test:browser` no Linux/macOS. Outros comandos: `npm run lint` (ESLint), `npm run format` / `npm run format:check` (Prettier; o CI roda o `format:check`), `npm run backup` e `npm run uploads:cleanup` (ver [Implantação](docs/DEPLOYMENT.md)).

Testes de API/regras e scripts de navegador usam bancos temporários isolados. Os scripts de navegador servem a aplicação compilada e salvam capturas em `test-results/`. Testes de mapa usam tiles simulados, sem baixar tiles reais do OpenStreetMap. Os testes de PostgreSQL/PostGIS só rodam com `URBANA_POSTGRES_TEST_URL` apontando para um banco isolado de testes (ver [Implantação](docs/DEPLOYMENT.md)).

A cobertura inclui autenticação, módulos, perfis, conta master, ciclo operacional, evidências, auditoria, rollback, idempotência, planejamento, notas/estoque, setor, Kanban, onboarding, fila offline do Campo, cabeçalhos de segurança, `/healthz`, logs, backup, limpeza de uploads, contratos agregados, obras e intervenções, portal do cidadão e antimalware (com um `clamd` falso; o script manual `tests/clamav-integration.mjs` testa um `clamd` real). O treinamento é verificado nos seis perfis, em mobile, com retomada, repetição, ausência de módulos/tarefas/alvos e preservação dos dados operacionais.

### Acessibilidade automatizada

`npm run test:a11y` (`tests/a11y-browser.mjs`) percorre 110 estados de tela (55 em cada viewport, 1440x900 e 390x844) da gestão, do Campo e do portal, com modais, erros, estados vazios e portal desligado, e roda o axe (`@axe-core/playwright`) com as regras WCAG 2.1 A/AA e boas práticas; a suíte **falha** em violação `serious` ou `critical`. Complementa com teclado (ordem, foco visível, armadilhas, Escape), alvos de toque de 24 px, reflow a 320 px, zoom de texto a 200% e `prefers-reduced-motion`. Os relatórios ficam em `test-results/a11y-report.json` e `a11y-targets.json`. Resultado da última execução registrada: 0 violações (eram 2.381 nós, 2.260 de contraste), sem regra desativada nem exceção.

**Isto não é certificação WCAG.** O axe decide só parte dos critérios (250 nós ficaram "incompletos", sobretudo no mapa). Continuam pendentes e **sem verificação**: leitor de tela real (NVDA, VoiceOver), aparelhos físicos, contraste de elementos não textuais, espaçamento de texto, orientação e teste com pessoas. Marcadores do mapa de 16 px ficam abaixo de 24 px em agrupamento denso, e o texto de 10 px em `.text-button` merece revisão. A suíte rodou só em Chrome headless no macOS.

### Integração contínua

`.github/workflows/ci.yml` roda a cada `push` e `pull_request`, em `ubuntu-latest` com Node 24 e um serviço `postgis/postgis:17-3.5`: `npm ci`, ativação do PostGIS no banco de testes, `npm run lint`, **`npm run format:check`** (entrou na segunda rodada, depois de o repositório ser formatado com `npm run format`), `npm test` (inclui os testes de PostgreSQL) e `npm run build`. Os testes de navegador, inclusive `test:a11y`, ficam fora do CI por ora. **O workflow ainda não foi executado no GitHub**; o fluxo com PostgreSQL foi reproduzido localmente com um container e passou.

### Estado da verificação (2026-11-12, fim da segunda rodada)

- `npm test`: **184 testes; 179 aprovados, nenhuma falha e 5 não executados** (sem `URBANA_POSTGRES_TEST_URL`: dois em `tests/postgres.test.js` e um em cada um de `tests/query-equivalence.test.js`, `tests/works.test.js` e `tests/portal.test.js`). `npm run lint`: **sem erros e 546 avisos** (453 de `no-explicit-any`); as regras com violações existentes foram rebaixadas para aviso, não desligadas. `npm run format:check`: limpo. São 13 migrations.
- PostgreSQL/PostGIS: a suíte completa foi executada contra um container local (`compose.local.yaml`, imagem `postgis/postgis:17-3.5`) durante as tarefas; o registro da R6 relata **184 de 184**, e essa execução **não foi repetida** na revisão desta documentação. Os testes de API só rodam sobre SQLite; no PostgreSQL rodam `tests/postgres.test.js`, um teste de `works` e um de `portal`, `tests/query-equivalence.test.js` e um teste de fumaça HTTP.
- Testes de navegador: as doze suítes passaram em **Chrome** (não em Edge), em modo headless pelo Playwright, segundo os registros das tarefas; esta atualização alterou só a documentação e não as reexecutou.
- A verificação foi feita em **Node 22.20.0**, não na 24 exigida pelo projeto; `Dockerfile` e CI usam Node 24.

**Não verificado, em nenhuma tarefa:** o workflow no **GitHub Actions** real; **aparelho físico** (Campo offline, app móvel, portal, acessibilidade); o **Edge**; a **imagem Docker** do app em produção (não foi construída); **Caddy real e HTTPS** (cabeçalhos, `TRUST_PROXY`, limites do portal, cookie `Secure` no app nativo); **Node 24**; leitor de tela; carga municipal e benchmark de volume em PostgreSQL; duas instâncias reais (foi simulado com duas pools no mesmo processo); restauração de um `pg_dump` e `pg_dump` do host (só validado dentro do container do banco); Web Push real; troca do service worker `v3` para `v4` num aparelho que já tinha o `v3`.

**Pendências e limitações conhecidas:** o Kanban ainda leva cerca de 3,7 s para desenhar 12 mil cartões abertos; `GET /api/mapa/ocorrencias` segue sem paginação; o antimalware roda dentro da fila serial de escritas (um `clamd` travado segura as escritas por até 10 s); o portal do cidadão não tem CAPTCHA e o texto de consentimento (LGPD) precisa de revisão jurídica; as escolhas de modelo de obras e intervenções e os recortes dos contratos agregados aguardam validação; `URBANA_ALLOW_INSECURE_DEMO` foi mantida no `compose.local.yaml` por decisão desta rodada, a revisar; a auditoria de acessibilidade é automatizada e não substitui avaliação humana. Detalhes e demais limites estão no [contexto mestre](docs/URBANA-CONTEXTO-MESTRE.md#pendências-em-aberto-2026-11-12) e no [Changelog](docs/CHANGELOG.md).

**App móvel (`urbana-campo`, repositório à parte):** o ajuste R10a (cabeçalho `X-Urbana-Client`, tratamento de `ORIGIN_REQUIRED`/`ORIGIN_FORBIDDEN`, `MALWARE_DETECTED` e `SCAN_UNAVAILABLE`, equipamento idempotente com `request_id` e `captured_at`) está na branch `chore/compat-servidor-novo` daquele repositório, sem commit e sem teste em aparelho. O app precisa ser publicado antes do backend novo.

## Documentação

- [Contexto mestre: domínio, fluxos, arquitetura e roadmap](docs/URBANA-CONTEXTO-MESTRE.md)
- [Autorização, matriz de módulos e conta master](docs/AUTORIZACAO.md)
- [Onboarding e treinamento por perfil](docs/ONBOARDING.md)
- [API REST](docs/API.md)
- [Implantação, migrations, backup e restauração](docs/DEPLOYMENT.md)
- [Mapas e provider de tiles](docs/MAP-TILES.md)
- [Changelog](docs/CHANGELOG.md)
- [Decisões arquiteturais](docs/DECISIONS.md)
- [Registro das tarefas de melhoria (T1–T11, R1–R10)](docs/TAREFAS-MELHORIAS.md)

O contexto mestre distingue funcionalidades implementadas, parciais e planejadas. Use-o como referência antes de alterar o domínio ou a arquitetura.
