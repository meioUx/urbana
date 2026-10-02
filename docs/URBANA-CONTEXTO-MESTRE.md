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

Consolidado e verificado contra o código em **2026-10-02**. O código e os testes determinam o que existe; este documento define o modelo conceitual oficial. Divergências devem ser investigadas e registradas, sem mudar regras de negócio para corresponder a textos antigos. **IMPLEMENTADO**, **PARCIAL** e **PLANEJADO** distinguem entrega, limitações e especificação futura.

## 1. Produto, princípios e modelo de domínio

**Status: IMPLEMENTADO.** Urbana é uma aplicação web de gestão de manutenção municipal, com foco operacional em manutenção viária. Liga registro, análise, programação, execução e validação. A gestão acompanha demandas, equipes, prazos, recursos e resultados; campo recebe tarefas, captura GPS/fotos, registra execução e impedimentos. Balneário Camboriú é referência geográfica do seed, não uma operação municipal real.

Princípios: rastreabilidade; transações críticas; responsabilidade e próxima ação claras; servidor como fonte de verdade; Kanban e painéis como representações do processo; evolução incremental; acessibilidade sem depender de cor, arraste ou mouse. Dados reais, históricos, estimados e simulados devem ser distinguidos; fornecedores externos não devem determinar o domínio.

| Conceito | Definição | Status |
| --- | --- | --- |
| Ocorrência | Problema, demanda ou necessidade identificada no território | IMPLEMENTADO |
| Ordem de serviço (OS) | Atendimento planejado de uma ou mais ocorrências, com estado, equipe, prioridade, prazo e recursos próprios | IMPLEMENTADO |
| Plano de ação (PA) | Agrupamento operacional de demandas da mesma via/bairro/setor | IMPLEMENTADO |
| Intervenção | Conjunto estruturado de serviços num trecho, área ou ativo, com geometria, período, responsável, prioridade e vínculos opcionais | PLANEJADO — P1 |
| Obra | Projeto municipal de infraestrutura que poderá reunir intervenções, OS, cronograma, custos, fiscalização, medições e impacto viário | PLANEJADO — P1/P2 |

Não fundir ocorrência e OS nem transformar planos automaticamente em obras. Uma manutenção simples deve continuar independente de obra ou intervenção. Usos atuais da palavra “obra” na interface são linguagem operacional, não evidência de uma entidade de obra implementada.

## 2. Fluxo, estados e requisitos

**Status: IMPLEMENTADO.** Quatro decisões: analisar demanda → programar atendimento → executar serviço → conferir e encerrar. Planejamento apoia a escolha e o agrupamento, mas não é obrigatório para atender uma ocorrência.

A fonte executável dos estados/transições é `server/domain/workflow.js`. Ocorrência decide entrada no atendimento; OS controla execução. Criar uma OS a partir de demandas triadas projeta PROGRAMADA nas ocorrências; mudanças da OS propagam seus estados. A relação é N:N: ao encerrar uma OS, outra OS ativa vinculada pode manter o estado ativo da ocorrência.

| Código | Significado e exibição |
| --- | --- |
| IDENTIFICADA | Demanda recebida: “A analisar”; Kanban: “Identificadas” |
| EM_TRIAGEM | Classificação concluída: “Pronta para programar”; Kanban ainda exibe “Em triagem” |
| RECUSADA | Decisão justificada de não atender; antes de OS |
| PROGRAMADA | OS emitida e atribuída |
| EM_DESLOCAMENTO | Equipe a caminho |
| EM_EXECUCAO | Serviço iniciado |
| AGUARDANDO_VALIDACAO | Relato enviado, pendente de conferência |
| DEVOLVIDA | Impedimento justificado; gestão deve reprogramar |
| CONCLUIDA | Resultado validado |
| CANCELADA | OS interrompida com justificativa |

Transições diretas da ocorrência: IDENTIFICADA → EM_TRIAGEM ou RECUSADA; EM_TRIAGEM → EM_TRIAGEM (complementar/corrigir classificação) ou RECUSADA. RECUSADA não tem saída operacional. Não existe transição direta de execução da ocorrência.

