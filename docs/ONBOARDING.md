# Onboarding e treinamento do Urbana

Entrega verificada em 2026-10-02. Versão do conteúdo: **1**. Migration do banco: **9**. A implementação ensina processo, responsabilidade, próximo passo e exceções nas telas existentes.

## Diagnóstico anterior

Não havia onboarding de primeiro acesso com progresso próprio, versão, boas-vindas e central de tutoriais. O componente existente `WorkflowGuide` explica andamento e próximo passo de uma ocorrência/OS aberta; continua útil e foi preservado. A nova camada complementa essa orientação com treinamento de entrada e consultas posteriores.

## Arquitetura

- `shared/onboarding.mjs` centraliza jornadas, responsabilidades, textos, etapas, alvos, estados e tutoriais individuais. Reutiliza o catálogo e as regras de `shared/authorization.mjs`.
- `OnboardingEntry` decide a entrada automática após bootstrap, oferece Ajuda em todos os ambientes autenticados e carrega `Training` por lazy import.
- `Training` gerencia boas-vindas → papel no fluxo → treinamento → checklist. Navega às telas reais por eventos internos, posiciona destaques e mantém o progresso na API.
- Componentes operacionais preparam apenas a visualização: abrem detalhe existente, aba ou formulário vazio real. A página fica inerte durante a explicação. Não há preenchimento fictício, submissão automática, mudança de estado, upload ou criação de OS para avançar.
- `server/onboarding.js` fornece os endpoints autenticados, valida o tutorial contra a autorização vigente e persiste exclusivamente o progresso do usuário da sessão.

Não há biblioteca de tour nem dependência nova. Build: chunk Training de aproximadamente 40 kB JS / 12 kB gzip, CSS de 6 kB / 1,8 kB gzip, carregado somente quando a apresentação ou Ajuda é aberta. Quem já concluiu/pulou não baixa esse chunk automaticamente.

## Persistência e versão

`user_onboarding`: chave composta `user_id + onboarding_version + tutorial_id`. Campos: `status`, `started_at`, `skipped_at`, `completed_at`, `step_id`, `updated_at`. Tutorial principal: `main`; individuais: `task:<id>`.

Ausência de registro significa `not_started`. Iniciar/avançar registra `started`. Pular registra `skipped`, sem conclusão. Completar registra `completed`. Repetir ou pular algo já concluído preserva a data e o status da primeira conclusão. Tutoriais têm progresso independente e podem ser marcados como vistos ao avançar a etapa correspondente do treinamento principal.

A última etapa apresentada permite retomar um fluxo interrompido. A tela inicial oferece Continuar meu fluxo. Ajuda permite repetir desde o início. Fechar impede outra abertura automática na mesma sessão; pular/concluir impede também nos próximos acessos. Falha de persistência exibe aviso e opção de tentar novamente; a interface continua utilizável. Sem persistência bem-sucedida, não se garante progresso entre sessões.

`ONBOARDING_VERSION` está no arquivo compartilhado `onboarding-version.mjs`; incrementá-lo quando uma mudança justificar novo treinamento. Os registros antigos permanecem no banco e a nova versão começa sem progresso. Não altere IDs de etapas da mesma versão sem considerar a retomada.

As tabelas são criadas idempotentemente pelo esquema base; a migration 9 registra sua disponibilidade. Não há reescrita de usuários, permissões ou dados operacionais. "Primeiro acesso" significa primeiro acesso à versão atual, inclusive para usuários existentes após a atualização.

`onboarding_events` registra apenas usuário, versão, tutorial, tipo de evento e horário; não copia relato, fotos, localização ou dados do serviço. Eventos internos started/skipped/completed/replayed não usam analytics externo. SAVEPOINT isola falha de telemetria para preservar o progresso.

## Fluxos por perfil

O fluxo geral é Demanda → Triagem → Programação → Execução → Validação → Conclusão. A apresentação indica onde o perfil participa; Administrador prepara a estrutura e Consulta acompanha as informações.

