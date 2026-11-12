# Decisões arquiteturais e de produto — Urbana

ADRs simplificados, consolidados em 2026-10-02; ADR-016 a ADR-023 registradas em 2026-11-12, a partir da série de melhorias técnicas, e ADR-024 a ADR-028 também em 2026-11-12, a partir da segunda rodada. O [contexto mestre](URBANA-CONTEXTO-MESTRE.md) descreve o funcionamento atual. Uma decisão aceita orienta a evolução, mas não comprova sua implementação; o campo **Aplicação atual** explicita essa diferença. Alterações destas decisões exigem novo ADR, com justificativa e relação com o anterior.

## ADR-001 — Arquitetura modular

**Status:** Aceita. **Decisão:** manter um monólito modular; não migrar para microserviços sem decisão arquitetural explícita.

**Motivo:** menor complexidade operacional, transações locais importantes e domínio ainda em evolução. Modularização incremental é suficiente para o estágio atual.

**Aplicação atual:** um processo Express e interface React com módulos extraídos; `server/app.js` e `src/main.tsx` ainda concentram responsabilidades. Diretórios `modules/` são uma organização alvo, não a estrutura existente.

**Atualização 2026-11-12:** `server/app.js` tinha 79 linhas ao fim da T8 (173 na segunda rodada, depois do Prettier e da inclusão do portal) e só compõe; a infraestrutura está em `server/http/` e as rotas em `server/routes/`; `src/main.tsx` tinha 326 linhas (712 depois do Prettier) e as telas estão em `src/modules/<área>/`. Ainda concentram responsabilidades `src/modules/detail/Detail.tsx` (900 linhas), `src/Operator.tsx` e os módulos antigos de `server/`.

## ADR-002 — Ocorrência e OS são conceitos diferentes

**Status:** Aceita. **Decisão:** `Occurrence != Order`. Ocorrência é problema, demanda ou necessidade identificada; OS é execução planejada para tratar uma ou mais ocorrências. Não fundir entidades.

**Motivo:** preservar a decisão de atendimento separada da execução, evidências, recursos e validação.

**Aplicação atual:** tabelas separadas e relação N:N; a ocorrência vinculada recebe uma projeção do estado da OS. A projeção não cria transições diretas de execução na ocorrência.

## ADR-003 — Plano, intervenção e obra são diferentes

**Status:** Aceita. **Decisão:** plano de ação é agrupamento/plano operacional; intervenção será conjunto estruturado de serviços em trecho, área ou ativo; obra será projeto municipal de infraestrutura de maior nível. Não converter automaticamente os planos existentes em obras.

**Motivo:** manutenção simples deve continuar independente de uma obra; vínculos futuros são opcionais.

**Aplicação atual:** planos implementados; intervenção e obra como entidades próprias são planejadas para P1. A palavra “intervenção” em textos operacionais existentes não comprova essas entidades.

**Atualização 2026-11-12:** intervenção e obra existem como entidades próprias, opcionais, na primeira parte do P1 (migration 12, módulo `works`); plano, intervenção e obra continuam três conceitos separados, sem conversão automática. Ver ADR-024.

## ADR-004 — PostgreSQL / PostGIS

**Status:** Aceita. **Decisão:** SQLite para desenvolvimento, testes ou instalação simples controlada; PostgreSQL/PostGIS como banco recomendado para produção municipal.

**Motivo:** necessidades de consultas espaciais, operação e crescimento; trocar configuração de banco não é migração de dados.

**Aplicação atual:** dois adaptadores; PostGIS cria geometria de ponto e índice. Homologação real pendente; o Compose entregue utiliza SQLite em instância única.

**Atualização 2026-11-12:** o adaptador PostgreSQL usa pool com transação por cliente (ver ADR-016) e a suíte completa já rodou contra PostgreSQL/PostGIS em container local; continuam pendentes carga, imagem Docker, Caddy real e instâncias reais múltiplas. O `compose.yaml` segue com SQLite.

## ADR-005 — Dados geográficos

**Status:** Aceita. **Decisão:** utilizar geometria estruturada nos recursos territoriais; endereço textual não deve ser o único identificador territorial. Priorizar `road_segment`, `geometry`, GeoJSON e PostGIS onde aplicável.