Transições da OS:

| Origem | Destinos permitidos |
| --- | --- |
| PROGRAMADA | EM_DESLOCAMENTO, EM_EXECUCAO, DEVOLVIDA, CANCELADA |
| EM_DESLOCAMENTO | EM_EXECUCAO, DEVOLVIDA, CANCELADA |
| EM_EXECUCAO | AGUARDANDO_VALIDACAO, DEVOLVIDA, CANCELADA |
| AGUARDANDO_VALIDACAO | CONCLUIDA, EM_EXECUCAO (reabertura) |
| DEVOLVIDA | PROGRAMADA |
| CONCLUIDA | EM_EXECUCAO (reabertura) |
| CANCELADA | Nenhum |

### Registro e decisão de atendimento

Registro inclui categoria/subcategoria, prioridade, origem, descrição, coordenadas, endereço, bairro e referência; solicitante/telefone são opcionais. GPS, seleção no mapa ou coordenadas e endereço manuais são aceitos. O servidor verifica proximidade no raio configurado: a pessoa confirma uma nova ocorrência ou vincula a solicitação à existente. Duplicatas vinculadas não são novas ocorrências físicas; concluídas próximas podem indicar reincidência. Recusadas/canceladas não são candidatas ativas a duplicidade.

Triagem define categoria, subcategoria, prioridade e setor. Pode guardar a análise e programar depois; gestores podem enviar triagem e emissão individual juntas, com rollback se a programação falhar. Recusa exige motivo e registra usuário/data/histórico; retira a demanda de filas ativas, planejamento e sugestões de duplicidade, mantém consulta dos anexos e bloqueia novos envios. Não apaga nem reaproveita silenciosamente a demanda.

### Programação, SLA e distribuição

Categoria fornece setor padrão e SLA em horas por prioridade: Emergencial, Alta, Média, Baixa, Programada. Triagem pode escolher outro setor válido. Ocorrências de uma OS e sua equipe devem pertencer ao mesmo setor; operador designado deve ser usuário de campo daquela equipe. Responsável textual e operador designado são campos diferentes. Usuário de campo tem uma equipe; equipe tem responsável e quantidade de integrantes, sem agenda completa de membros.

Prazo conta desde identificação, nunca desde emissão/reprogramação. OS agrupada usa o menor prazo dos membros, considerando a prioridade elevada pelo plano quando aplicável. Data de programação não substitui SLA. Ordens já existentes não têm prazo/prioridade recalculados pela simples criação posterior de plano.

Distribuição pode ser para a equipe ou um operador. OS sem operador é compartilhada pela equipe; com operador é acessível ao designado no perfil de campo. Programação só muda em PROGRAMADA ou DEVOLVIDA; reprogramação pode mudar equipe/operador do mesmo setor, preserva prazo e criação inicial e reinicia os campos do ciclo de execução. A própria OS é excluída do contexto de carga na redistribuição.

### Execução, evidências e conferência

Assumir inicia deslocamento; iniciar exige coordenadas de chegada e imagem antes quando requerida pela categoria. Concluir exige relato, imagem depois do ciclo corrente e material quando requerido; envia para AGUARDANDO_VALIDACAO, sem encerrar diretamente. Gestão/fiscalização valida ou reabre com motivo. Devolução exige justificativa, bloqueia execução/novos anexos até reprogramar; cancelamento e reabertura também exigem justificativa.

Evidências: JPG, PNG, WebP, PDF ou MP4, até 15 MB; etapas registro, antes, durante, depois, documento; autor, data, etapa e coordenadas quando fornecidas. Fotos obrigatórias devem ser imagens. Início verifica foto anterior desde criação/reprogramação; conclusão verifica foto posterior desde o marco mais recente de criação, início, reabertura ou reprogramação. Material obrigatório verifica existência de consumo na OS, sem regra de novo consumo por ciclo. Não presumir que todo requisito de material se reinicia na reabertura.

## 3. Perfis, autorização e segurança

**Status: IMPLEMENTADO.** Seis perfis vigentes definidos em `server/domain.js`:

| Ação | Administrador | Gestor | Triagem | Campo | Fiscalização | Consulta |
| --- | --- | --- | --- | --- | --- | --- |
| Consultar ocorrências/mapa | Módulo liberado | Módulo liberado | Módulo liberado | Registros próprios e tarefas em /campo | Módulo liberado | Módulo liberado |
| Registrar ocorrência | Sim | Sim | Sim | Sim | Sim | Não |
| Classificar/recusar | Sim | Sim | Sim | Não | Não | Não |
| Programar/cancelar OS, plano, almoxarifado/notas | Sim | Sim | Não | Não | Não | Não |
| Executar OS | Não | Não | Não | Equipe/operador autorizado | Não | Não |
| Validar/reabrir | Sim | Sim | Não | Não | Sim | Não |
| Cadastros, usuários, configuração e auditoria global | Sim | Não | Não | Não | Não | Não |

Reordenação do Kanban: administrador, gestor, triagem e fiscalização; limites WIP: administrador/gestor. Campo registra ocorrências, mas anexos de ocorrência são restritos aos registros próprios; anexos de OS dependem de autorização à ordem. Listas gerais de ocorrências são consultáveis pelos perfis; restrição de equipe/operador se aplica às OS, suas ações/anexos e projeções autorizadas em painel, planejamento e push.

**Status: IMPLEMENTADO.** Perfil × módulos individuais persistidos × ações funcionais. Somente usuários com perfil Administrador podem criar usuários, alterar perfis e gerenciar liberações de módulos. O acesso a módulos não concede poderes adicionais ao perfil. O ambiente `/campo` é exclusivo do perfil Equipe de Campo, inclusive para execução de OS; gestores e administradores não entram nesse ambiente. Catálogo/matriz/ações em `shared/authorization.mjs`; migração 8 em `server/db.js`. Administração possui criação e edição de usuários/módulos, com auditoria. Não executar antigos scripts de transformação de permissões funcionais no deploy. Consulte [Autorização](AUTORIZACAO.md) para matriz, regras de migração e endpoints.

Senhas: scrypt com salt aleatório e comparação em tempo constante. Sessão: oito horas, cookie urban_session HttpOnly e SameSite estrito, token armazenado como hash. Login tem limitação de tentativas. Mutações rejeitam Origin fornecido de host diferente; ausência de Origin não é rejeitada por essa checagem. Uploads têm nomes aleatórios, limite de tipo/tamanho e assinatura básica; não há análise antimalware completa. Anexos exigem autenticação/autorização. Produção e credenciais estão detalhadas em [Implantação](DEPLOYMENT.md).

## 4. Áreas, interação e indicadores

**Status: IMPLEMENTADO.** Visão geral; Mapa territorial; Ocorrências; Triagem; OS; Kanban; Planejamento; Análise de campo; Controle do setor; Equipes; Materiais/almoxarifado; Equipamentos; Campo; Administração. Menu recolhível: Ocorrências agrupa registros, triagem, OS e análise; Operações agrupa setor e recursos/campo. Áreas principais têm acesso direto; administração é restrita.

Triagem alterna A analisar / Prontas para programar, com contagens. Decisão e programação não ocupam simultaneamente o formulário; voltar preserva campos. Consulta de equipes/planejamento é opcional na programação. Guia de andamento indica próxima ação, responsável e requisitos. Confirmação de gravação é separada de falha de atualização nos fluxos tratados; resultado de rede ambíguo orienta conferir antes de repetir. Nem todos os cadastros/planos/notas têm tratamento uniforme; recuperação central de sessão com preservação de formulários ainda é evolução.

Atualização periódica a cada 15 segundos nas telas tratadas, enquanto visíveis, com horário/falha e tentativa manual; não é mecanismo de controle de concorrência.

### Visão geral e contexto de distribuição

Seis indicadores: demandas abertas, OS abertas, equipes em deslocamento/execução, OS vencidas, aguardando validação e OS atualmente concluídas. Painéis de evolução diária, estados abertos, carga por equipe, prioridades e bairros mais concentrados. Seleção 14/30/90 dias altera somente o gráfico: entradas são ocorrências criadas; saídas são OS atualmente concluídas na data de validação. Unidades diferentes não formam taxa de resolução; reabertas saem da série. Não há série imutável de todas as validações.