| Perfil | Processo ensinado | Etapas principais completas |
| --- | --- | --- |
| Administrador | Configurar → Estruturar → Criar usuários → Liberar acessos → Acompanhar | Configuração, estrutura/catálogos, equipes, usuários, módulos, auditoria (6) |
| Gestor | Priorizar → Programar → Distribuir → Acompanhar → Resolver exceções | Demandas prontas, mapa, planejamento opcional, programação/distribuição, acompanhamento, devoluções (até 6) |
| Triagem | Receber → Analisar → Classificar → Encaminhar | Fila, informações da demanda, classificação, recusa justificada, passagem à gestão, mapa (6) |
| Equipe de Campo | Receber → Assumir → Chegar → Executar → Registrar → Enviar | Minhas tarefas, assumir, chegada/foto antes, execução/materiais, relato/foto depois/envio, impossibilidade/devolução (6) |
| Fiscalização | Receber → Conferir informações → Conferir evidências → Validar ou reabrir | Fila, detalhe, evidências, validação, reabertura com motivo, mapa (6) |
| Consulta | Pesquisar → Localizar → Consultar → Acompanhar | Visão geral, filtros, ocorrência, OS, mapa (até 5), sem ações de edição |

Etapas agrupam tarefas relacionadas para manter o fluxo curto. Registrar e Distribuir continuam na sequência visual mesmo quando agrupados com Enviar/Programar. Cada etapa apresenta o que conferir/fazer e o que acontece depois; a conclusão lista somente as etapas efetivamente apresentadas.

A operação é ensinada como existe: ocorrência é diferente de OS; triagem prepara, gestão programa; campo executa; Enviar para análise deixa Aguardando validação; gestão/fiscalização valida conforme autorização; devolver exige justificativa e reabrir exige motivo. Não se altera uma OS para conseguir mostrar o próximo estado: o guia abre registros reais no estado adequado ou apresenta a área vazia correspondente.

## Ajuda, autorização e ausência de conteúdo

Ajuda → Como usar o Urbana oferece Conhecer o Urbana e tutoriais individuais contextualizados. Além das etapas principais, Campo tem foto antes, foto depois e relato; Gestor tem distribuição para equipe/operador e acompanhamento da carga registrada. Itens vistos recebem indicação de conclusão.

Perfil define ações; módulos liberados definem áreas acessíveis. Cliente e servidor usam a mesma filtragem. Gestor com apenas Dashboard, Mapa e OS vê somente essas áreas, sem Planejamento, Administração, Auditoria ou Campo. Acesso a um módulo não concede outra função. `/campo` e execução permanecem exclusivos da Equipe de Campo. Consulta só persiste aprendizagem própria, sem exceção para mutações operacionais.

Sem módulos válidos não há apresentação automática nem tutorial. Ajuda explica a falta de acesso e orienta procurar o administrador. Usuário com apenas módulo secundário recebe orientação de consulta contextual ao módulo autorizado.

Alvos `data-guide` ficam nos componentes reais. O guia espera a renderização; sem ação aplicável, destaca o detalhe ou a lista real e explica o estado vazio. Se alvo e fallback estiverem ausentes, avança sem travar. Se apenas a etapa final estiver ausente, conclui o conteúdo apresentado e omite o item indisponível do checklist. Se nenhuma etapa puder ser mostrada, informa isso e não grava conclusão fictícia. Troca de tela/mapa completo reaponta o destaque; mudança de autorização recalcula o conteúdo.

## Mobile e acessibilidade

Desktop usa cartão contextual e destaque. Campo em celular usa cartão inferior com altura limitada e controles fixos; espaço temporário de rolagem mantém a ação destacada acima do cartão. Esse espaço é removido ao fechar. ResizeObserver e visualViewport recalculam posição e tamanho; conteúdo longo rola dentro do cartão.

Diálogos têm rótulo e descrição, botões com nomes acessíveis, anúncio educado de etapa, foco inicial/visível, contenção de Tab/Shift+Tab e restauração de foco ao fechar. Escape pula apresentação/tour ou fecha Ajuda. O restante da página fica inerte durante a explicação. Status/etapas têm texto além de cor. prefers-reduced-motion elimina animações. Há botões visíveis para pular, voltar, avançar e concluir.

## Arquivos desta entrega

Criados:

- `shared/onboarding-version.mjs`, `shared/onboarding-version.d.mts`, `shared/onboarding.mjs`, `shared/onboarding.d.mts`.
- `server/onboarding.js`.
- `src/onboarding/OnboardingEntry.tsx`, `src/onboarding/Training.tsx`, `src/onboarding/onboarding.css`.
- `tests/onboarding.test.js`, `tests/onboarding-browser.mjs`, `tests/onboarding-fixture.mjs`.
- `docs/ONBOARDING.md`.