**Motivo:** grafias, cruzamentos e nomes de ruas não identificam com segurança um trecho físico.

**Aplicação atual:** coordenadas de ocorrências, GeoJSON de pontos e `geom` no PostgreSQL. Agrupamento de planejamento ainda é textual; segmentos viários e geometrias de obras/intervenções são P1.

**Atualização 2026-11-12:** intervenções têm geometria estruturada (GeoJSON `Point`, `LineString`, `Polygon` ou `MultiLineString`, com caixa envolvente e, no PostgreSQL, coluna `geom` gerada com índice GiST); segmentos viários e associação espacial automática de ocorrências continuam planejados. Ver ADR-024.

## ADR-006 — Providers externos

**Status:** Aceita como diretriz de evolução. **Decisão:** acessar Waze, Google, OSRM, storage, notificações e outros fornecedores por interfaces/providers, como `MobilityProvider`, `RoutingProvider` e `FileStorage`. Não introduzir chamadas diretas de fornecedores em componentes React ou regras de domínio.

**Motivo:** troca de fornecedores, testes isolados e credenciais restritas ao backend.

**Aplicação atual:** Leaflet acessa os mosaicos OSM no navegador; push está em `server/field.js`; uploads usam disco/Multer. As interfaces gerais ainda não existem. A decisão não descreve uma abstração já entregue nem exige reescrita nesta consolidação.

## ADR-007 — Dados de mobilidade

**Status:** Aceita para módulos futuros. **Decisão:** distinguir `REAL_TIME`, `HISTORICAL`, `ESTIMATED` e `SIMULATED`, incluindo origem, coleta e confiança quando disponível. Dados simulados nunca podem aparecer como reais.

**Motivo:** impedir interpretação de demonstração ou estimativa como medição real.

**Aplicação atual:** dados demonstrativos identificados; módulo de mobilidade e contrato desses tipos ainda são P2.

## ADR-008 — Auditoria

**Status:** Aceita. **Decisão:** alterações relevantes permanecem auditáveis, registrando quando aplicável usuário, data/hora, entidade, evento, valor anterior e novo. Não implementar edição ou exclusão silenciosa de histórico.

**Motivo:** responsabilidade e rastreabilidade das decisões e execução.

**Aplicação atual:** `audit_logs`, histórico por entidade e consulta administrativa dos últimos 300 eventos. Pesquisa paginada e novos domínios ainda são roadmap.

## ADR-009 — Optimistic locking

**Status:** Aceita; implementação geral planejada em P0. **Decisão:** entidades críticas utilizam ou utilizarão `version`, com comparação na gravação; conflito retorna `409 Conflict` e não sobrescreve silenciosamente.

**Motivo:** fila serial no processo não protege a intenção de duas pessoas com telas antigas nem múltiplas instâncias.

**Aplicação atual:** ocorrências, OS e planos não possuem `version`. Kanban usa `revision` na configuração/ordenação e pode validar `kanban_expected_status` nas ações; são controles parciais, não locking geral.

## ADR-010 — Mobile / campo

**Status:** Aceita. **Decisão:** considerar conectividade instável; envios repetíveis devem usar `request_id` ou estratégia equivalente de idempotência.

**Motivo:** reconexão e resposta perdida não podem duplicar registros ou fotos.

**Aplicação atual:** UUID de requisição em criação de ocorrência e anexos, associado ao usuário; rascunhos IndexedDB e reenvio manual. Não há idempotência universal, cache offline de OS ou sincronização automática.

**Atualização 2026-11-12:** o ciclo da OS no Campo agora tem cache local e fila com sincronização automática, com `request_id` e `captured_at` em todas as ações (ver ADR-019 e ADR-020); registrar nova ocorrência continua com rascunho e reenvio manual.

## ADR-011 — Segurança

**Status:** Aceita. **Decisão:** validar permissões sempre no backend; esconder botão não é controle de acesso.

**Motivo:** API e anexos precisam proteger dados independentemente da interface.

**Aplicação atual:** seis perfis e autorização por ação no servidor, com restrição adicional de equipe/operador. Scripts e componentes de permissões individuais ainda não estão integrados ao servidor vigente.