Contexto de distribuição mostra OS abertas, chamados distintos, deslocamento/execução, programação, validações, devoluções, prazos e compromissos por data, além de vias/planos do setor. Equipe precisa ser escolhida explicitamente. “Sem operação” significa ausência de registros; compromissos na mesma data são alerta para revisão, não bloqueio nem capacidade real. Não considera jornada, férias, turnos, duração ou deslocamentos.

Controle do setor consolida OS por mês de entrada da primeira ocorrência (fallback: criação da OS) e setor. Serviços contam ocorrências por OS, contatos contam um por OS, conclusão depende do estado atual. Códigos inferidos da primeira ocorrência/categoria/descrição: BC, DRE, INF, BU, LI, PO, PA, ASF, CHU, GRE, MF, VOL, OUT; contatos Ouvidoria, Whats, Geral. Não é agenda nem cálculo de capacidade, e uma OS agrupada não implica múltiplos contatos. Os campos dos modelos de OS fornecidos orientaram emissor, solicitante, telefone, referência, recursos e justificativa; exemplos não foram importados como demandas reais e as caixas de prioridade do papel não são convertidas automaticamente.

### Mapa territorial

Leaflet/OpenStreetMap, atribuição visível, internet para mosaicos. Formulários continuam utilizáveis sem mapa-base. Alterna pontos/heatmap com os mesmos filtros e lista acessível; cada ocorrência tem peso igual, sobreposição/zoom alteram intensidade. Heatmap mede concentração, não risco/prioridade. Busca manual de endereço; ArcGIS e busca externa de endereço foram removidos. BC Digital é apenas origem de cadastro. GeoJSON atual é de pontos; não há camadas próprias de obras, vias ou interdições.

### Acessibilidade

Foco visível, Enter/Espaço em listas, setas/Home/End em abas de planejamento, modais com foco inicial/retenção/Escape nos fluxos tratados, rótulos e anúncios de status/erro, alternativas de mover por teclado/toque e layout móvel. Nomes de equipes acompanham cores. Kanban pode rolar horizontalmente dentro do quadro; isso não equivale a ausência universal de rolagem. Testes desktop/celular não são certificação WCAG; avaliação com tecnologias assistivas/usuários reais, contraste e observação operacional seguem pendentes.

## 5. Planejamento e planos de ação

**Status: IMPLEMENTADO.** Ranking por rua normalizada/bairro; candidatos de decisão separados também por setor. Normalização remove acentos, caixa, abreviações R./Av. e números de imóvel após separador explícito, preservando nomes de ruas numeradas. Grafias distintas, cruzamentos e endereços ambíguos exigem revisão humana; não utiliza proximidade para reconhecer equivalência de vias.

Decisão considera urgência, SLA original, idade e volume. Múltiplas demandas sugerem Alta, preservando Emergencial; sugestão não altera prioridade individual. Candidatos excluem reservas em plano e atendimentos com OS. Administrador/gestor cria plano PA com **1–100** demandas IDENTIFICADA/EM_TRIAGEM da mesma rua/bairro e setor, sem plano/OS prévia, objetivo, responsável e data. Uma ocorrência pertence a um único plano; novos registros não são incluídos silenciosamente. Não há edição/cancelamento ou inclusão posterior.

Demandas não triadas podem compor plano, mas precisam ser triadas para OS. Emissão aceita plano existente (ou inferido pelos vínculos); não mistura planos diferentes ou planejadas com não planejadas. Interface/API permitem plano + OS atômicos quando membros estão prontos: falha desfaz plano, reservas, ordem e auditoria da solicitação. Plano acompanha OS e estados dos membros: concluídas, canceladas e recusadas separadamente. Planejamento existente não implementa entidade própria de obra/intervenção.

## 6. Kanban compartilhado