Alterados para onboarding:

- `server/app.js`, `server/db.js`, `server/schema.sql`, `shared/authorization.mjs`: bootstrap, endpoints, persistência e exceção restrita ao progresso próprio.
- `src/main.tsx`, `src/Operator.tsx`, `src/modules/map/TerritorialView.tsx`, `src/styles.css`: entrada global, preparo de visualizações reais, alvos e Ajuda.
- `package.json`: comando test:onboarding.
- `tests/browser.mjs`, `tests/authorization-browser.mjs`, `tests/territorial-browser.mjs`, `tests/sector-browser.mjs`, `tests/kanban-browser.mjs`, `tests/field-browser.mjs`, `tests/p0-browser.mjs`: fixture pula onboarding nos testes operacionais antigos, que não exercitam primeiro acesso.
- `tests/map-browser-fixture.mjs`: mantém bloqueio padrão de service workers, permite habilitação explícita no teste offline de Campo. Esse teste antes bloqueava workers e aguardava serviceWorker.ready indefinidamente.
- `README.md`, `docs/API.md`, `docs/URBANA-CONTEXTO-MESTRE.md`, `docs/DEPLOYMENT.md`, `docs/CHANGELOG.md`.

Alterações anteriores de autorização já presentes no workspace foram preservadas.

## Testes e verificação

Testes adicionados cobrem as seis jornadas, filtragem de módulos/ações, ausência de módulos, versão nova, estados persistidos, replay sem perda de conclusão, progresso por tutorial, isolamento do usuário, payloads inválidos, preservação operacional, reinicialização do banco e falha opcional de telemetria.

O navegador exercita as seis jornadas completas, Gestor restrito, login de Campo em 390×844, ação destacada visível, retomada da etapa salva, mapa completo, Ajuda, tutoriais individuais, Escape, foco, reduced motion, ausência de tarefas, módulos, alvo e etapa final. Compara tabelas operacionais antes/depois e verifica ausência de requisições de escrita operacional.

Comandos executados nesta entrega:

- `npm.cmd run build`: TypeScript e Vite aprovados.
- `npm.cmd test`: 64 testes, 63 aprovados, zero falhas e 1 não executado (PostgreSQL/PostGIS).
- `npm.cmd run test:onboarding`: jornadas e cenários de onboarding aprovados.
- `npm.cmd run test:authorization`: navegador de autorização aprovado.
- `npm.cmd run test:field`: operação mobile, rascunho, retry sem duplicação, atribuição e revisão aprovados; sem erros de console.
- `git diff --check`: sem problemas de whitespace.

Limitações: PostgreSQL/PostGIS real não foi executado, pois URBANA_POSTGRES_TEST_URL não está configurada. Acessibilidade foi verificada programaticamente e por teclado; não houve homologação com leitor de tela ou aparelho físico. Mapas usam tiles simulados nos testes. Tutoriais explicam ações sem executá-las; sua conclusão indica apresentação do conteúdo, não certificação de competência nem execução real da tarefa. Não houve implantação em produção.

## Conta master de manutenção

Por definição, `admin@urbana.local` com perfil Administrador tem acesso permanente a todos os módulos do catálogo, incluindo /campo, e às ações de manutenção desses módulos. É a única exceção às restrições comuns de perfil/Campo. Novos módulos do catálogo ficam disponíveis automaticamente. Remover liberações persistidas não retira o acesso master; ao salvar essa conta, o servidor grava novamente todos os módulos.

E-mail e perfil da conta são protegidos na edição administrativa. A interface mostra todos os módulos marcados e bloqueados para remoção. Nome pode ser editado. A autenticação, sessão, auditoria, validação de versão, estados, evidências, justificativas e demais regras operacionais continuam exigidas. Outros administradores permanecem sujeitos aos módulos liberados e não executam em Campo.

A identidade é verificada no servidor a partir do usuário autenticado; informar o e-mail no corpo de uma requisição não concede acesso master. Implementação compartilhada: isMasterUser, canPerformAction e hasModuleAccess; userModules resolve todos os módulos do catálogo para essa conta sem depender de migração ou reaplicação do seed.