**Atualização 2026-11-12:** acrescentam-se, também no servidor, CSP estrita, exigência de `Origin` nas mutações, limite de login persistido e recusa de credenciais de demonstração em produção pública (ver ADR-017 e ADR-018 e a seção 3 do contexto mestre). Na segunda rodada, a exigência de `Origin` ganhou a identificação de clientes nativos por `X-Urbana-Client` (ADR-026) e os uploads ganharam a verificação antimalware opcional (ADR-027).

## ADR-012 — Compatibilidade

**Status:** Aceita. **Decisão:** novas migrations serão aditivas, versionadas e compatíveis com instalações existentes. Não editar migration antiga para representar alteração futura.

**Motivo:** atualização segura sem perda de dados ou mudanças retroativas de significado.

**Aplicação atual:** versões 1–4 em `server/db.js` e esquema base em `server/schema.sql`; 2–4 são transacionais e registradas após sucesso. Não há diretório `migrations/` nem ferramenta de downgrade. Numerações futuras devem ser confirmadas contra o código antes de implementar.

**Atualização 2026-11-12:** as migrations 1–13 são arquivos `server/migrations/NNN-nome.js` com executor em `server/db.js`, que exige numeração contínua; 1 e 9 são repetíveis. A migration 11 é `login_attempts`, a 12 cria obras e intervenções (ADR-024) e a 13, o portal do cidadão (ADR-025); as duas últimas são aditivas e não alteram tabela existente. Continua sem ferramenta de downgrade.

## ADR-013 — Versão obrigatória em edições operacionais

Status: Aceita e aplicada ao checkpoint de concorrência, complementa ADR-009. Classificação/recusa, transições/programação da OS exigem version da leitura; erro 428 quando ausente e 409 VERSION_CONFLICT quando divergente. Escrita usa WHERE id/version e incrementa no mesmo comando; falha reverte a transação e auditoria. Planos recebem version para evolução, sem inventar edição inexistente. Anexos/consumo/equipamentos são adições, preservando idempotência e regras; locking distribuído de WIP/estoque/numeração não está homologado.

## ADR-014 — Storage injetável e arquivos compensados

Status: Aceita e implementada. Complementa ADR-006/008/012, cujo campo Aplicação atual descreve o baseline anterior à revisão. FileStorage usa chaves uploads/ e invoices/ preservadas; default local, object adapter injetável com SDK real a configurar posteriormente. Uploads limitados em memória; assinatura/autorização antes do save. Falhas transacionais limpam arquivos salvos; queda abrupta pode exigir reconciliação. PDF.js deve destruir o loading task em finally, conforme API da versão instalada. Sem serviço externo ativado.

## ADR-015 — Paginação incremental e carregamento por área

Status: Aceita e implementada parcialmente. Complementa ADR-001/009/012 (baseline anterior à revisão). Cursor estável created_at/id, filtros SQL e envelope opt-in para compatibilidade; listas UI paginadas. Consumidores operacionais amplos permanecem explicitamente pendentes para não truncar métricas/cartões. React.lazy/Suspense por área e mapa extraído reduzem entry JS a 318,01 kB. Migrations atuais 1–7; testes reais PostgreSQL/PostGIS preparados e não executados. P0 permanece parcial.

## ADR-016 — Fila serial de escrita mantida, mesmo com pool no PostgreSQL

**Status:** Aceita e implementada (2026-11-12). Complementa ADR-009 e ADR-013. **Decisão:** manter a fila serial de escritas por processo. O PostgreSQL passa a usar um pool e cada transação de escrita usa um cliente dedicado (`db.transaction(fn)`), mas as escritas continuam uma por vez dentro do processo.

**Motivo:** WIP do Kanban, numeração de códigos e saldo de estoque são verificados por leitura seguida de escrita, o que só é seguro com uma escrita por vez enquanto não houver lock distribuído.

**Consequências:** leituras `GET`/`HEAD` saem da fila no PostgreSQL e leem em `READ COMMITTED` (uma resposta com várias consultas pode enxergar um commit entre elas); no SQLite tudo permanece na fila. Continua valendo **um único processo de escrita**; trocar o banco ou subir réplicas não resolve isso. O pool usa o padrão de 10 conexões, sem configuração. A evolução exige um mecanismo de lock distribuído ou a reescrita dessas regras; não feito.

