# Urbana — Contexto mestre do sistema

> Este documento é a fonte canônica de contexto funcional,
> de domínio e de arquitetura do Urbana.
>
> Em caso de divergência com documentação histórica,
> este documento prevalece.
>
> [API.md](API.md) permanece como referência técnica dos contratos HTTP.
>
> [DEPLOYMENT.md](DEPLOYMENT.md) permanece como referência operacional de implantação.
>
> [CHANGELOG.md](CHANGELOG.md) registra a evolução histórica.
>
> [DECISIONS.md](DECISIONS.md) registra decisões arquiteturais e de produto.

Consolidado e verificado contra o código em **2026-10-02** e revisado duas vezes em **2026-11-12**: na primeira série (migrations 10–11, modularização, segurança de borda, operação, consultas amplas e offline do Campo; [Checkpoint técnico — 2026-11-12](#checkpoint-técnico--2026-11-12)) e na segunda rodada (migrations 12–13, obras e intervenções, portal do cidadão, antimalware, contratos agregados, cliente nativo e acessibilidade; [Checkpoint técnico — segunda rodada](#checkpoint-técnico--segunda-rodada-2026-11-12), com as pendências em [Pendências em aberto](#pendências-em-aberto-2026-11-12)). O código e os testes determinam o que existe; este documento define o modelo conceitual oficial. Divergências devem ser investigadas e registradas, sem mudar regras de negócio para corresponder a textos antigos. **IMPLEMENTADO**, **PARCIAL** e **PLANEJADO** distinguem entrega, limitações e especificação futura.

## 1. Produto, princípios e modelo de domínio

**Status: IMPLEMENTADO.** Urbana é uma aplicação web de gestão de manutenção municipal, com foco operacional em manutenção viária. Liga registro, análise, programação, execução e validação. A gestão acompanha demandas, equipes, prazos, recursos e resultados; campo recebe tarefas, captura GPS/fotos, registra execução e impedimentos. Balneário Camboriú é referência geográfica do seed, não uma operação municipal real.

Princípios: rastreabilidade; transações críticas; responsabilidade e próxima ação claras; servidor como fonte de verdade; Kanban e painéis como representações do processo; evolução incremental; acessibilidade sem depender de cor, arraste ou mouse. Dados reais, históricos, estimados e simulados devem ser distinguidos; fornecedores externos não devem determinar o domínio.

| Conceito              | Definição                                                                                                                           | Status                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ocorrência            | Problema, demanda ou necessidade identificada no território                                                                         | IMPLEMENTADO                                                                                    |
| Ordem de serviço (OS) | Atendimento planejado de uma ou mais ocorrências, com estado, equipe, prioridade, prazo e recursos próprios                         | IMPLEMENTADO                                                                                    |
| Plano de ação (PA)    | Agrupamento operacional de demandas da mesma via/bairro/setor                                                                       | IMPLEMENTADO                                                                                    |
| Intervenção           | Conjunto estruturado de serviços num trecho, área ou ativo, com geometria, período, responsável, prioridade e vínculos opcionais    | IMPLEMENTADO — P1                                                                               |
| Obra                  | Projeto municipal de infraestrutura que poderá reunir intervenções, OS, cronograma, custos, fiscalização, medições e impacto viário | PARCIAL — P1 implementado (identificação, período, responsável, estado, vínculos); P2 planejado |

Não fundir ocorrência e OS nem transformar planos automaticamente em obras. Uma manutenção simples deve continuar independente de obra ou intervenção. Obras e intervenções existem como entidades opcionais desde a segunda rodada (seção [Obras e intervenções](#obras-e-intervenções--implementado-p1-parcial)); usos da palavra “obra” em textos operacionais antigos continuam sendo linguagem corrente, não evidência de vínculo com essas entidades.

## 2. Fluxo, estados e requisitos

**Status: IMPLEMENTADO.** Quatro decisões: analisar demanda → programar atendimento → executar serviço → conferir e encerrar. Planejamento apoia a escolha e o agrupamento, mas não é obrigatório para atender uma ocorrência.

A fonte executável dos estados/transições é `server/domain/workflow.js`. Ocorrência decide entrada no atendimento; OS controla execução. Criar uma OS a partir de demandas triadas projeta PROGRAMADA nas ocorrências; mudanças da OS propagam seus estados. A relação é N:N: ao encerrar uma OS, outra OS ativa vinculada pode manter o estado ativo da ocorrência.

| Código               | Significado e exibição                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| IDENTIFICADA         | Demanda recebida: “A analisar”; Kanban: “Identificadas”                           |
| EM_TRIAGEM           | Classificação concluída: “Pronta para programar”; Kanban ainda exibe “Em triagem” |
| RECUSADA             | Decisão justificada de não atender; antes de OS                                   |
| PROGRAMADA           | OS emitida e atribuída                                                            |
| EM_DESLOCAMENTO      | Equipe a caminho                                                                  |
| EM_EXECUCAO          | Serviço iniciado                                                                  |
| AGUARDANDO_VALIDACAO | Relato enviado, pendente de conferência                                           |
| DEVOLVIDA            | Impedimento justificado; gestão deve reprogramar                                  |
| CONCLUIDA            | Resultado validado                                                                |
| CANCELADA            | OS interrompida com justificativa                                                 |

Transições diretas da ocorrência: IDENTIFICADA → EM_TRIAGEM ou RECUSADA; EM_TRIAGEM → EM_TRIAGEM (complementar/corrigir classificação) ou RECUSADA. RECUSADA não tem saída operacional. Não existe transição direta de execução da ocorrência.

Transições da OS:

| Origem               | Destinos permitidos                                |
| -------------------- | -------------------------------------------------- |
| PROGRAMADA           | EM_DESLOCAMENTO, EM_EXECUCAO, DEVOLVIDA, CANCELADA |
| EM_DESLOCAMENTO      | EM_EXECUCAO, DEVOLVIDA, CANCELADA                  |
| EM_EXECUCAO          | AGUARDANDO_VALIDACAO, DEVOLVIDA, CANCELADA         |
| AGUARDANDO_VALIDACAO | CONCLUIDA, EM_EXECUCAO (reabertura)                |
| DEVOLVIDA            | PROGRAMADA                                         |
| CONCLUIDA            | EM_EXECUCAO (reabertura)                           |
| CANCELADA            | Nenhum                                             |

### Registro e decisão de atendimento

Registro inclui categoria/subcategoria, prioridade, origem, descrição, coordenadas, endereço, bairro e referência; solicitante/telefone são opcionais. GPS, seleção no mapa ou coordenadas e endereço manuais são aceitos. O servidor verifica proximidade no raio configurado: a pessoa confirma uma nova ocorrência ou vincula a solicitação à existente. Duplicatas vinculadas não são novas ocorrências físicas; concluídas próximas podem indicar reincidência. Recusadas/canceladas não são candidatas ativas a duplicidade.

Triagem define categoria, subcategoria, prioridade e setor. Pode guardar a análise e programar depois; gestores podem enviar triagem e emissão individual juntas, com rollback se a programação falhar. Recusa exige motivo e registra usuário/data/histórico; retira a demanda de filas ativas, planejamento e sugestões de duplicidade, mantém consulta dos anexos e bloqueia novos envios. Não apaga nem reaproveita silenciosamente a demanda. Para demandas vindas do portal do cidadão, a recusa aceita ainda um `public_reason` opcional (`fora_competencia`, `ja_registrada`, `informacao_insuficiente`, `nao_procede`), cujo texto fixo é o único motivo mostrado ao cidadão; o motivo interno nunca é exposto.

### Programação, SLA e distribuição

Categoria fornece setor padrão e SLA em horas por prioridade: Emergencial, Alta, Média, Baixa, Programada. Triagem pode escolher outro setor válido. Ocorrências de uma OS e sua equipe devem pertencer ao mesmo setor; operador designado deve ser usuário de campo daquela equipe. Responsável textual e operador designado são campos diferentes. Usuário de campo tem uma equipe; equipe tem responsável e quantidade de integrantes, sem agenda completa de membros.

Prazo conta desde identificação, nunca desde emissão/reprogramação. OS agrupada usa o menor prazo dos membros, considerando a prioridade elevada pelo plano quando aplicável. Data de programação não substitui SLA. Ordens já existentes não têm prazo/prioridade recalculados pela simples criação posterior de plano.

Distribuição pode ser para a equipe ou um operador. OS sem operador é compartilhada pela equipe; com operador é acessível ao designado no perfil de campo. Programação só muda em PROGRAMADA ou DEVOLVIDA; reprogramação pode mudar equipe/operador do mesmo setor, preserva prazo e criação inicial e reinicia os campos do ciclo de execução. A própria OS é excluída do contexto de carga na redistribuição.

### Execução, evidências e conferência

Assumir inicia deslocamento; iniciar exige coordenadas de chegada e imagem antes quando requerida pela categoria. Concluir exige relato, imagem depois do ciclo corrente e material quando requerido; envia para AGUARDANDO_VALIDACAO, sem encerrar diretamente. Gestão/fiscalização valida ou reabre com motivo. Devolução exige justificativa, bloqueia execução/novos anexos até reprogramar; cancelamento e reabertura também exigem justificativa.

Evidências: JPG, PNG, WebP, PDF ou MP4, até 15 MB; etapas registro, antes, durante, depois, documento; autor, data, etapa e coordenadas quando fornecidas. Fotos obrigatórias devem ser imagens. Início verifica foto anterior desde criação/reprogramação; conclusão verifica foto posterior desde o marco mais recente de criação, início, reabertura ou reprogramação. Material obrigatório verifica existência de consumo na OS, sem regra de novo consumo por ciclo. Não presumir que todo requisito de material se reinicia na reabertura.

## 3. Perfis, autorização e segurança

**Status: IMPLEMENTADO.** Seis perfis vigentes definidos em `server/domain.js`:

| Ação                                                 | Administrador   | Gestor          | Triagem         | Campo                                  | Fiscalização    | Consulta        |
| ---------------------------------------------------- | --------------- | --------------- | --------------- | -------------------------------------- | --------------- | --------------- |
| Consultar ocorrências/mapa                           | Módulo liberado | Módulo liberado | Módulo liberado | Registros próprios e tarefas em /campo | Módulo liberado | Módulo liberado |
| Registrar ocorrência                                 | Sim             | Sim             | Sim             | Sim                                    | Sim             | Não             |
| Classificar/recusar                                  | Sim             | Sim             | Sim             | Não                                    | Não             | Não             |
| Programar/cancelar OS, plano, almoxarifado/notas     | Sim             | Sim             | Não             | Não                                    | Não             | Não             |
| Executar OS                                          | Não             | Não             | Não             | Equipe/operador autorizado             | Não             | Não             |
| Validar/reabrir                                      | Sim             | Sim             | Não             | Não                                    | Sim             | Não             |
| Cadastros, usuários, configuração e auditoria global | Sim             | Não             | Não             | Não                                    | Não             | Não             |

Reordenação do Kanban: administrador, gestor, triagem e fiscalização; limites WIP: administrador/gestor. Campo registra ocorrências, mas anexos de ocorrência são restritos aos registros próprios; anexos de OS dependem de autorização à ordem. Listas gerais de ocorrências são consultáveis pelos perfis; restrição de equipe/operador se aplica às OS, suas ações/anexos e projeções autorizadas em painel, planejamento e push.

**Status: IMPLEMENTADO.** Perfil × módulos individuais persistidos × ações funcionais. Somente usuários com perfil Administrador podem criar usuários, alterar perfis e gerenciar liberações de módulos. O acesso a módulos não concede poderes adicionais ao perfil. O ambiente `/campo` é exclusivo do perfil Equipe de Campo, inclusive para execução de OS; gestores e administradores não entram nesse ambiente. Catálogo/matriz/ações em `shared/authorization.mjs`; migração 8 em `server/migrations/008-user-modules.js`. Administração possui criação e edição de usuários/módulos, com auditoria. Não executar antigos scripts de transformação de permissões funcionais no deploy. Consulte [Autorização](AUTORIZACAO.md) para matriz, regras de migração e endpoints.

Senhas: scrypt com salt aleatório e comparação em tempo constante. Sessão: oito horas, cookie urban_session HttpOnly e SameSite estrito, token armazenado como hash. Uploads têm nomes aleatórios, limite de tipo/tamanho e assinatura básica; a análise antimalware é **opcional** (ClamAV, desligada por padrão; ver o item abaixo) e, desligada, não existe. Anexos exigem autenticação/autorização. Produção e credenciais estão detalhadas em [Implantação](DEPLOYMENT.md).

Endurecimento de borda (**IMPLEMENTADO**, `server/security.js`, `server/login-limit.js`; verificado por testes automatizados e, no navegador, só em Chrome headless):

- **Limite de login:** 10 falhas por IP em 15 minutos, contadas na tabela `login_attempts` (migration 11): sobrevive a reinícios e é compartilhado entre instâncias que usam o mesmo banco. Atrás do proxy depende de `TRUST_PROXY` (Compose: `1`, o Caddy).
- **Origem das mutações:** `POST`/`PATCH`/`PUT`/`DELETE` exigem `Origin` igual ao `Host` ou `Sec-Fetch-Site: same-origin`; senão 403 `ORIGIN_FORBIDDEN` ou `ORIGIN_REQUIRED`. Antes, a ausência de `Origin` era aceita; agora clientes fora do navegador precisam enviar `Origin` igual ao `Host` **ou** o cabeçalho `X-Urbana-Client` (segunda rodada; é o que o app móvel `urbana-campo` usa, ver [ADR-026](DECISIONS.md) e [API](API.md)). **Implantação:** o app precisa ser publicado com o cabeçalho antes do backend novo, ou instalações antigas recebem 403 `ORIGIN_REQUIRED` em toda mutação.
- **Cabeçalhos:** CSP estrita em produção, **sem `unsafe-inline`** em scripts e estilos (a página `offline.html` teve o estilo movido para `offline.css`), `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` e, com `SECURE_COOKIE=true`, HSTS de um ano (sem `includeSubDomains`) e `upgrade-insecure-requests`. Em desenvolvimento a CSP é afrouxada para o Vite. O host dos tiles é liberado em `img-src` a partir de `VITE_MAP_TILE_URL`, que por isso precisa existir também na execução. Seis testes de navegador em Chrome não registraram violação de CSP; **não foi testado em Edge, com HTTPS/Caddy real nem em aparelho**.
- **Produção recusa demonstração:** com `--production`, servidor alcançável fora do computador (`HOST` fora de loopback ou `SECURE_COOKIE=true`) não sobe com `DEMO_DATA` ligado, `ADMIN_PASSWORD` de demonstração ou contas na senha `Urbana@2026`. `URBANA_ALLOW_INSECURE_DEMO=true` é a exceção explícita do `compose.local.yaml` (inútil com `SECURE_COOKIE=true`); sua presença nesse arquivo é decisão a confirmar pelo responsável.
- **Borda:** o `Caddyfile` limita o corpo a 20 MB e remove o cabeçalho `Server`.

- **Antimalware opcional (IMPLEMENTADO, desligado por padrão):** com `CLAMAV_HOST`, evidências, PDFs de nota e a foto do portal passam por um `clamd` antes de serem gravadas; infectado: 422 `MALWARE_DETECTED`; `clamd` indisponível: 503 `SCAN_UNAVAILABLE` no modo `closed` (padrão) ou aceita com aviso no modo `open` ([ADR-027](DECISIONS.md), [Implantação](DEPLOYMENT.md#antimalware-opcional-clamav)). Verificado com `clamd` real só em container emulado.
- **Rotas desconhecidas:** um caminho de `/api` que não corresponde a nenhuma rota responde 404 a usuário autenticado (401 ao anônimo); a rota real de um módulo não liberado continua 403. A mensagem "Informe a localização da evidência." do upload passou a aparecer.
- **Portal público:** as rotas `/api/publico/*` não têm sessão nem módulo e ficam desligadas por padrão (seção [Portal do cidadão](#portal-do-cidadão--implementado-desligado-por-padrão)).

## 4. Áreas, interação e indicadores

**Status: IMPLEMENTADO.** Visão geral; Mapa territorial; Ocorrências; Triagem; OS; Kanban; Planejamento; Obras e intervenções; Análise de campo; Controle do setor; Equipes; Materiais/almoxarifado; Equipamentos; Campo; Administração. Fora do login, o Portal do cidadão (`/portal`), desligado por padrão. Menu recolhível: Ocorrências agrupa registros, triagem, OS e análise; Operações agrupa setor e recursos/campo. Áreas principais têm acesso direto; administração é restrita.

Triagem alterna A analisar / Prontas para programar, com contagens. Decisão e programação não ocupam simultaneamente o formulário; voltar preserva campos. Consulta de equipes/planejamento é opcional na programação. Guia de andamento indica próxima ação, responsável e requisitos. Confirmação de gravação é separada de falha de atualização nos fluxos tratados; resultado de rede ambíguo orienta conferir antes de repetir. Nem todos os cadastros/planos/notas têm tratamento uniforme; recuperação central de sessão com preservação de formulários ainda é evolução.

Atualização periódica a cada 15 segundos nas telas tratadas, enquanto visíveis, com horário/falha e tentativa manual; não é mecanismo de controle de concorrência.

### Visão geral e contexto de distribuição

Desde a segunda rodada a Visão geral lê só agregados calculados no banco (`GET /api/dashboard`, com o fuso do navegador), e a área de gestão deixou de baixar as listas completas a cada atualização: cada tela busca o que usa ([ADR-028](DECISIONS.md)). Seis indicadores: demandas abertas, OS abertas, equipes em deslocamento/execução, OS vencidas, aguardando validação e OS atualmente concluídas. Painéis de evolução diária, estados abertos, carga por equipe, prioridades e bairros mais concentrados. Seleção 14/30/90 dias altera somente o gráfico: entradas são ocorrências criadas; saídas são OS atualmente concluídas na data de validação. Unidades diferentes não formam taxa de resolução; reabertas saem da série. Não há série imutável de todas as validações.

Contexto de distribuição mostra OS abertas, chamados distintos, deslocamento/execução, programação, validações, devoluções, prazos e compromissos por data, além de vias/planos do setor. Equipe precisa ser escolhida explicitamente. “Sem operação” significa ausência de registros; compromissos na mesma data são alerta para revisão, não bloqueio nem capacidade real. Não considera jornada, férias, turnos, duração ou deslocamentos.

Controle do setor consolida OS por mês de entrada da primeira ocorrência (fallback: criação da OS) e setor. Serviços contam ocorrências por OS, contatos contam um por OS, conclusão depende do estado atual. Códigos inferidos da primeira ocorrência/categoria/descrição: BC, DRE, INF, BU, LI, PO, PA, ASF, CHU, GRE, MF, VOL, OUT; contatos Ouvidoria, Whats, Geral. Não é agenda nem cálculo de capacidade, e uma OS agrupada não implica múltiplos contatos. Os campos dos modelos de OS fornecidos orientaram emissor, solicitante, telefone, referência, recursos e justificativa; exemplos não foram importados como demandas reais e as caixas de prioridade do papel não são convertidas automaticamente.

### Mapa territorial

Leaflet/OpenStreetMap, atribuição visível, internet para mosaicos. Formulários continuam utilizáveis sem mapa-base. Alterna pontos/heatmap com os mesmos filtros e lista acessível; cada ocorrência tem peso igual, sobreposição/zoom alteram intensidade. Heatmap mede concentração, não risco/prioridade. Busca manual de endereço; ArcGIS e busca externa de endereço foram removidos. BC Digital é apenas origem de cadastro. O GeoJSON de ocorrências é de pontos. Quem tem o módulo Obras e intervenções vê também uma camada opcional de intervenções (pontos, linhas e polígonos), carregada sob demanda, com lista textual equivalente; não há camadas de vias, interdições ou mobilidade. `GET /api/mapa/ocorrencias` continua sem paginação.

### Acessibilidade

Foco visível, Enter/Espaço em listas, setas/Home/End em abas de planejamento, modais com foco inicial/retenção/Escape nos fluxos tratados, rótulos e anúncios de status/erro, alternativas de mover por teclado/toque e layout móvel. Nomes de equipes acompanham cores. Kanban pode rolar horizontalmente dentro do quadro; isso não equivale a ausência universal de rolagem. Testes desktop/celular não são certificação WCAG; avaliação com tecnologias assistivas/usuários reais, contraste e observação operacional seguem pendentes. Desde a segunda rodada existe uma auditoria **automatizada** (`npm run test:a11y`, axe com WCAG 2.1 A/AA e boas práticas, mais teclado, alvo de toque de 24 px, reflow a 320 px, zoom de texto a 200% e `prefers-reduced-motion`) sobre 110 estados de tela de gestão, Campo e portal, em Chrome headless: 2.381 nós com violação antes, 0 depois, sem regra desativada nem exceção. Ela **não garante conformidade**: o axe decide só parte dos critérios (250 nós ficaram "incompletos", sobretudo no mapa), e continuam sem avaliação humana o leitor de tela (NVDA, VoiceOver), aparelhos físicos, contraste de elementos não textuais, espaçamento de texto e orientação. Marcadores do mapa (16 px) ficam abaixo de 24 px em agrupamento denso e o texto de 10 px em `.text-button` merece revisão.

## 5. Planejamento e planos de ação

**Status: IMPLEMENTADO.** Ranking por rua normalizada/bairro; candidatos de decisão separados também por setor. Normalização remove acentos, caixa, abreviações R./Av. e números de imóvel após separador explícito, preservando nomes de ruas numeradas. Grafias distintas, cruzamentos e endereços ambíguos exigem revisão humana; não utiliza proximidade para reconhecer equivalência de vias.

Decisão considera urgência, SLA original, idade e volume. Múltiplas demandas sugerem Alta, preservando Emergencial; sugestão não altera prioridade individual. Candidatos excluem reservas em plano e atendimentos com OS. Administrador/gestor cria plano PA com **1–100** demandas IDENTIFICADA/EM_TRIAGEM da mesma rua/bairro e setor, sem plano/OS prévia, objetivo, responsável e data. Uma ocorrência pertence a um único plano; novos registros não são incluídos silenciosamente. Não há edição/cancelamento ou inclusão posterior.

Demandas não triadas podem compor plano, mas precisam ser triadas para OS. Emissão aceita plano existente (ou inferido pelos vínculos); não mistura planos diferentes ou planejadas com não planejadas. Interface/API permitem plano + OS atômicos quando membros estão prontos: falha desfaz plano, reservas, ordem e auditoria da solicitação. Plano acompanha OS e estados dos membros: concluídas, canceladas e recusadas separadamente. O planejamento não implementa obra nem intervenção; essas entidades são separadas (ver [Obras e intervenções](#obras-e-intervenções--implementado-p1-parcial)).

## 6. Kanban compartilhado

**Status: IMPLEMENTADO.** Ocorrência sem OS é cartão de demanda; cada OS representa um item, mesmo com vários chamados. Não há cópia visual por ocorrência vinculada nem máquina de estados paralela. Arraste entre colunas abre confirmação/formulário da ação real, com classificação, programação, localização, evidências, relato ou motivo. Cancelar formulário mantém etapa; falha de atualização após sucesso permite atualizar sem repetir a ação. Fotos/materiais podem ser registrados no detalhe antes de tentar movimentar.

Dentro da coluna, soltar sobre cartão insere antes; espaço livre envia ao fim; seta coloca no topo. Ordem persistida compartilhada, com prioridade/antiguidade para novos cartões. “Mover” oferece alternativa ao arraste e puxador de pontos auxilia no celular. Filtros: setor, equipe/sem equipe, prioridade e busca; encerrados podem ser exibidos. Desde a segunda rodada os cartões vêm de `GET /api/kanban/cartoes`: todos os abertos e, nas colunas encerradas, só as Concluídas dos últimos 30 dias por padrão (seletor de período). Uma coluna recortada não pode ser reordenada (a ordenação exige todos os cartões da etapa); os contadores e o WIP usam sempre o quadro completo. O Kanban ainda leva cerca de 3,7 s para desenhar 12 mil cartões abertos. Busca, carga e regras recolhíveis.

WIP por etapa é **global**, salvo em settings; zero é ilimitado. Administrador/gestor configura 0–999. Servidor bloqueia aumento de ocupação acima do limite em qualquer tela e desfaz mudanças/auditoria/vínculos na transação. Reduzir limite abaixo da ocupação permite esvaziar, mas impede novas entradas; reordenar/atualizar cartão já presente não usa outra vaga. Revisão diária deve observar devoluções, prazos, antiguidade e capacidade sem presumir que limite representa disponibilidade de equipe.

Configuração/ordenação compara revision; conjunto de cartões precisa ser completo e atual. Ações podem conferir kanban_expected_status. Esses controles são complementados por version nas edições de ocorrência/OS; planos também retornam version, sem API de edição. Proteção distribuída de WIP permanece pendente.

| Indicador              | Semântica atual                                                               |
| ---------------------- | ----------------------------------------------------------------------------- |
| OS em andamento        | OS não concluídas/canceladas, incluindo espera, validação e devolução         |
| Entregas em 30 dias    | OS **atualmente CONCLUIDA**, com completed_at nos últimos 30 dias; uma por OS |
| OS mais antiga         | Maior idade desde criação inicial entre OS abertas                            |
| Ciclo médio em 30 dias | Média criação inicial → completed_at das OS atualmente concluídas no período  |

Setor/equipe restringem métricas; busca/prioridade/ocultação de encerradas não mudam seu histórico considerado. Reprogramação preserva criação; recusadas/canceladas não contam entregas, reabertura retira a OS das concluídas. Datas inválidas/ausentes não geram ciclos/idades, ausência de amostra mostra traço. SLA não é previsão estatística. Referência conceitual: [The Kanban Guide](https://kanbanguides.org/the-kanban-guide/2025.5/).

## 7. Materiais, notas fiscais, estoque e custos

**Status: PARCIAL.** Estoque básico já existe: almoxarifado, entradas/saídas manuais auditadas, saldo, custo médio ponderado das entradas, valor de estoque, consumo de 90 dias, média mensal, estoque mínimo e sugestão de compra (consumo de 90 dias + mínimo − saldo, limitado a zero). Não é previsão de demanda nem módulo completo de inventário.

Consumo na OS exige quantidade positiva, preserva custo unitário histórico e, para material com movimentos de estoque, gera saída e bloqueia saldo insuficiente. Equipamentos são vinculados; não há reserva/agenda de equipamentos. Materiais sem controle por movimentos usam cadastro/custo vigente conforme regra do consumo.

PDF de nota até 15 MB é extraído como RASCUNHO para revisão humana; PDF sem texto/sem itens requer preenchimento manual, sem OCR. Confirmação valida fornecedor/número/itens, impede confirmação repetida e duplicata de fornecedor+número, registra compra como entrada e aplicação como saída se vinculadas a material. Quantidade usada não supera comprada; etapas de custo: registro, triagem, execucao, validacao, outros. Extração não confirma estoque automaticamente. PDFs ficam em data/invoices, com acesso autorizado à OS.

Há custo de consumption (quantidade × custo histórico) e custo real de saídas de estoque por OS/etapa; são métricas distintas, não devem ser somadas automaticamente. Aplicação direta de nota gera movimentos e não necessariamente registro em consumption; não presumir que satisfaz exigência de material da conclusão. Não há composição completa de mão de obra, equipamento, veículos, combustível, contratos ou serviços terceiros.

Reservas, devoluções estruturadas, múltiplos almoxarifados, transferências e inventários completos são P2; alertas de saldo e sugestão básica de reposição já existem.

## 8. Campo, offline e notificações

**Status: IMPLEMENTADO / offline do ciclo da OS IMPLEMENTADO e verificado só em Chrome headless; demais cenários PARCIAIS.** /campo possui Tarefas, Registrar, Meus registros; somente perfil Equipe de Campo com módulo Campo liberado entra na interface móvel. GPS/câmera dependem de permissão do dispositivo. “Como chegar” abre app de mapas, sem roteamento próprio.

Armazenamento local: IndexedDB `urbana-field` (versão 2, migração aditiva), tudo separado por usuário, com `drafts` (rascunhos de registro, fotos e relato), `session` (sessão de Campo para abrir sem rede), `cache` (lista de tarefas e detalhe das OS ativas, com a hora em que foram salvos) e `outbox` (fila de ações). Código em `src/field-storage.ts` e `src/modules/field/` (`outbox-model.mjs` com as regras puras, `sync.ts`, `cache.ts`, `useFieldSync.ts`, `SyncStatus.tsx`).

Sem rede, a Equipe de Campo executa todo o ciclo — assumir, iniciar com GPS, fotos, material, equipamento, concluir e devolver — com as mesmas exigências do servidor aplicadas localmente, estado otimista e painel **Pendências de envio**. Cada ação leva `request_id` (idempotência) e `captured_at` (hora real do trabalho, com correção pelo relógio do servidor). A fila sincroniza ao reconectar, ao voltar ao app, a cada 15 s, em **Enviar agora** e por Background Sync quando existe (complemento; o mecanismo principal é o app aberto, inclusive no iOS). Falha de rede ou 5xx: repetição com espera crescente (teto de 5 min); 401: a fila pausa e pede login; outros 4xx: a ação fica **rejeitada** com o motivo e o operador escolhe reenviar ou descartar; só as ações seguintes da mesma OS esperam. A seção “Equipamentos utilizados” da tela de execução foi criada nesse trabalho. O servidor aceita `request_id`/`captured_at` também em equipamento (ver [API](API.md)).

O service worker (`v4`) abre o HTML pela rede primeiro (cópia local após 5 s ou sem rede) e guarda os arquivos com hash do build; **não toca em nenhuma requisição de `/api`**. Sem rede, quem abre o Campo é o próprio app: em `src/modules/workspace/useWorkspaceData.ts`, se `/api/bootstrap` não responde (sem rede, tempo de 15 s ou 502/503/504) e a rota é `/campo`, ele inicia com a sessão gravada no IndexedDB (`session`), revalida ao voltar a rede, ao voltar à tela e a cada 15 s, e trata 401 como sessão expirada, pausando a fila. O logout (do Campo e da gestão) apaga a sessão salva ([ADR-020](DECISIONS.md)). Um perfil de gestão que abre `/campo` sem rede vê o Campo; a área de gestão mostra "Sem conexão com o servidor" em vez do login. A troca do `v3` para o `v4` em aparelho que já tinha o `v3` não foi observada.

Limites reais (**PARCIAL**): login e a primeira abertura exigem rede; **registrar nova ocorrência continua exigindo rede** (rascunho local e reenvio manual, sem fila); o cenário projetado e testado é o da Equipe de Campo; fotos de até 15 MB ficam no IndexedDB sem compressão; iOS não tem Background Sync e pode apagar dados do site após cerca de sete dias sem uso se o app não estiver instalado; limpar os dados do navegador apaga fila e rascunhos; não há resolução de conflitos entre aparelhos além da rejeição pelo servidor. Verificado: build, `tests/field-outbox.test.js` (14 testes da fila) e `tests/field-offline-browser.mjs` (ciclo completo offline em Chrome headless). **Nada foi testado em aparelho real nem em Edge.**

Push opcional: HTTPS, VAPID, compatibilidade e permissão do usuário. Assinaturas por aparelho são removidas no logout. Distribuição/reprogramação e reabertura geram jobs. Worker a cada 15 segundos, até cinco tentativas, verifica atribuição atual e remove assinaturas expiradas; chamada externa ocorre fora da fila serial de banco. Entrega ambígua pode repetir notificação, tag da OS permite substituição. Testes usam serviço simulado; instruções de instalação/aparelho estão em DEPLOYMENT.md.

## 9. Arquitetura e persistência vigentes

**Status: IMPLEMENTADO; modularização PARCIAL.** Monólito modular em evolução, um processo Express; React 19/TypeScript/Vite; Node 24+ (Dockerfile e CI; a verificação de 2026-11-12 rodou em Node 22.20, e o `package.json` não declara `engines`); Leaflet/OSM; SQLite ou PostgreSQL/PostGIS; disco local e Web Push. Não há microserviços. `server/app.js` (173 linhas depois do Prettier e do portal; eram 79 ao fim da T8) só compõe middlewares e rotas; a infraestrutura HTTP está em `server/http/` e as rotas por domínio em `server/routes/`; `src/main.tsx` (712 linhas depois do Prettier; eram 326) compõe o shell e as telas vivem em `src/modules/<área>/`. Persistem arquivos grandes: `src/modules/detail/Detail.tsx` (1.194 linhas), `src/Operator.tsx` (1.867 linhas) e os módulos antigos de `server/` (`planning.js`, `kanban.js`, `field.js`…), que não mudaram de lugar.

| Responsabilidade                 | Código vigente                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface de gestão/integração   | src/main.tsx (composição), src/styles.css; telas em src/modules/{administration,auth,catalogs,detail,field,map,occurrences,orders,planning,review,teams,triage,works,workspace}; portal do cidadão em src/portal (entrada separada, `portal.html`, sem React); estado do shell em src/modules/workspace (hooks); utilitários, tipos e cliente de API em src/shared; onboarding em src/onboarding |
| Painel/fluxo                     | OperationsDashboard, WorkflowGuide, DispatchContext (ainda em src/)                                                                                                                                                                                                                                                                                                                              |
| Planejamento/Kanban              | PlanningPanel, PlanningPlanDialog, TeamKanban, KanbanMoveDialog (ainda em src/); modelos em shared/ e src/*-model.mjs                                                                                                                                                                                                                                                                            |
| Campo, rascunhos e fila offline  | src/Operator.tsx, src/field-storage.ts, src/modules/field/, public/sw.js                                                                                                                                                                                                                                                                                                                         |
| Setor, estoque e notas           | SectorControl, InventoryPanel, InvoicePanel                                                                                                                                                                                                                                                                                                                                                      |
| HTTP: composição                 | server/app.js                                                                                                                                                                                                                                                                                                                                                                                    |
| HTTP: infraestrutura             | server/http/{route,auth,errors,records,schemas}.js (route.js: fila serial, transação, WIP), server/security.js, server/logger.js, server/login-limit.js                                                                                                                                                                                                                                          |
| HTTP: rotas por domínio          | server/routes/{health,auth,bootstrap,occurrences,orders,attachments,catalogs,admin,dashboard,works,portal}.js (110 rotas registradas, 3 delas públicas; a ordem e a marca de escrita de cada uma são fixadas por tests/route-table.test.js)                                                                                                                                                      |
| Estados, permissões, credenciais | server/domain.js, server/domain/workflow.js, server/domain/works.js (situações de obra e intervenção)                                                                                                                                                                                                                                                                                            |
| Módulos operacionais             | server/planning.js, kanban.js, field.js, inventory.js, invoices.js, sector-control.js, onboarding.js, modules/portal/ (configuração, ator de sistema, código de acompanhamento, etapas públicas), shared/geometry.mjs (validação e conflito de geometrias)                                                                                                                                       |
| Persistência/seed                | server/db.js (adaptadores e executor de migrations), server/migrations/, server/schema.sql, server/seed.js                                                                                                                                                                                                                                                                                       |
| Arquivos                         | server/modules/files/{storage,upload-limit,orphans,clamav,upload-scan}.js                                                                                                                                                                                                                                                                                                                        |
| Operação                         | scripts/backup.mjs, scripts/cleanup-orphan-uploads.mjs, /healthz                                                                                                                                                                                                                                                                                                                                 |

users guarda perfil/equipe; sessions guarda hash do token e expiração. catalogs usa discriminador kind e atributos JSON em texto; secretaria/departamento/setor usam parent_id, categorias/equipes sector_id. API verifica tipos/vínculos. occurrences e orders mantêm campos indexáveis e atributos JSON; order_occurrences liga N:N. action_plans/action_plan_occurrences preservam reserva única. evidence é polimórfica por tipo/ID; consumption preserva custos; order_equipment liga recursos; invoices/invoice_items/inventory_movements registram notas/estoque. audit_logs é histórico imutável pela interface, settings configura município/raio/quadro; client_requests/push_subscriptions/push_jobs suportam campo. assets/maintenance_plans são tabelas reservadas sem telas/geração preventiva automática.

Sem DATABASE_URL: SQLite/WAL e data/urban.sqlite; com DATABASE_URL: adaptador PostgreSQL, ponto geom gerado de lng/lat em SRID 4326 e índice GiST. Inicialização requer habilitar PostGIS. Trocar URL não transfere dados. Migrations vigentes **1–13**, em arquivos numerados `server/migrations/NNN-nome.js` (o executor em `server/db.js` exige numeração contínua; 1 e 9 são repetíveis; 10 = `evidence.captured_at`; 11 = `login_attempts`; 12 = obras e intervenções; 13 = portal do cidadão; as duas últimas são aditivas). Detalhes de atualização/backup/restauração em DEPLOYMENT.md.

**SQLite:** uma conexão e fila serial no processo. **PostgreSQL:** pool (padrão de 10 conexões, sem configuração); leituras fora de transação vão ao pool e cada transação de escrita usa um cliente dedicado por `db.transaction(fn)` (`AsyncLocalStorage`), com `pool.on('error')` para não derrubar o processo; `BEGIN`/`COMMIT` avulsos por `db.exec` são recusados nesse dialeto. A **fila serial de escrita foi mantida de propósito** ([ADR-016](DECISIONS.md)): WIP, numeração de códigos e saldo de estoque são lidos e gravados sem lock distribuído, então só são seguros com uma escrita por vez e **um único processo de escrita**. No PostgreSQL, `GET`/`HEAD` saem da fila e leem em `READ COMMITTED`: uma resposta com várias consultas pode enxergar um commit entre elas. O que já é seguro entre instâncias: limite de login (no banco) e entrega de push (reivindicação atômica do job com concessão de 5 min, pelo menos uma vez; testado só com duas pools no mesmo processo). Mutações operacionais com histórico/jobs usam transação. Não equivalem a locking distribuído. Upload ocorre antes do commit; limpeza de erro cobre fluxos tratados, mas falha entre disco e banco pode deixar órfãos. Vínculos polimórficos de arquivo e catálogos dependem de validação API, sem FK específica por tipo. FileStorage local/object injetável integrado aos anexos e notas; arquivos existentes preservados. Homologação real do provider externo pendente. Órfãos: `npm run uploads:cleanup` e a varredura agendada (desligada por padrão, só storage local) removem arquivos sem referência no banco, com carência de 24 h ([ADR-021](DECISIONS.md)). PostgreSQL/PostGIS: a suíte foi executada por inteiro contra um container local (última execução registrada, na R6: 184 de 184; não repetida na revisão desta documentação); isso **não é homologação** — não houve carga, imagem Docker da aplicação, Caddy real nem instâncias reais múltiplas, e as suítes de API só rodam sobre SQLite (no PostgreSQL rodam `postgres.test.js`, `query-equivalence.test.js`, um teste de `works.test.js`, um de `portal.test.js` e um teste de fumaça HTTP).

## 10. APIs e convenções gerais

**Status: IMPLEMENTADO / escalabilidade PARCIAL.** Grupos: autenticação/bootstrap; ocorrências/triagem/duplicidade; OS/execução/evidências; planejamento; Kanban; campo/push; catálogos/admin/auditoria; mapa/painel/controle de setor; almoxarifado/notas; obras e intervenções; portal público. JSON e cookie de sessão; arquivos multipart; validação Zod, autorização no backend, transações e erros estruturados. Detalhes exclusivos em [API](API.md).

Filtros de ocorrência/OS/GeoJSON agora são SQL; ocorrência/OS/auditoria aceitam cursor/limit, e UI de listas usa páginas de 50. Auditoria possui pesquisa paginada. Arrays legados são preservados para consumidores operacionais ainda não migrados; movimentos de estoque possuem consulta paginada e saldos agregados SQL (legacy retorna até 100). Painel, planejamento, Kanban e `/campo` de gestão deixaram de devolver conjuntos amplos na segunda rodada (contratos agregados, [ADR-028](DECISIONS.md)); o mapa (`/api/mapa/ocorrencias`) e `/api/controle-setor` continuam sem paginação, embora o custo interno das consultas tenha sido reduzido (ver os checkpoints de 2026-11-12).

Optimistic locking das edições de ocorrência/OS **IMPLEMENTADO** no checkpoint de 2026-10-02 (migration 5, comparação WHERE id/version, versão obrigatória). Planos recebem version sem API de edição; adições preservam regras próprias. Proteção distribuída de estoque/WIP/numeração permanece pendente. 409 já sinaliza transição/duplicidade/WIP/revision/etapa incompatíveis; não significa que toda entidade protege edição concorrente. Paginação/locking/storage/auditoria pesquisável são P0.

## 11. Estado atual, limitações e prioridades

| Tema                                                    | Status       | Situação                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State machine, fluxo, recusa/devolução, planos e Kanban | IMPLEMENTADO | Regras vigentes acima; obras e intervenções são entidades à parte, sem alterar o fluxo                                                                                                                  |
| Documentação canônica                                   | IMPLEMENTADO | Cinco documentos especializados/contextuais; consolidação registrada no Changelog                                                                                                                       |
| Concorrência                                            | PARCIAL      | version obrigatório nas edições de ocorrência/OS; revision/etapa no quadro; fila serial de escrita mantida por processo; estoque/WIP/numeração entre processos pendentes                                |
| Estoque/custos                                          | PARCIAL      | Notas, movimentos e materiais; gestão completa P2                                                                                                                                                       |
| Offline do Campo                                        | PARCIAL      | Ciclo da OS com fila, cache e boot offline pela sessão salva, verificado só em Chrome headless; registrar ocorrência, login e outros perfis exigem rede; sem aparelho real                              |
| PostgreSQL/PostGIS                                      | PARCIAL      | Adaptador com pool, geom e suíte completa em container local; homologação (carga, imagem Docker, Caddy, instâncias múltiplas reais) pendente                                                            |
| Modularização                                           | PARCIAL      | `server/app.js` com 173 linhas e `src/main.tsx` com 712 (depois do Prettier e do portal); ainda grandes: `Detail.tsx` (1.194), `Operator.tsx` (1.867) e os módulos antigos de `server/`                 |
| Segurança de borda                                      | IMPLEMENTADO | CSP estrita, Origin nas mutações (ou `X-Urbana-Client` para cliente nativo), limite de login persistido, recusa de demonstração em produção, antimalware opcional; verificação só local/Chrome headless |
| Operação                                                | PARCIAL      | `/healthz` com banco, logs com `X-Request-Id`, backup e limpeza de órfãos; restauração de `pg_dump`, imagem Docker e instâncias reais não testados                                                      |
| Consultas amplas                                        | PARCIAL      | Painel, planejamento, Kanban e `/campo` de gestão agora agregados ou recortados (R4); `/api/mapa/ocorrencias` sem paginação e Kanban lento com ~12 mil cartões abertos                                  |
| Integração contínua e estilo                            | PARCIAL      | Workflow de CI (lint, `format:check`, testes com PostgreSQL, build) **nunca executado no GitHub**; repositório formatado; lint sem erros e 546 avisos; testes de navegador fora do CI                   |
| Capacidade/território                                   | PARCIAL      | Carga/WIP/agrupamento textual; jornada/geometria ampliada P1                                                                                                                                            |
| Obras/intervenções/vias/mobilidade                      | PARCIAL      | Obras e intervenções P1 entregues (migration 12); vias, interdições, mobilidade e P2 de obras planejados                                                                                                |
| Portal do cidadão                                       | PARCIAL      | Registro e acompanhamento públicos entregues (migration 13), **desligados por padrão**; sem canal externo de notificação, sem CAPTCHA, texto LGPD a revisar                                             |
| Antimalware nos uploads                                 | PARCIAL      | Integração opcional com ClamAV, desligada por padrão; verificada com `clamd` real só em container emulado                                                                                               |
| Acessibilidade                                          | PARCIAL      | Auditoria automatizada (axe) sem violação nos 110 estados de tela; sem leitor de tela, aparelho físico ou usuários reais; não é certificação WCAG                                                       |

Bundle inicial reduzido de 584,21 para 318,55 kB (JS minificado); módulos carregados por demanda. Na divisão de `src/main.tsx` (2026-11-12) o chunk de entrada foi medido de 331 para 281 kB (gzip de 99,6 para 88,4 kB), com detalhe, formulários e telas administrativas sob demanda; as duas medições partem de estados diferentes da base e não se encadeiam. Na segunda rodada o chunk de entrada passou de 281 para 285,72 kB (medida do registro da R7); o portal do cidadão é uma entrada separada, de cerca de 19 kB de JS, que não carrega a área autenticada. Limites: escala horizontal sem proteção distribuída; arquivos locais; sem serviço S3/SSO ativado, comunicação ao solicitante por canal externo (e-mail, SMS, WhatsApp), roteirização própria ou integração BC Digital/Waze/OSRM/Google Routes; o app móvel é um repositório à parte (`urbana-campo`). Recuperação central de sessão e feedback uniforme pendentes. Observação de usuários reais e acessibilidade completa não realizadas. Piloto SQLite em instância única é diferente de recomendação de produção municipal.

### Pendências em aberto (2026-11-12)

Estado ao fim da segunda rodada. O que a primeira série deixara aberto e foi resolvido está no [Changelog](CHANGELOG.md).

**Nada foi verificado** no GitHub Actions real, em aparelho físico, no Edge, com a imagem Docker do app em produção, atrás de Caddy/HTTPS real nem em Node 24 (a máquina de desenvolvimento tem Node 22.20.0; `Dockerfile` e CI usam 24). Os testes de navegador rodaram só em Chrome headless, no macOS.

- **CI:** o workflow `.github/workflows/ci.yml` (lint, `format:check`, testes com PostgreSQL, build) **nunca rodou no GitHub**; o fluxo com PostgreSQL só foi reproduzido localmente em container. Os testes de navegador estão fora do CI de propósito ([ADR-023](DECISIONS.md)). O repositório foi formatado com `npm run format` (106 arquivos rastreados tocados); convém um commit dedicado.
- **Lint:** zero erros e 546 avisos (453 `no-explicit-any`, 29 `react-hooks/exhaustive-deps`, 22 `react-hooks/set-state-in-effect`, entre outros); regras rebaixadas para aviso, não desligadas ([ADR-022](DECISIONS.md)).
- **Contagens:** `npm test` roda 184 testes (179 aprovados e 5 não executados, que exigem `URBANA_POSTGRES_TEST_URL`); 13 migrations; doze suítes de navegador. A última execução com PostgreSQL real (184 de 184, registro da R6) não foi repetida na revisão desta documentação.
- **Desempenho:** o Kanban ainda leva cerca de 3,7 s para desenhar 12 mil cartões abertos; `GET /api/mapa/ocorrencias` segue sem paginação; sem benchmark de volume em PostgreSQL.
- **Operação:** restauração de `pg_dump` não testada; `pg_dump` do host só validado dentro do container; imagem Docker da aplicação nunca construída; Caddy real não exercitado; instâncias reais múltiplas não testadas.
- **Campo offline e app móvel:** nada em aparelho real; iOS (sem Background Sync, retenção de dados) não observado; a troca do service worker `v3` para `v4` num aparelho que já tinha o `v3` não foi observada. O app `urbana-campo` precisa ser publicado com o cabeçalho `X-Urbana-Client` antes do backend novo; o APK existente no repositório do app não funciona contra este servidor.
- **Antimalware:** testado com `clamd` real só em container emulado (amd64); o scan roda dentro da fila serial de escritas (um `clamd` travado segura as escritas até 10 s).
- **Portal do cidadão:** sem CAPTCHA; um robô que troque de IP esgota o teto global (30 demandas por hora) e bloqueia cidadãos por até uma hora; o hash de IPv4 é pseudonimização; o texto LGPD padrão precisa de **revisão jurídica** antes de ligar o portal; localização obrigatória; não testado com leitor de tela, em aparelho físico nem atrás de Caddy/HTTPS.
- **Obras e intervenções:** as escolhas de modelo (N:N com OS e ocorrência, no máximo uma obra por intervenção ou OS, obra sem geometria, tolerância de 15 m, exclusão só em `PLANEJADA`) foram tomadas na implementação e precisam de validação com a gestão municipal; ficaram fora trechos de via, associação espacial automática, documentos, capacidade/WIP por setor e equipe, vínculo a ativos e intervenções no detalhe da ocorrência/OS.
- **Acessibilidade:** auditoria automatizada sem violação, mas sem leitor de tela, aparelhos reais, contraste de elementos não textuais, espaçamento de texto e orientação; não é certificação WCAG.
- **Contratos agregados:** as decisões de produto do R4 (Concluídas de 30 dias no Kanban, planos encerrados em páginas de 20, `/campo` de gestão só com OS abertas, mapa de "Nova ocorrência" só com ocorrências em andamento, `byNeighborhood` e `byCategory` fora do painel) precisam de revisão ([ADR-028](DECISIONS.md)).
- **Decisão do responsável:** `URBANA_ALLOW_INSECURE_DEMO` foi mantida no `compose.local.yaml` (o app móvel é testado contra o backend local pelo IP da rede); pode ser revista.
- Resolvidos na segunda rodada: o desvio do service worker para `/api/bootstrap` (boot offline no app), a mensagem de localização do upload, o 404 em `/api`, as quatro propostas de contrato da T7 e o `format:check` no CI.

### Ordem recomendada de evolução

P0: locking/UX de conflitos, paginação/filtros SQL, auditoria pesquisável, FileStorage, homologação PostgreSQL/PostGIS, modularização/código por demanda e testes adicionais. State machine já centralizada; checkpoints desta revisão implementam edições versionadas, listas/auditoria paginadas, filtros SQL, FileStorage e code splitting. Homologação real PostgreSQL/PostGIS (carga, imagem Docker, Caddy, instâncias reais) permanece aberta; as consultas internas de planejamento, setor e campo foram agregadas em SQL e, na segunda rodada, os contratos de painel, planejamento, Kanban e `/campo` de gestão passaram a agregados ou recortes explícitos. Preservar fluxos, idempotência, evidências, restrições de setor/operador, auditoria, WIP e rollback.

P1: obra/intervenção (identificação, geometria, vínculos, situações, camada no mapa por bbox e conflitos **entregues**; ver a seção Obras e intervenções), vias/geometria, duração e capacidade estimada, WIP GLOBAL/SECTOR/TEAM com precedência TEAM → SECTOR → GLOBAL (pendentes). Manutenção simples continua independente. Migrations futuras aditivas; versões 5/6/7 sugeridas na auditoria eram hipóteses, não reservas ou entregas. Confirmar numeração no código antes de implementar; não editar versões 1–4.

P2: cronograma, custo completo, estoque completo, inspeções, medições, progresso físico-financeiro, mobilidade/providers/interdições/impacto. P3: comunicação ao solicitante por canal externo (o portal público de registro e acompanhamento por protocolo já existe, desligado por padrão), offline além do ciclo da OS da Equipe de Campo (registro de ocorrência offline, outros perfis, conflitos entre aparelhos, teste em aparelho real), BI e predição apenas com histórico confiável. P3 não deve antecipar pendências estruturais de P0–P2.

## 12. Especificações futuras preservadas

**Status: MISTO — especificações futuras com checkpoints P0 explicitamente marcados.** Obras/intervenções/mobilidade permanecem diretrizes futuras; itens técnicos já entregues abaixo têm status próprio. Não presumir que interfaces conceituais sejam contratos HTTP vigentes.

### Custos, estoque e fiscalização — P2

Centros de custo por obra/intervenção/OS: MATERIAL, LABOR, EQUIPMENT, VEHICLE, FUEL, CONTRACT, THIRD_PARTY_SERVICE, OTHER. Estoque deve evoluir para almoxarifados, reservas/devoluções, transferências, inventários e reposição completa, preservando os movimentos básicos existentes. Inspeções devem ter templates/checklists, fotos/GPS, parecer, não conformidades, prazo e resolução; resultados Conforme, Conforme com ressalvas, Não conforme.

### Capacidade — P1

Estimar membros ativos, horas/dias/jornada, duração de OS, compromissos, turnos, ausências e deslocamentos. Apresentar como capacidade estimada, sem transformar contagem de OS em garantia de disponibilidade.

### Auditoria pesquisável — P0/P2

**Status: IMPLEMENTADO para entidades atuais.** Consulta por `entity_type`, `entity_id`, `user_id`, `event`, `from`, `to`, `cursor` e `limit`, com índices, filtros SQL e painel de pesquisa. P2 deve também auditar obras/fases/progresso, interdições, medições, inspeções, não conformidades, estoque/custos e análises de impacto viário. Preservar valores anteriores/novos e proibir alteração silenciosa de histórico.

### Relações e território — P1

**Status: PARCIAL.** Entregue na segunda rodada (ver [Obras e intervenções](#obras-e-intervenções--implementado-p1-parcial)): intervenções com geometria, período, responsável, prioridade, vínculos N:N com ocorrências e OS, agrupamento em obra, camada por bbox e conflito espacial e temporal como aviso. Pendente: trechos de via e associação espacial automática, documentos, capacidade/WIP por escopo, vínculo a ativos. O texto original da especificação segue abaixo. Intervenções poderão agrupar ocorrências/OS, área/trecho/ativo, período, responsável, prioridade e geometria, com vínculo opcional a obra. Obras poderão reunir intervenções, OS, documentos e os recursos P2 de cronograma/custos/fiscalização/medições. Identificar conflitos espaciais e temporais entre intervenções, consultar camadas por viewport/bbox e permitir correção humana de associações automáticas. A modularização deve preparar esses módulos sem tornar obra obrigatória para manutenção simples.

### Medições — P2

**Status: PLANEJADO.**

Criar medições vinculadas a obras.

Fluxo esperado:

```text
RASCUNHO
↓
ENVIADA
↓
EM ANÁLISE
↓
APROVADA / REJEITADA
```

Itens devem registrar:

- código do serviço;
- descrição;
- unidade;
- quantidade anterior;
- quantidade atual;
- quantidade acumulada;
- preço unitário;
- valor atual;
- valor acumulado.

Medições aprovadas não devem ser silenciosamente editáveis.

Reabertura exige justificativa e auditoria.

### Cronograma físico — P2

**Status: PLANEJADO.**

Obras deverão possuir:

- fases;
- atividades;
- datas planejadas;
- datas reais;
- progresso;
- responsável;
- dependências simples.

Exemplo:

```text
Mobilização
↓
Drenagem
↓
Base
↓
Pavimentação
↓
Sinalização
```

O progresso consolidado deve considerar pesos das fases.

### Progresso físico-financeiro — P2

**Status: PLANEJADO.**

Separar claramente:

#### Físico

Percentual efetivamente executado da obra.

#### Financeiro

Indicadores distintos para:

- valor estimado;
- valor contratado;
- valor medido;
- valor aprovado;
- valor executado.

Não misturar conceitos diferentes em um único percentual sem documentação.

### Território e GIS

**Status: PLANEJADO.**

#### P1

Criar `road_segments`.

Campos iniciais:

```text
id
road_code
official_name
normalized_name
geometry
road_class
direction
lanes
speed_limit
neighborhood
active
```

Permitir associação espacial de:

- ocorrência;
- intervenção;
- obra;
- interdição.

Toda associação automática deve permitir correção humana.

### Geometrias — P1

**Status: PARCIAL.**

Obras e intervenções devem poder representar:

```text
Point
LineString
Polygon
MultiLineString quando necessário
```

Exemplos:

- ponto: poste/equipamento específico;
- linha: recapeamento;
- polígono: praça ou área de obra.

API deve trabalhar com GeoJSON.

PostGIS deve ser utilizado quando disponível.

### Mobilidade — P2

**Status: PLANEJADO.**

Criar módulo de mobilidade desacoplado de fornecedores externos.

Responsabilidades:

- trânsito;
- congestionamentos;
- incidentes;
- interdições;
- roteamento;
- rotas alternativas;
- impacto viário.

Interfaces fundamentais:

```typescript
interface MobilityProvider {}
interface RoutingProvider {}
```

Providers possíveis:

```text
WazeMobilityProvider
MunicipalMobilityProvider
MockMobilityProvider
OSRMRoutingProvider
GoogleRoutesProvider
```

Mocks somente em desenvolvimento, testes ou demo.

### Waze for Cities — P2

**Status: PLANEJADO.**

A arquitetura deve ser preparada para integração com Waze for Cities.

Regras:

- não inventar endpoints;
- não inventar tokens;
- usar apenas integrações oficialmente disponibilizadas ao município;
- credenciais ficam exclusivamente no backend;
- publicação externa deve ser auditável;
- nenhuma interdição deve ser publicada automaticamente sem autorização.

### Interdições — P2

**Status: PLANEJADO.**

Criar entidade `road_closures`.

Campos mínimos:

```text
id
code
project_id
intervention_id
order_id
geometry
road_segment_id
type
direction
start_at
end_at
reason
status
lanes_total
lanes_closed
created_by
created_at
updated_at
version
```

Tipos:

```text
FULL
PARTIAL
```

Status:

```text
PLANNED
ACTIVE
FINISHED
CANCELLED
```

### Impacto viário — P2

**Status: PLANEJADO.**

Criar análise configurável considerando:

- interdição total/parcial;
- classe da via;
- quantidade de faixas;
- duração;
- horário de pico;
- congestionamento disponível;
- obras próximas;
- intervenções próximas;
- equipamentos sensíveis;
- existência de rotas alternativas.

Classificação inicial:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

O resultado deve ser apresentado como **impacto estimado**.

Não apresentar previsão como certeza.

### Dados de mobilidade

**Status: PLANEJADO.**

Todo dado externo deve identificar:

```text
source
collectedAt
dataType
confidence quando houver
```

Tipos:

```text
REAL_TIME
HISTORICAL
ESTIMATED
SIMULATED
```

Essa distinção é obrigatória na API e na interface.

### Arquitetura alvo

**Status: PLANEJADO — evolução técnica.**

O Urbana deve evoluir como **modular monolith**.

Não criar microserviços sem necessidade operacional real.

Estrutura conceitual:

```text
src/
  modules/
    dashboard/
    occurrences/
    triage/
    orders/
    planning/
    projects/
    interventions/
    mobility/
    kanban/
    teams/
    inventory/
    inspections/
    measurements/
    field/
    administration/

  shared/
    components/
    hooks/
    services/
    permissions/
    maps/
    utils/
```

Backend alvo:

```text
server/
  modules/
    occurrences/
    orders/
    planning/
    projects/
    interventions/
    mobility/
    inventory/
    inspections/
    measurements/
    kanban/
    audit/
    files/

  shared/
    auth/
    database/
    validation/
```

A modularização deve ser incremental.

### Storage

**Status: IMPLEMENTADO — abstração local/object injetável; serviço externo não ativado.**

#### P0

Criar abstração:

```typescript
interface FileStorage {
  save(file): Promise<StoredFile>;
  get(id): Promise<Readable>;
  delete(id): Promise<void>;
  exists(id): Promise<boolean>;
}
```

Implementações esperadas:

```text
LocalFileStorage
S3FileStorage / ObjectStorageFileStorage futuramente
```

### Concorrência — P0

**Status: PARCIAL — edições ocorrência/OS implementadas; expansão a domínios futuros e proteção distribuída pendentes.**

Entidades críticas devem utilizar optimistic locking.

Campo:

```text
version INTEGER NOT NULL DEFAULT 1
```

Aplicável inicialmente a:

```text
occurrences
orders
action_plans
```

E posteriormente:

```text
projects
interventions
measurements
road_closures
```

Conflito deve retornar:

```text
409 CONFLICT
```

A interface deve informar que outro usuário alterou o registro.

Nunca sobrescrever silenciosamente.

### Paginação — P0

**Status: PARCIAL — listas ocorrência/OS/auditoria/movimentos paginadas; consumidores operacionais amplos permanecem (custo interno reduzido em 2026-11-12; contratos que devolvem tudo continuam).**

Listagens principais devem usar paginação server-side.

Prioridade:

```text
/api/ocorrencias
/api/ordens-servico
/api/auditoria
```

Filtros devem permanecer no servidor.

Evitar carregar todos os registros para filtrar no React.

### Indicadores desejados

**Status: PLANEJADO.**

#### Eficiência

```text
Tempo até triagem
Tempo até programação
Tempo até início
Tempo de execução
Lead time total
```

#### Qualidade

```text
% reabertas
% devolvidas
% recusadas
reincidência
```

#### Operação

```text
OS por equipe
OS por operador
capacidade estimada
backlog
```

#### Financeiro — P2

```text
custo médio
previsto x realizado
custo por intervenção
custo por obra
```

#### Território

```text
ocorrências por área
bairros de maior concentração
vias reincidentes
obras simultâneas
```

## 13. Verificação e critérios de conclusão

Testes em tests/ cobrem regras, API, persistência, permissões, estados válidos/inválidos, transações/rollback, campo/idempotência, evidências, estoque/notas, planejamento, distribuição, Kanban/métricas/WIP e setor. Scripts de navegador cobrem desktop/celular, toque/teclado, campo e navegação. Contagens/datas das verificações pertencem a CHANGELOG.md; não comprovam carga, Docker, PostgreSQL real, integração externa ou certificação WCAG. Além dos scripts de navegador (`npm run test:browser`, **doze** suítes, incluindo `test:works`, `test:portal` e `test:a11y`; Edge por padrão, Chrome ou Chromium conforme `URBANA_BROWSER_CHANNEL`), há `npm run lint`, `npm run format:check` e o workflow de CI (lint, formatação, testes e build), ainda não executado no GitHub. `npm test`: 184 testes, 179 aprovados e 5 que exigem PostgreSQL.

P0 só conclui com conflitos tratados, listagens paginadas/filtradas no servidor, banco homologado, storage desacoplado, auditoria pesquisável, modularização e testes preservados. P1 requer entidades/geometria/capacidade/WIP por escopo e vínculos opcionais funcionando sem regressão da manutenção simples. Futuras entregas exigem testes relevantes e atualização explícita de status.

## Documentação complementar

- [API](API.md)
- [Implantação](DEPLOYMENT.md)
- [Histórico de evolução](CHANGELOG.md)
- [Decisões arquiteturais](DECISIONS.md)

## Instruções para agentes de desenvolvimento

Antes de implementar funcionalidades:

1. Leia URBANA-CONTEXTO-MESTRE.md.
2. Consulte API.md quando trabalhar com endpoints.
3. Consulte DEPLOYMENT.md quando alterar infraestrutura.
4. Consulte DECISIONS.md antes de alterar arquitetura ou domínio.
5. Consulte CHANGELOG.md apenas quando precisar de contexto histórico.
6. Inspecione código, migrations em server/migrations/ (executor em server/db.js), server/schema.sql e testes existentes.
7. Separe IMPLEMENTADO, PARCIAL e PLANEJADO; atualize documentação quando regras mudarem.

Não utilizar documentos históricos removidos como fonte de verdade. Não reinterpretar conceitos centrais sem nova decisão arquitetural, remover comportamento sem justificativa ou mudar regra para simplificar código. Divergência código/documentação exige registrar a descrição anterior, o comportamento real e a decisão; esta consolidação fez isso no Changelog.

O resultado esperado é uma visão confiável de problema → prioridade → planejamento → responsabilidade → execução → evidência → conferência → custo → resultado, mantendo operação simples no campo e rastreabilidade para a gestão.

## Checkpoint técnico de concorrência — 2026-10-02

Migration 5 aditiva e módulo server/modules/concurrency. 38 testes de regras/API aprovados, incluindo corrida de duas edições, versão ausente/inválida, comparação no banco, reinício e rollback. Build e test:ui/test:field/test:kanban aprovados. State machine preservada e profundamente imutável. P0 continua aberto; P1/P2 não iniciados.

## Checkpoint de listagens — 2026-10-02

Migration 6 aditiva cria índices de paginação/filtros/FKs e auditoria. Listas de ocorrência, triagem e OS usam paginação e filtros SQL; auditoria administrativa tem painel de pesquisa. Mapas aceitam bbox no backend. Contratos legados e consultas amplas de dashboard/planejamento/kanban permanecem para evolução incremental sem truncar métricas; portanto escalabilidade P0 continua PARCIAL.

## Checkpoint de storage — 2026-10-02

FileStorage local e adaptador object com injeção, integrado a evidências/notas e limpeza após rollback. 41 testes aprovados e 1 PostgreSQL/PostGIS não executado; usuário optou por preparar homologação para execução posterior. P0 permanece aberto até homologação e eliminação das consultas amplas.

## Checkpoint de modularização — 2026-10-02

React.lazy/Suspense por área (mapa, campo, planejamento, Kanban, auditoria, painel, estoque, notas e setor), com fallback acessível. GeoMap e cores/rótulos extraídos; backend extraiu concorrência, listagens e storage sem alterar monólito. JS entry: 584,21 → 318,01 kB; gzip: 169,97 → 95,71 kB. Os chunks de cada área são carregados quando usados; não é redução de todo o código distribuído. Migration 7 adiciona índices de movimentos; histórico de estoque paginado e saldos/custos agregados SQL. P0 permanece PARCIAL, P1/P2 não iniciados pelo gate de estabilização/homologação.

## Validação final do checkpoint

43 testes aprovados, 1 teste PostgreSQL/PostGIS não executado (preparado para execução posterior conforme usuário); build TypeScript/Vite aprovado, sem aviso de chunk acima de 500 kB; test:ui/test:field/test:kanban e node tests/p0-browser.mjs aprovados, sem erros de console. P0 parcial e P1/P2 não iniciados; ver RELATORIO-P0-P1-P2.md para matriz e pendências.

## Onboarding por perfil — IMPLEMENTADO (2026-10-02)

Primeiro acesso apresenta nome, perfil, cadeia Demanda → Triagem → Programação → Execução → Validação → Conclusão e participação do usuário. Treinamento de até seis etapas contextualiza tarefas, ações autorizadas, encaminhamento e exceções. Ajuda → Como usar o Urbana permite repetir o fluxo ou abrir tutorial individual. Progresso próprio persistido por versão; pular é diferente de concluir e repetir mantém a conclusão anterior.

Conteúdo filtrado por perfil + módulos + ações na interface e na API. Campo permanece exclusivo em /campo; Consulta apenas consulta; Administração permanece exclusiva. Sem módulos não há tour automático. Treinamento não salva registros operacionais e não exige dados de demonstração. Migration 9 adiciona progresso/eventos internos. [Referência completa, arquivos e validações](ONBOARDING.md).

## Conta master de manutenção

Por definição, `admin@urbana.local` com perfil Administrador tem acesso permanente a todos os módulos do catálogo, incluindo /campo, e às ações de manutenção desses módulos. É a única exceção às restrições comuns de perfil/Campo. Novos módulos do catálogo ficam disponíveis automaticamente. Remover liberações persistidas não retira o acesso master; ao salvar essa conta, o servidor grava novamente todos os módulos.

E-mail e perfil da conta são protegidos na edição administrativa. A interface mostra todos os módulos marcados e bloqueados para remoção. Nome pode ser editado. A autenticação, sessão, auditoria, validação de versão, estados, evidências, justificativas e demais regras operacionais continuam exigidas. Outros administradores permanecem sujeitos aos módulos liberados e não executam em Campo.

A identidade é verificada no servidor a partir do usuário autenticado; informar o e-mail no corpo de uma requisição não concede acesso master. Implementação compartilhada: isMasterUser, canPerformAction e hasModuleAccess; userModules resolve todos os módulos do catálogo para essa conta sem depender de migração ou reaplicação do seed.

## Obras e intervenções — IMPLEMENTADO (P1 parcial)

Entregue na segunda rodada (R5; migration 12; [ADR-024](DECISIONS.md); contrato em [API](API.md#obras-e-intervenções); permissões em [Autorização](AUTORIZACAO.md#obras-e-intervenções-módulo-e-ação-works)). **As escolhas de modelo foram tomadas na implementação e precisam de validação com a gestão municipal.**

- **Entidades:** intervenção (`INT-AAAA-NNNNN`: título, escopo `TRECHO`/`AREA`/`ATIVO`, local, setor, responsável, prioridade, período previsto e real, serviços e geometria GeoJSON) e obra (`OB-AAAA-NNNNN`: título, responsável, período; sem geometria própria, só a extensão das suas intervenções). Ocorrências e OS continuam independentes: uma manutenção simples não precisa de nenhuma das duas, e vincular, editar, mudar a situação ou excluir não altera situação, `version` nem histórico dos registros vinculados.
- **Vínculos:** intervenção ↔ ocorrência e intervenção ↔ OS são N:N; cada intervenção e cada OS pertence a **no máximo uma obra**.
- **Situações:** `PLANEJADA`, `EM_ANDAMENTO`, `PARALISADA`, `CONCLUIDA`, `CANCELADA`, em máquina própria (`server/domain/works.js`), sem os estados de OS. Paralisar, cancelar e reabrir exigem motivo; a obra só conclui com todas as intervenções concluídas ou canceladas; a exclusão só vale em `PLANEJADA`; `version` obrigatória nas edições.
- **Conflito:** duas intervenções ativas conflitam quando os períodos **previstos** se sobrepõem e as geometrias se tocam ou ficam a até 15 m. É aviso, não bloqueio, e a pessoa pode registrar uma avaliação.
- **Interface:** módulo `works` (`/obras`), item de menu no nível principal; listas, formulários, detalhe e editor de geometria por cliques no mapa, com alternativa textual; camada de intervenções no mapa territorial.
- **Acesso:** Administrador e Gestor escrevem; Fiscalização e Consulta leem; a migration não libera o módulo a nenhum usuário existente (só a conta master).
- **Fora desta entrega (P1):** trechos de via e associação espacial automática, documentos da obra, capacidade estimada e WIP por setor/equipe, vínculo a ativos, mostrar as intervenções no detalhe da ocorrência/OS. **Não tocado (P2):** cronograma, custos, medições, fiscalização de obra, interdições.
- **Verificação:** `tests/works.test.js`, `tests/works-domain.test.js` e `tests/works-browser.mjs` (Chrome); a migration 12 foi conferida sobre cópias de bancos SQLite e PostgreSQL existentes.

## Portal do cidadão — IMPLEMENTADO (desligado por padrão)

Entregue na segunda rodada (R6; migration 13; [ADR-025](DECISIONS.md); contrato em [API](API.md#portal-do-cidadão-rotas-públicas); operação em [Implantação](DEPLOYMENT.md#portal-do-cidadão)). Registro público de demanda e acompanhamento por protocolo, sem sessão, sem canal externo de notificação.

- **Páginas e rotas:** `/portal` e `/portal/acompanhar` (entrada separada do Vite, sem framework, que não carrega a área autenticada) e `/api/publico/catalogo`, `/api/publico/demandas` e `/api/publico/acompanhar`. **Desligado por padrão**: liga em Administração > Configurações; `URBANA_PUBLIC_PORTAL=off` vence a configuração. Desligado, tudo responde 404.
- **Entrada no fluxo:** ocorrência `IDENTIFICADA`, prioridade inicial `Média`, origem "Portal do cidadão", registrada pelo usuário de sistema `system-portal-cidadao` (perfil `Sistema`; não faz login e não aparece na administração), para a triagem tratar normalmente. O portal não respeita o limite de WIP do Kanban. A duplicidade nunca é mostrada ao cidadão; fica em `public_portal.possible_duplicates` para a triagem.
- **Código de acompanhamento:** 16 caracteres (cerca de 79 bits), mostrado uma única vez; só o SHA-256 é guardado. Número inexistente e código errado respondem igual.
- **O que o cidadão vê:** protocolo, categoria, bairro e seis etapas públicas (Recebida, Em análise, Programada, Em execução, Concluída, Não atendida); `AGUARDANDO_VALIDACAO` aparece como "Em execução". Nunca nome, telefone, descrição, endereço, coordenadas, fotos, equipe, OS, notas, motivo interno nem outras demandas. A recusa ganhou `public_reason` opcional (`fora_competencia`, `ja_registrada`, `informacao_insuficiente`, `nao_procede`), com texto fixo mostrado no portal.
- **Contra abuso:** 10 criações por hora por IP, 30 consultas a cada 15 minutos por IP, teto global de 30 demandas por hora, campo isca e tempo mínimo de 5 s (configuráveis). **Sem CAPTCHA.**
- **Dados e LGPD:** consentimento obrigatório e registrado (data e hash do texto); nome e telefone opcionais e só internos; localização obrigatória; foto reduzida no navegador (remove o EXIF) e verificada pelo antimalware quando ligado. **O texto de consentimento padrão precisa de revisão jurídica antes de ligar o portal.** O hash de IPv4 é pseudonimização, não anonimização.
- **Riscos que continuam:** um robô que troque de IP pode esgotar o teto global e bloquear cidadãos por até uma hora; quem não tem GPS e não consegue usar o mapa não envia; não testado com leitor de tela, em aparelho físico nem atrás de Caddy/HTTPS; os limites por IP dependem de `TRUST_PROXY` atrás de proxy.
- **Verificação:** `tests/portal.test.js` (inclui um teste que exige PostgreSQL), `tests/portal-browser.mjs` (Chrome) e curl em modo produção.

## Checkpoint técnico — 2026-11-12

Série de onze tarefas técnicas na branch `chore/melhorias-tecnicas`, sem mudança de regra de negócio nem de contrato HTTP além do que está listado aqui. **Esta seção descreve o fim da primeira série; os números de testes e de linhas e as pendências que ela cita foram atualizados na segunda rodada (seção seguinte).** Verificação de `npm test` em 2026-11-12, em Node 22.20.0: **123 testes; 120 aprovados, nenhuma falha, 3 não executados** (sem `URBANA_POSTGRES_TEST_URL`); lint sem erros. Última execução contra PostgreSQL/PostGIS real: 122 de 122, antes do `tests/route-table.test.js`.

- **Estrutura (IMPLEMENTADO):** migrations em arquivos (1–11 ao fim da primeira série; hoje 1–13); `server/app.js` de 1.499 para 79 linhas (tabela de 77 rotas idêntica antes e depois, fixada por teste; hoje 173 linhas e 110 rotas, com o portal e as obras); `src/main.tsx` de 3.392 para 326 linhas, código movido sem reescrita (hoje 712, depois do Prettier).
- **Banco (IMPLEMENTADO):** pool no PostgreSQL com transação por cliente; fila serial de escrita mantida; `GET` fora da fila no PostgreSQL.
- **Segurança (IMPLEMENTADO, verificação limitada):** ver seção 3.
- **Operação (IMPLEMENTADO / PARCIAL):** `/healthz` com banco (503 em falha), logs estruturados com `X-Request-Id`, `npm run backup`, limpeza de órfãos (desligada por padrão), push seguro entre instâncias (escritas continuam por processo). Não verificado: `pg_dump` do host, restauração de dump, imagem Docker, instâncias reais.
- **Campo offline (IMPLEMENTADO no ciclo da OS, só Chrome headless):** seção 8; lançamento de equipamento também idempotente (`request_id`/`captured_at`, sem migration).
- **Consultas amplas (IMPLEMENTADO no interior, contratos intactos):** respostas JSON idênticas byte a byte; num banco SQLite sintético de 40 mil ocorrências e 29 mil OS, `/api/controle-setor` caiu de 29.051 consultas para 5 (701 → 187 ms), `/api/ocorrencias/proximas` de 198 para 1 ms, a checagem de duplicidade de 210 para 21 ms e `/api/dashboard` de 2.050 para 616 ms; `/api/planejamento` e `/api/campo`, de crescimento cúbico (166 s e 345 s com 5 mil ocorrências), passaram a 1,0 s e 0,4–0,6 s com 40 mil; as contagens de WIP do Kanban viraram um `GROUP BY`. Novo `tests/query-equivalence.test.js` compara as implementações antigas com o HTTP real em SQLite e PostgreSQL. Não verificado: benchmark de volume em PostgreSQL. Nenhum índice novo foi necessário.
- **Escalabilidade — propostas que mudam contrato (feitas na segunda rodada, R4):** (1) o painel devolver só agregados em vez de todas as OS e ocorrências (33 MB por carga com 40 mil registros); (2) paginar planos encerrados; (3) limitar `/api/campo` de gestão às OS abertas; (4) endpoint próprio de cartões para o Kanban.
- **Qualidade:** ESLint (regras com violações rebaixadas para aviso), Prettier (`format`/`format:check`) e CI configurados; `tests/support/browser.mjs` e `URBANA_BROWSER_CHANNEL` tornam o Edge opcional; as três suítes de navegador que falhavam antes (`test:ui`, `test:kanban`, `sector-browser`) eram testes defasados e foram atualizados.
- **Pontos de atenção:** os GETs do PostgreSQL leem em `READ COMMITTED` fora da fila; o pool usa o padrão de 10 conexões, sem configuração; o primeiro acesso ao `/campo` offline dependia do desvio do service worker (ADR-020), removido na segunda rodada. Pendências e problemas não corrigidos: seção 11, “Pendências em aberto (2026-11-12)”. Decisões: [DECISIONS](DECISIONS.md), ADR-016 a ADR-023.

## Checkpoint técnico — segunda rodada (2026-11-12)

Série R1–R8 (mais o ajuste do app móvel R10a) na mesma branch, nada commitado; registro em [TAREFAS-MELHORIAS](TAREFAS-MELHORIAS.md) e entrada completa no [Changelog](CHANGELOG.md). Verificação em Node 22.20.0: `npm test` com **184 testes, 179 aprovados, nenhuma falha e 5 não executados** (sem `URBANA_POSTGRES_TEST_URL`); com PostgreSQL/PostGIS real o registro da R6 relata 184 de 184; lint sem erros e 546 avisos; `format:check` limpo; doze suítes de navegador em Chrome headless, segundo os registros das tarefas.

- **Campo offline (R1):** boot offline no app a partir da sessão salva; service worker `v4` fora de `/api` (seção 8, [ADR-020](DECISIONS.md)). Defeito corrigido: o logout da gestão não apagava a sessão salva.
- **Borda (R2, R3):** `X-Urbana-Client` para cliente nativo, 404 para caminho de `/api` desconhecido, mensagem de localização do upload corrigida, antimalware opcional (seção 3; [ADR-026](DECISIONS.md), [ADR-027](DECISIONS.md)).
- **Contratos agregados (R4):** painel só com agregados, resumos, `kanban/cartoes`, `planejamento/encerrados` e `/campo` de gestão com OS abertas; **mudança incompatível** ([ADR-028](DECISIONS.md)).
- **Obras e intervenções (R5)** e **portal do cidadão (R6):** seções próprias acima.
- **Acessibilidade (R7):** auditoria automatizada sem violação em 110 estados de tela; não é certificação (seção 4).
- **Estilo e CI (R8):** repositório formatado e `format:check` no CI ([ADR-023](DECISIONS.md)).
- **App móvel (R10a):** `urbana-campo` envia `X-Urbana-Client`, trata os novos códigos de erro e lança equipamento de forma idempotente; branch `chore/compat-servidor-novo` daquele repositório, sem commit.
- **Contagens:** 13 migrations; 110 rotas registradas; chunk de entrada de 285,72 kB. Pendências e o que não foi verificado: seção 11, "Pendências em aberto".