**Status: IMPLEMENTADO.** Ocorrência sem OS é cartão de demanda; cada OS representa um item, mesmo com vários chamados. Não há cópia visual por ocorrência vinculada nem máquina de estados paralela. Arraste entre colunas abre confirmação/formulário da ação real, com classificação, programação, localização, evidências, relato ou motivo. Cancelar formulário mantém etapa; falha de atualização após sucesso permite atualizar sem repetir a ação. Fotos/materiais podem ser registrados no detalhe antes de tentar movimentar.

Dentro da coluna, soltar sobre cartão insere antes; espaço livre envia ao fim; seta coloca no topo. Ordem persistida compartilhada, com prioridade/antiguidade para novos cartões. “Mover” oferece alternativa ao arraste e puxador de pontos auxilia no celular. Filtros: setor, equipe/sem equipe, prioridade e busca; encerrados podem ser exibidos. Busca, carga e regras recolhíveis.

WIP por etapa é **global**, salvo em settings; zero é ilimitado. Administrador/gestor configura 0–999. Servidor bloqueia aumento de ocupação acima do limite em qualquer tela e desfaz mudanças/auditoria/vínculos na transação. Reduzir limite abaixo da ocupação permite esvaziar, mas impede novas entradas; reordenar/atualizar cartão já presente não usa outra vaga. Revisão diária deve observar devoluções, prazos, antiguidade e capacidade sem presumir que limite representa disponibilidade de equipe.

Configuração/ordenação compara revision; conjunto de cartões precisa ser completo e atual. Ações podem conferir kanban_expected_status. Esses controles são complementados por version nas edições de ocorrência/OS; planos também retornam version, sem API de edição. Proteção distribuída de WIP permanece pendente.

| Indicador | Semântica atual |
| --- | --- |
| OS em andamento | OS não concluídas/canceladas, incluindo espera, validação e devolução |
| Entregas em 30 dias | OS **atualmente CONCLUIDA**, com completed_at nos últimos 30 dias; uma por OS |
| OS mais antiga | Maior idade desde criação inicial entre OS abertas |
| Ciclo médio em 30 dias | Média criação inicial → completed_at das OS atualmente concluídas no período |