## ADR-017 — CSP estrita, sem `unsafe-inline`

**Status:** Aceita e implementada (2026-11-12). **Decisão:** em produção, `script-src` e `style-src` aceitam só `'self'` (mais o Google Fonts para folhas de estilo e fontes); sem `unsafe-inline`. A política só é afrouxada no servidor de desenvolvimento (Vite), de forma explícita.

**Motivo:** reduzir o impacto de uma injeção de HTML/script numa aplicação autenticada que manipula dados de municípios.

**Consequências:** `public/offline.html` teve o estilo movido para `public/offline.css`; estilos ou scripts inline novos deixam de funcionar em produção; o host dos tiles é liberado em `img-src` a partir de `VITE_MAP_TILE_URL`, que por isso precisa ser definida também em tempo de execução (e igual à do build). Verificado em seis testes de navegador em Chrome headless, sem violação; não verificado em Edge nem com HTTPS/Caddy real.

## ADR-018 — Limite de tentativas de login no banco

**Status:** Aceita e implementada (2026-11-12). **Decisão:** guardar o contador de falhas de login na tabela `login_attempts` (migration 11), com a política anterior: 10 falhas por IP em 15 minutos, janela aberta na primeira falha, zerada em caso de sucesso.

**Motivo:** o contador em memória se perdia a cada reinício e não era compartilhado entre instâncias.

**Consequências:** o limite sobrevive a reinícios e vale entre instâncias que usam o mesmo banco; janelas vencidas são apagadas a cada tentativa. Atrás de proxy depende de `TRUST_PROXY` (`1` no `compose.yaml`) para enxergar o IP real; sem ele, todos os clientes pareceriam o mesmo.

## ADR-019 — Fila offline no cliente com `request_id`

**Status:** Aceita e implementada (2026-11-12); verificada só em Chrome headless. Complementa ADR-010. **Decisão:** a operação offline do Campo é uma fila de ações (`outbox`, IndexedDB `urbana-field` versão 2) em que cada ação leva `request_id` estável e `captured_at`; o servidor continua sendo a fonte de verdade, aplica as regras e rejeita explicitamente o que não vale. O app valida localmente as mesmas exigências, mostra estado otimista e sincroniza em ordem por OS.

**Motivo:** reconexão e resposta perdida não podem duplicar registros; a hora real do trabalho precisa chegar ao servidor.

**Consequências:** a API passou a aceitar `request_id`/`captured_at` também no lançamento de equipamento; o Background Sync é só complemento (o iOS não o tem), o envio principal acontece com o app aberto; uma ação rejeitada com 4xx é mostrada ao operador (reenviar ou descartar) e só bloqueia as seguintes da mesma OS; nenhuma resposta de `/api` vai para o Cache Storage. Limites: registrar ocorrência nova continua com rascunho e reenvio manual; fotos de até 15 MB ficam no IndexedDB sem compressão; sem conflito entre aparelhos além da rejeição pelo servidor; nada testado em aparelho real.

## ADR-020 — Boot offline do Campo no app; service worker fora de `/api`

**Status:** Aceita e implementada (2026-11-12). Substitui a decisão provisória anterior, em que o service worker respondia `GET /api/bootstrap` sem rede. **Decisão:** a inicialização offline é feita pelo próprio app. Em `src/modules/workspace/useWorkspaceData.ts`, quando `/api/bootstrap` não alcança o servidor (sem resposta, tempo esgotado ou 502/503/504) e a rota é `/campo`, o app lê sob demanda a sessão de Campo salva no IndexedDB (store `session`) e abre o Campo com ela, marcada como `offline`. O service worker não trata mais nenhuma requisição de `/api` (nem lê o IndexedDB); a versão do cache passou para `v4`.

**Regras:** 401 na inicialização leva ao login e apaga a sessão salva; o logout do Campo e o da gestão também a apagam antes de chamar o servidor. Fora de `/campo` ou sem sessão salva, vale o comportamento anterior (login com erro de conexão). Com a sessão salva em uso, o app revalida ao voltar a rede, ao voltar para a tela e a cada 15 s: o bootstrap real substitui o salvo; 401 marca a sessão como expirada e o Campo pede novo login, com a fila pausada como na sincronização. Um perfil de gestão abre `/campo` sem rede; a área de gestão mostra "Sem conexão com o servidor" com opção de voltar ao Campo, em vez do login. O tutorial (onboarding) não abre com a sessão salva.

**Motivo:** manter o service worker sem nenhuma exceção em `/api` e concentrar a regra de sessão no app, onde 401, logout e revalidação já são tratados.

**Consequências:** a leitura do IndexedDB fica num chunk carregado sob demanda; o chunk de entrada cresceu cerca de 2,3 kB (0,8 kB gzip). Clientes com o service worker anterior trocam para `v4` na próxima abertura com rede.

## ADR-021 — Varredura de uploads órfãos desligada por padrão

**Status:** Aceita e implementada (2026-11-12). **Decisão:** a remoção de arquivos sem referência no banco existe como comando (`npm run uploads:cleanup`, com `--dry-run`) e como agendamento no processo, mas o agendamento só liga com `UPLOAD_SWEEP_INTERVAL_HOURS` positivo.

**Motivo:** apagar arquivos é irreversível; a varredura erra para o lado de não apagar: carência de 24 h (um upload grava o arquivo antes de o banco confirmar), recusa quando o banco não tem nenhuma referência de arquivo (provável `DATABASE_URL`/`DATA_DIR` errado) e nenhuma ação no storage de objetos, que não lista arquivos.

**Consequências:** sem a configuração, arquivos órfãos de quedas abruptas se acumulam; a operação decide quando ligar, de preferência depois de um `--dry-run`. Nova tabela que guarde nome de arquivo precisa entrar em `server/modules/files/orphans.js`.

## ADR-022 — Regras de lint com violações existentes rebaixadas para aviso

**Status:** Aceita (2026-11-12). **Decisão:** as regras do ESLint que o código existente viola (por exemplo `no-explicit-any`, regras de `react-hooks`, `no-unused-vars`, `no-empty`) foram **rebaixadas de erro para aviso**, não desligadas; as que já passam continuam como erro. Ao zerar uma regra, ela volta a `error`.

**Motivo:** ter um lint que falha em regressões sem exigir a correção em massa de código existente.

**Estado:** `npm run lint` termina sem erros e com 546 avisos (453 de `no-explicit-any`, 29 de `react-hooks/exhaustive-deps`, 22 de `react-hooks/set-state-in-effect`) ao fim da segunda rodada; eram 504 ao fim da primeira, e o aumento vem do código novo (obras, portal, testes). O CI roda o lint, mas ele ainda não foi executado no GitHub.

## ADR-023 — `format:check` no CI; testes de navegador fora do CI por enquanto

**Status:** Aceita, parte superada em 2026-11-12 (segunda rodada); a parte dos testes de navegador continua a revisar. **Decisão original (primeira série):** o workflow de CI rodava lint, `npm test` (com PostgreSQL/PostGIS) e build, sem `format:check` nem testes de navegador. **Atualização:** o repositório foi formatado com `npm run format` (188 arquivos fora do padrão antes, 0 depois) e o passo "Formatação" (`npm run format:check`) entrou no CI logo depois do lint; `docs/TAREFAS-MELHORIAS.md`, registro mantido à mão, está no `.prettierignore`. Os testes de navegador (doze suítes, `npm run test:browser`, inclusive `test:a11y`) continuam **fora** do CI.

**Motivo (testes de navegador):** dependiam do Edge e não tinham sido validados em runner Linux; desde a T10 o navegador é escolhido por `URBANA_BROWSER_CHANNEL` e as suítes rodam em Chrome, mas a execução em runner Linux continua não verificada, e a suíte de acessibilidade leva cerca de 3 min 15 s.

**Revisão:** avaliar a entrada dos testes de navegador no CI depois da primeira execução real do workflow, que ainda não aconteceu. A formatação em commit próprio evita misturar 106 arquivos reformatados com a revisão das mudanças funcionais.

## ADR-024 — Obras e intervenções: entidades próprias, opcionais e sem efeito sobre ocorrência e OS