Setor/equipe restringem métricas; busca/prioridade/ocultação de encerradas não mudam seu histórico considerado. Reprogramação preserva criação; recusadas/canceladas não contam entregas, reabertura retira a OS das concluídas. Datas inválidas/ausentes não geram ciclos/idades, ausência de amostra mostra traço. SLA não é previsão estatística. Referência conceitual: [The Kanban Guide](https://kanbanguides.org/the-kanban-guide/2025.5/).

## 7. Materiais, notas fiscais, estoque e custos

**Status: PARCIAL.** Estoque básico já existe: almoxarifado, entradas/saídas manuais auditadas, saldo, custo médio ponderado das entradas, valor de estoque, consumo de 90 dias, média mensal, estoque mínimo e sugestão de compra (consumo de 90 dias + mínimo − saldo, limitado a zero). Não é previsão de demanda nem módulo completo de inventário.

Consumo na OS exige quantidade positiva, preserva custo unitário histórico e, para material com movimentos de estoque, gera saída e bloqueia saldo insuficiente. Equipamentos são vinculados; não há reserva/agenda de equipamentos. Materiais sem controle por movimentos usam cadastro/custo vigente conforme regra do consumo.

PDF de nota até 15 MB é extraído como RASCUNHO para revisão humana; PDF sem texto/sem itens requer preenchimento manual, sem OCR. Confirmação valida fornecedor/número/itens, impede confirmação repetida e duplicata de fornecedor+número, registra compra como entrada e aplicação como saída se vinculadas a material. Quantidade usada não supera comprada; etapas de custo: registro, triagem, execucao, validacao, outros. Extração não confirma estoque automaticamente. PDFs ficam em data/invoices, com acesso autorizado à OS.

Há custo de consumption (quantidade × custo histórico) e custo real de saídas de estoque por OS/etapa; são métricas distintas, não devem ser somadas automaticamente. Aplicação direta de nota gera movimentos e não necessariamente registro em consumption; não presumir que satisfaz exigência de material da conclusão. Não há composição completa de mão de obra, equipamento, veículos, combustível, contratos ou serviços terceiros.

Reservas, devoluções estruturadas, múltiplos almoxarifados, transferências e inventários completos são P2; alertas de saldo e sugestão básica de reposição já existem.

## 8. Campo, offline e notificações

**Status: IMPLEMENTADO / offline PARCIAL.** /campo possui Tarefas, Registrar, Meus registros; somente perfil Equipe de Campo com módulo Campo liberado entra na interface móvel. GPS/câmera dependem de permissão do dispositivo. “Como chegar” abre app de mapas, sem roteamento próprio.

Rascunhos por usuário em IndexedDB: campos/foto de registro, fotos antes/depois pendentes e relato. Envio manual; falhas preservam rascunho. request_id estável evita duplicidade de ocorrência/anexo nos reenvios suportados. Rascunho pertence ao navegador/aparelho e se perde ao limpar seus dados. Login, abertura de OS e gravações precisam de rede; não há cache autenticado de OS, execução offline completa ou sincronização em background. Service worker oferece página offline e push, sem cache de respostas autenticadas.

Push opcional: HTTPS, VAPID, compatibilidade e permissão do usuário. Assinaturas por aparelho são removidas no logout. Distribuição/reprogramação e reabertura geram jobs. Worker a cada 15 segundos, até cinco tentativas, verifica atribuição atual e remove assinaturas expiradas; chamada externa ocorre fora da fila serial de banco. Entrega ambígua pode repetir notificação, tag da OS permite substituição. Testes usam serviço simulado; instruções de instalação/aparelho estão em DEPLOYMENT.md.

## 9. Arquitetura e persistência vigentes

**Status: IMPLEMENTADO; modularização PARCIAL.** Monólito modular em evolução, um processo Express; React 19/TypeScript/Vite; Node 24+; Leaflet/OSM; SQLite ou PostgreSQL/PostGIS; disco local e Web Push. Não há microserviços. Extração incremental em server/modules/{concurrency,listing,files}, src/modules/{map,administration} e src/shared; entrypoints ainda concentram parte do domínio.

| Responsabilidade | Código vigente |
| --- | --- |
| Interface de gestão/integração | src/main.tsx, src/styles.css |
| Painel/fluxo | OperationsDashboard, WorkflowGuide, DispatchContext |
| Planejamento/Kanban | PlanningPanel, PlanningPlanDialog, TeamKanban, KanbanMoveDialog; modelos em shared/ |
| Campo e rascunhos | src/Operator.tsx, src/field-storage.ts, public/sw.js |
| Setor, estoque e notas | SectorControl, InventoryPanel, InvoicePanel |
| HTTP, autorização, transações | server/app.js |
| Estados, permissões, credenciais | server/domain.js, server/domain/workflow.js |
| Módulos operacionais | server/planning.js, kanban.js, field.js, inventory.js, invoices.js, sector-control.js |
| Persistência/seed | server/db.js, server/schema.sql, server/seed.js |

users guarda perfil/equipe; sessions guarda hash do token e expiração. catalogs usa discriminador kind e atributos JSON em texto; secretaria/departamento/setor usam parent_id, categorias/equipes sector_id. API verifica tipos/vínculos. occurrences e orders mantêm campos indexáveis e atributos JSON; order_occurrences liga N:N. action_plans/action_plan_occurrences preservam reserva única. evidence é polimórfica por tipo/ID; consumption preserva custos; order_equipment liga recursos; invoices/invoice_items/inventory_movements registram notas/estoque. audit_logs é histórico imutável pela interface, settings configura município/raio/quadro; client_requests/push_subscriptions/push_jobs suportam campo. assets/maintenance_plans são tabelas reservadas sem telas/geração preventiva automática.

Sem DATABASE_URL: SQLite/WAL e data/urban.sqlite; com DATABASE_URL: adaptador PostgreSQL, ponto geom gerado de lng/lat em SRID 4326 e índice GiST. Inicialização requer habilitar PostGIS. Trocar URL não transfere dados. Migrations vigentes **1–9**, em server/db.js/esquema base; não há diretório migrations/. Detalhes de atualização/backup/restauração em DEPLOYMENT.md.

Uma conexão e fila serial no processo evitam entrelaçamento; mutações operacionais com histórico/jobs usam transação. Não equivalem a locking distribuído. Upload ocorre antes do commit; limpeza de erro cobre fluxos tratados, mas falha entre disco e banco pode deixar órfãos. Vínculos polimórficos de arquivo e catálogos dependem de validação API, sem FK específica por tipo. FileStorage local/object injetável integrado aos anexos e notas; arquivos existentes preservados. Homologação real do provider externo pendente. Homologação real PostgreSQL/PostGIS e Docker não consta na base de testes.

## 10. APIs e convenções gerais

**Status: IMPLEMENTADO / escalabilidade PARCIAL.** Grupos: autenticação/bootstrap; ocorrências/triagem/duplicidade; OS/execução/evidências; planejamento; Kanban; campo/push; catálogos/admin/auditoria; mapa/painel/controle de setor; almoxarifado/notas. JSON e cookie de sessão; arquivos multipart; validação Zod, autorização no backend, transações e erros estruturados. Detalhes exclusivos em [API](API.md).

Filtros de ocorrência/OS/GeoJSON agora são SQL; ocorrência/OS/auditoria aceitam cursor/limit, e UI de listas usa páginas de 50. Auditoria possui pesquisa paginada. Arrays legados são preservados para consumidores operacionais ainda não migrados; movimentos de estoque possuem consulta paginada e saldos agregados SQL (legacy retorna até 100). Mapa/proximidade/painel/planejamento ainda leem conjuntos amplos.

Optimistic locking das edições de ocorrência/OS **IMPLEMENTADO** no checkpoint de 2026-10-02 (migration 5, comparação WHERE id/version, versão obrigatória). Planos recebem version sem API de edição; adições preservam regras próprias. Proteção distribuída de estoque/WIP/numeração permanece pendente. 409 já sinaliza transição/duplicidade/WIP/revision/etapa incompatíveis; não significa que toda entidade protege edição concorrente. Paginação/locking/storage/auditoria pesquisável são P0.

## 11. Estado atual, limitações e prioridades

| Tema | Status | Situação |
| --- | --- | --- |
| State machine, fluxo, recusa/devolução, planos e Kanban | IMPLEMENTADO | Regras vigentes acima, sem novas entidades P1 |
| Documentação canônica | IMPLEMENTADO | Cinco documentos especializados/contextuais; consolidação registrada no Changelog |
| Concorrência | PARCIAL | version obrigatório nas edições de ocorrência/OS; revision/etapa no quadro; estoque/WIP/numeração entre processos pendentes |
| Estoque/custos | PARCIAL | Notas, movimentos e materiais; gestão completa P2 |
| Offline | PARCIAL | Rascunho/reenvio manual; sincronização completa P3 |
| PostgreSQL/PostGIS | PARCIAL | Adaptador e geom; homologação real pendente |
| Modularização | PARCIAL | Módulos existentes, arquivos centrais grandes |
| Capacidade/território | PARCIAL | Carga/WIP/agrupamento textual; jornada/geometria ampliada P1 |
| Obras/intervenções/vias/mobilidade | PLANEJADO | Nenhuma entidade/módulo completo entregue |

Bundle inicial reduzido de 584,21 para 318,55 kB (JS minificado); módulos carregados por demanda. Limites: escala horizontal sem proteção distribuída; arquivos locais; sem serviço S3/SSO ativado, portal cidadão, comunicação ao solicitante, app nativo, roteirização própria ou integração BC Digital/Waze/OSRM/Google Routes. Recuperação central de sessão e feedback uniforme pendentes. Observação de usuários reais e acessibilidade completa não realizadas. Piloto SQLite em instância única é diferente de recomendação de produção municipal.

### Ordem recomendada de evolução

P0: locking/UX de conflitos, paginação/filtros SQL, auditoria pesquisável, FileStorage, homologação PostgreSQL/PostGIS, modularização/código por demanda e testes adicionais. State machine já centralizada; checkpoints desta revisão implementam edições versionadas, listas/auditoria paginadas, filtros SQL, FileStorage e code splitting. Homologação real PostgreSQL/PostGIS e consultas amplas de painel/planejamento/quadro permanecem abertas. Preservar fluxos, idempotência, evidências, restrições de setor/operador, auditoria, WIP e rollback.

P1: entidades opcionais de obra/intervenção, vias/geometria, duração e capacidade estimada, camadas espaciais/bbox/conflitos, WIP GLOBAL/SECTOR/TEAM com precedência TEAM → SECTOR → GLOBAL. Manutenção simples continua independente. Migrations futuras aditivas; versões 5/6/7 sugeridas na auditoria eram hipóteses, não reservas ou entregas. Confirmar numeração no código antes de implementar; não editar versões 1–4.

P2: cronograma, custo completo, estoque completo, inspeções, medições, progresso físico-financeiro, mobilidade/providers/interdições/impacto. P3: portal cidadão, comunicação, offline completo/sincronização/conflitos, BI e predição apenas com histórico confiável. P3 não deve antecipar pendências estruturais de P0–P2.

## 12. Especificações futuras preservadas

**Status: MISTO — especificações futuras com checkpoints P0 explicitamente marcados.** Obras/intervenções/mobilidade permanecem diretrizes futuras; itens técnicos já entregues abaixo têm status próprio. Não presumir que interfaces conceituais sejam contratos HTTP vigentes.

### Custos, estoque e fiscalização — P2

Centros de custo por obra/intervenção/OS: MATERIAL, LABOR, EQUIPMENT, VEHICLE, FUEL, CONTRACT, THIRD_PARTY_SERVICE, OTHER. Estoque deve evoluir para almoxarifados, reservas/devoluções, transferências, inventários e reposição completa, preservando os movimentos básicos existentes. Inspeções devem ter templates/checklists, fotos/GPS, parecer, não conformidades, prazo e resolução; resultados Conforme, Conforme com ressalvas, Não conforme.

### Capacidade — P1

Estimar membros ativos, horas/dias/jornada, duração de OS, compromissos, turnos, ausências e deslocamentos. Apresentar como capacidade estimada, sem transformar contagem de OS em garantia de disponibilidade.

### Auditoria pesquisável — P0/P2

**Status: IMPLEMENTADO para entidades atuais.** Consulta por `entity_type`, `entity_id`, `user_id`, `event`, `from`, `to`, `cursor` e `limit`, com índices, filtros SQL e painel de pesquisa. P2 deve também auditar obras/fases/progresso, interdições, medições, inspeções, não conformidades, estoque/custos e análises de impacto viário. Preservar valores anteriores/novos e proibir alteração silenciosa de histórico.

### Relações e território — P1

**Status: PLANEJADO.** Intervenções poderão agrupar ocorrências/OS, área/trecho/ativo, período, responsável, prioridade e geometria, com vínculo opcional a obra. Obras poderão reunir intervenções, OS, documentos e os recursos P2 de cronograma/custos/fiscalização/medições. Identificar conflitos espaciais e temporais entre intervenções, consultar camadas por viewport/bbox e permitir correção humana de associações automáticas. A modularização deve preparar esses módulos sem tornar obra obrigatória para manutenção simples.


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

**Status: PLANEJADO.**

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

**Status: PARCIAL — listas ocorrência/OS/auditoria/movimentos paginadas; consumidores operacionais amplos permanecem.**

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

Testes em tests/ cobrem regras, API, persistência, permissões, estados válidos/inválidos, transações/rollback, campo/idempotência, evidências, estoque/notas, planejamento, distribuição, Kanban/métricas/WIP e setor. Scripts de navegador cobrem desktop/celular, toque/teclado, campo e navegação. Contagens/datas das verificações pertencem a CHANGELOG.md; não comprovam carga, Docker, PostgreSQL real, integração externa ou certificação WCAG.

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
6. Inspecione código, migrations em server/db.js/server/schema.sql e testes existentes.
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