**Status:** Aceita e implementada (2026-11-12), no escopo P1 parcial; **as escolhas de modelo abaixo foram tomadas na implementação e precisam de validação com a gestão municipal.** Detalha o ADR-003. **Decisão:** obra (`projects`, código `OB-AAAA-NNNNN`) e intervenção (`interventions`, código `INT-AAAA-NNNNN`) são tabelas novas (migration 12, aditiva), com módulo e ação próprios, `works` ("Obras e intervenções", `/obras`). Uma manutenção simples continua sem obra nem intervenção: nenhuma tabela, resposta ou regra de ocorrência e OS mudou, e vincular, desvincular, editar, mudar a situação ou excluir uma obra ou intervenção não altera situação, `version` nem histórico dos registros vinculados.

**Escolhas de modelo:**

- **Vínculos:** intervenção e ocorrência, e intervenção e OS, são N:N (a mesma OS pode estar em várias intervenções); cada intervenção e cada OS pertence diretamente a **no máximo uma obra**. Uma obra não tem geometria própria: a extensão é a caixa das suas intervenções.
- **Situações:** máquina própria, igual para intervenção e obra (`PLANEJADA`, `EM_ANDAMENTO`, `PARALISADA`, `CONCLUIDA`, `CANCELADA`), sem reutilizar os estados de OS. Paralisar, cancelar e reabrir exigem motivo; a obra só conclui com todas as intervenções concluídas ou canceladas; a exclusão só vale em `PLANEJADA`; edição e transição exigem `version`.
- **Geometria:** GeoJSON validado (`Point`, `LineString`, `Polygon`, `MultiLineString`, até 1000 pontos) guardado como texto com caixa envolvente; no PostgreSQL, uma coluna `geom` gerada com índice GiST serve de pré-filtro. O teste espacial exato roda em JavaScript (`shared/geometry.mjs`, projeção local, adequada à escala municipal).
- **Conflito:** duas intervenções ativas conflitam quando os períodos **previstos** se sobrepõem e as geometrias se tocam ou ficam a até **15 m** (configurável por consulta, 0–200). É **aviso, não bloqueio**: salvar sempre é possível e a pessoa pode registrar uma avaliação do conflito, que é descartada se geometria ou período mudarem.
- **Permissões:** Administrador e Gestor escrevem; Fiscalização e Consulta, com o módulo liberado, leem. A migration **não** libera o módulo a nenhum usuário existente (só a conta master o recebe); o Administrador libera por usuário. O item de menu fica no nível principal.

**Motivo:** o P1 do contexto mestre pede entidades opcionais que não tornem a obra obrigatória para a manutenção simples, com geometria e detecção de conflito, sem antecipar o P2.

**Consequências:** a ocorrência e a OS não mostram as intervenções a que pertencem (ainda não existe esse vínculo na tela de detalhe delas); o mapa territorial ganhou uma camada de intervenções, carregada sob demanda. **Fora desta entrega (P1):** trechos de via e associação espacial automática, documentos da obra, capacidade estimada e WIP por setor/equipe, vínculo a ativos, intervenções no detalhe da ocorrência/OS. **Não tocado (P2):** cronograma, custos, medições, fiscalização de obra, interdições, impacto viário. Contrato em [API](API.md#obras-e-intervenções).

## ADR-025 — Portal do cidadão: registro e acompanhamento públicos, desligados por padrão

**Status:** Aceita e implementada (2026-11-12); **portal desligado por padrão e não recomendado em produção antes da revisão jurídica do texto de consentimento.** **Decisão:** um registro público de demanda e um acompanhamento por protocolo, sem sessão, em `/api/publico/*` e nas páginas `/portal` e `/portal/acompanhar` (migration 13, aditiva). **Sem canal externo de notificação** (e-mail, SMS e WhatsApp ficam para depois): o cidadão acompanha pelo protocolo e por um código.

**Escolhas:**

- **Desligamento:** a configuração `portal` (Administração > Configurações) começa com `enabled: false`; `URBANA_PUBLIC_PORTAL=off` no servidor vence a configuração (interruptor de implantação, por exemplo para uma instância só interna ou sob abuso). Desligado, tudo sob `/api/publico` responde 404 sem ler o corpo nem gravar nada.
- **Entrada no fluxo:** a demanda vira ocorrência `IDENTIFICADA`, prioridade inicial `Média`, setor padrão da categoria, origem "Portal do cidadão", para a triagem tratar como qualquer outra. O ator é um **usuário de sistema** (`system-portal-cidadao`, perfil `Sistema`), que existe só pelas chaves estrangeiras de auditoria e evidência: senha inválida, login recusado, ausente da lista de usuários e sem módulos. Duplicidade nunca é respondida ao cidadão; fica em `public_portal.possible_duplicates` para a triagem. O portal **não respeita o limite de WIP do Kanban** (o teto por hora protege a triagem).
- **Código de acompanhamento:** 16 caracteres (cerca de 79 bits), mostrado uma vez; só o SHA-256 é guardado. Número inexistente, código errado e demanda que não veio do portal respondem igual (404 `TRACKING_NOT_FOUND`), com comparação em tempo constante.
- **O que o cidadão vê:** protocolo, categoria, bairro e seis etapas públicas (Recebida, Em análise, Programada, Em execução, Concluída, Não atendida); `AGUARDANDO_VALIDACAO` aparece como "Em execução". Nunca aparecem nome, telefone, descrição, endereço, coordenadas, fotos, equipe, OS, notas, motivo interno nem outras demandas. A recusa ganhou `public_reason` opcional (`fora_competencia`, `ja_registrada`, `informacao_insuficiente`, `nao_procede`), com texto fixo; sem ele, mostra-se um texto padrão.
- **Contra abuso:** 10 criações por hora por IP, 30 consultas a cada 15 minutos por IP, teto global de 30 demandas aceitas por hora, campo isca, tempo mínimo de 5 s entre abrir e enviar (token de formulário assinado com HMAC) e fila própria de, no máximo, 2 uploads públicos simultâneos. Os números são configuráveis. **Não há CAPTCHA.** Os contadores usam o SHA-256 truncado do IP, sempre com expiração.
- **Dados do cidadão:** localização obrigatória; nome e telefone opcionais, só internos; consentimento obrigatório e registrado (data e hash do texto aceito); foto opcional (JPG, PNG ou WebP), reduzida no navegador, o que remove o EXIF, e verificada pelo antimalware quando ligado.

**Riscos que continuam:** (1) sem CAPTCHA, um robô que troque de IP pode esgotar o teto global e bloquear cidadãos por até uma hora; (2) o hash de IPv4 é **pseudonimização**, não anonimização (o espaço de endereços é pequeno e reversível por força bruta); (3) o **texto de consentimento padrão (LGPD) precisa de revisão jurídica** antes de ligar o portal, assim como o prazo de retenção, que o texto não define; (4) quem não tem GPS e não consegue usar o mapa não envia a demanda; (5) atrás de proxy, os limites por IP só funcionam com `TRUST_PROXY` (sem ele, todos os cidadãos pareceriam um único IP); (6) não testado com leitor de tela, em aparelho físico nem atrás de Caddy/HTTPS real. Contrato em [API](API.md#portal-do-cidadão-rotas-públicas); operação em [DEPLOYMENT](DEPLOYMENT.md#portal-do-cidadão).

## ADR-026 — Cliente nativo sem `Origin` identificado por `X-Urbana-Client`

**Status:** Aceita e implementada (2026-11-12). Complementa ADR-017 e a regra de `Origin` do ADR-011. **Decisão:** uma mutação sem `Origin` e sem `Sec-Fetch-Site` é aceita **somente** com o cabeçalho `X-Urbana-Client: <nome>` (1 a 64 caracteres `A-Z a-z 0-9 . _ / -`, começando por letra ou dígito, por exemplo `urbana-campo/1.0.0`). Com `Origin` ou `Sec-Fetch-Site` presentes, o cabeçalho é ignorado e valem as regras de antes; sem nenhum dos três, 403 `ORIGIN_REQUIRED`.

**Motivo:** o app móvel `urbana-campo` usa axios nativo, que não envia `Origin`; com a regra da primeira série, todas as mutações dele, inclusive o login, seriam recusadas. Um navegador não envia cabeçalho customizado a outro site sem preflight CORS, e o servidor não habilita CORS, então o cabeçalho não reabre o risco de CSRF.

**Consequências:** o valor não é segredo nem autenticação (qualquer script pode enviá-lo); serve para não confundir "cliente nativo" com "navegador que omitiu a origem". Clientes antigos do app recebem 403 `ORIGIN_REQUIRED` até serem atualizados: **publicar o app com o cabeçalho antes do backend novo.** Não há lista de nomes permitidos nem versão mínima. O cookie `SameSite=Strict`/`Secure` no armazenamento nativo atrás de HTTPS real não foi verificado.

## ADR-027 — Antimalware opcional com ClamAV; falha fechada por padrão

**Status:** Aceita e implementada (2026-11-12); verificada com `clamd` real em container emulado (amd64). **Decisão:** os uploads (evidência, PDF de nota fiscal e foto do portal) podem passar por um `clamd` por TCP, sem dependência nova de npm (`server/modules/files/clamav.js`, protocolo `INSTREAM`). **Desligado sem `CLAMAV_HOST`**; com ele, a verificação vem depois das checagens baratas e antes de qualquer gravação. Arquivo infectado: 422 `MALWARE_DETECTED`, nada salvo, evento de auditoria sem o nome da assinatura (que vai só para o log). `clamd` inacessível, lento ou com resposta inesperada: **modo `closed` (padrão)** recusa o upload com 503 `SCAN_UNAVAILABLE`; modo `open` aceita o arquivo e registra um aviso.

**Motivo:** a infraestrutura de antimalware depende do município (P4 da lista de tarefas não delegadas); uma integração opcional não obriga ninguém a operar o `clamd` e falhar fechado evita que uma queda do antivírus vire um canal para arquivos sem análise.

**Consequências:** o scan roda dentro da fila serial de escritas, então um `clamd` travado segura as escritas até o tempo limite (`CLAMAV_TIMEOUT_MS`, 10 s por padrão); arquivos acima do limite de stream do `clamd` (`CLAMAV_STREAM_MAX_BYTES`, 25 MB por padrão, acima do limite de upload de 15 MB) recebem 503; `/healthz` não depende do `clamd`; o `compose.yaml` traz o serviço `clamav` no profile `antimalware`, que baixa as assinaturas na primeira subida (alguns minutos). O app móvel trata 422 como erro definitivo e 503 como tentável. Não é uma defesa completa: só o que o `clamd` reconhece é barrado, e arquivos já salvos antes de ligar o recurso não são reanalisados.

## ADR-028 — Contratos agregados e recortes explícitos nas consultas amplas

**Status:** Aceita e implementada (2026-11-12); **as decisões de produto abaixo foram tomadas na implementação e precisam de revisão.** Resolve as quatro propostas que a T7 deixou por mudarem contrato. **Decisão:** a interface de gestão deixa de baixar listas completas: `GET /api/dashboard` devolve só agregados calculados no banco (com `?tz=`), e passam a existir `GET /api/ocorrencias/resumo`, `GET /api/ordens-servico/resumo`, `GET /api/kanban/cartoes` e `GET /api/planejamento/encerrados`; `GET /api/planejamento` traz só os planos abertos e `GET /api/campo` de gestão, só as OS abertas. A Equipe de Campo não muda (resposta idêntica byte a byte, contrato do app móvel).

**Recortes escolhidos:** o Kanban mostra as Concluídas dos últimos 30 dias por padrão (seletor de período) e uma coluna recortada não pode ser reordenada, porque a reordenação exige todos os cartões da etapa; planos encerrados em páginas de 20, dos mais recentes para os mais antigos; a aba de histórico do `/campo` de gestão mostra só OS abertas; o mapa de "Nova ocorrência" mostra só as ocorrências em andamento; `byNeighborhood` e `byCategory` saíram do painel.

**Motivo:** com 40 mil ocorrências, cada carga de gestão baixava dezenas de MB a cada 15 s (a Visão geral passou de 1.520 ms e 78,6 MB para 120 ms e 12,4 KB).

**Consequências:** mudança incompatível, registrada no [Changelog](CHANGELOG.md); a equivalência dos números do painel está provada em `tests/query-equivalence.test.js`. **Pendente:** o Kanban ainda leva cerca de 3,7 s para desenhar 12 mil cartões abertos e `GET /api/mapa/ocorrencias` segue sem paginação.
