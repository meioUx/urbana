# Urbana · Gestão de Manutenção Municipal

Aplicação web para registrar demandas, programar ordens de serviço e acompanhar execução e validação municipal. React + TypeScript no frontend, Express com sessão autenticada no backend e SQLite local ou adaptador PostgreSQL/PostGIS.

O fluxo operacional é **Demanda → Triagem → Programação → Execução → Validação → Conclusão**. Uma ocorrência representa a demanda; uma Ordem de Serviço (OS) organiza seu atendimento e pode reunir mais de uma ocorrência.

## Recursos disponíveis

| Área | Funcionalidades |
| --- | --- |
| Visão geral | Indicadores e acompanhamento de estados, prioridades, bairros, prazos e carga das equipes |
| Ocorrências e triagem | Registro com localização e evidências, identificação de duplicidade, classificação, recusa justificada e filas A analisar / Prontas para programar |
| Programação e OS | Seleção de equipe do mesmo setor, atribuição para equipe ou operador, consulta da carga e acompanhamento do atendimento |
| Planejamento | Priorização por urgência, prazo, idade e volume; planos de ação com uma ou mais demandas e emissão de plano + OS na mesma transação |
| Kanban | Cartões de demanda e OS agrupada, filtros, ordenação compartilhada, limites WIP e movimentação por arraste, teclado ou toque |
| Mapa territorial | Pontos e mapa de calor, filtros, lista de atendimentos e acesso aos detalhes e evidências |
| Campo (`/campo`) | Minhas tarefas, assumir atendimento, chegada, fotos antes/depois, materiais, equipamentos, relato, envio para análise e devolução justificada |
| Análise de campo | Conferência de relato e evidências, validação e reabertura com motivo |
| Equipes e controle do setor | Estrutura das equipes, carga registrada e acompanhamento dos serviços e contatos do setor |
| Materiais e equipamentos | Almoxarifado, notas fiscais com revisão antes da confirmação, movimentações de estoque e consumo relacionado às OS |
| Administração | Usuários, perfis, liberações individuais de módulos, cadastros, configurações e auditoria |
| Ajuda e onboarding | Boas-vindas por perfil, treinamento contextual e tutoriais individuais acessíveis pela Ajuda |

As regras operacionais continuam obrigatórias: triagem prepara a demanda; gestão programa; campo executa; **Enviar para análise** deixa a OS em **Aguardando validação**. Gestão/fiscalização confere antes da conclusão definitiva. Devolução exige justificativa e reabertura exige motivo. Algumas exigências de fotos, materiais e equipamentos dependem da categoria.

## Executar

Requer **Node.js 24 ou superior**. No PowerShell, utilize `npm.cmd` quando a política local bloquear `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Acesse http://127.0.0.1:3000. Para desenvolvimento com atualização automática, use `npm.cmd run dev`. `PORT` escolhe a porta; `HOST` é `127.0.0.1` por padrão. Variáveis de `.env` são carregadas na inicialização; consulte [.env.example](.env.example).

Na primeira execução, o banco e o seed são criados. Os exemplos usam Balneário Camboriú como referência geográfica e não representam demandas reais.

| Perfil de demonstração | E-mail | Senha inicial |
| --- | --- | --- |
| Administrador / master de manutenção | admin@urbana.local | Urbana@2026 |
| Gestor | gestor@urbana.local | Urbana@2026 |
| Triagem | triagem@urbana.local | Urbana@2026 |
| Equipe de Campo | campo@urbana.local | Urbana@2026 |
| Fiscalização | fiscal@urbana.local | Urbana@2026 |
| Consulta | consulta@urbana.local | Urbana@2026 |

`ADMIN_PASSWORD` substitui a senha inicial das contas criadas pelo seed, sem redefinir usuários existentes. Para instalação real, use banco novo, `DEMO_DATA=false`, senha própria e HTTPS com `SECURE_COOKIE=true`, seguindo [Implantação](docs/DEPLOYMENT.md).

## Atualizar uma instalação existente

Faça backup consistente do banco e dos arquivos antes da atualização. Com o código atualizado:

```powershell
npm.cmd ci
npm.cmd run build
```

Encerre o processo anterior do Urbana e inicie novamente com `npm.cmd start`. O servidor precisa reiniciar para carregar as novas regras e aplicar as migrations; recompilar a interface não atualiza um backend que já está em execução. Depois, atualize a página e confira login, módulos e operação.

As migrations **1–9** são verificadas na inicialização. A migration **8** inicializa as liberações individuais de módulos dos usuários existentes; a **9** registra as tabelas de progresso e eventos do onboarding. Liberações comuns não são redefinidas a cada login ou reinício. A conta master mantém sua exceção permanente.

Sem `DATABASE_URL`, os registros ficam em `data/urban.sqlite`; anexos em `data/uploads` e PDFs de notas em `data/invoices`. Não remova esses dados ao atualizar. Trocar `DATABASE_URL` não transfere registros nem arquivos automaticamente. Consulte [backup, atualização e restauração](docs/DEPLOYMENT.md).

## Autorização e conta master

Somente Administradores podem criar usuários, alterar perfis e gerenciar módulos. Para contas comuns, o perfil define as ações permitidas e os módulos liberados definem as áreas acessíveis. Liberar um módulo não concede poderes de outro perfil. O menu, as rotas diretas e a API aplicam essas regras.

A conta **`admin@urbana.local`**, com perfil Administrador, é o **acesso master de manutenção**:

- Todos os módulos do catálogo ficam permanentemente disponíveis, incluindo `/campo` e novos módulos adicionados ao catálogo.
- A conta pode executar as ações desses módulos, mantendo autenticação, auditoria e todas as validações operacionais.
- Remover liberações persistidas não retira seu acesso; ao salvar a conta, todos os módulos são mantidos.
- E-mail e perfil são protegidos na gestão de usuários; os módulos aparecem marcados e bloqueados para remoção.

Essa é a exceção às restrições comuns. Outros Administradores não executam OS em Campo; `/campo` e execução são exclusivos da Equipe de Campo para as demais contas. Consulta permanece somente leitura para dados operacionais, podendo salvar seu próprio progresso de treinamento.

Usuários comuns sem módulos recebem **Sem módulos disponíveis**, com orientação para procurar o Administrador. Não há tour automático nesse estado. A [documentação de autorização](docs/AUTORIZACAO.md) contém a matriz, os contratos e as regras de persistência.

## Onboarding e Ajuda

No primeiro acesso à versão atual do treinamento, o Urbana apresenta nome, perfil, fluxo geral e responsabilidade do usuário. O percurso usa até seis etapas nas telas reais, explicando o que conferir, qual ação faz o trabalho avançar, para quem ele segue e como tratar exceções.

| Perfil | Processo ensinado |
| --- | --- |
| Administrador | Configurar, estruturar, criar usuários, liberar acessos e acompanhar |
| Gestor | Priorizar, programar, distribuir, acompanhar e resolver exceções |
| Triagem | Receber, analisar, classificar e encaminhar |
| Equipe de Campo | Receber, assumir, chegar, executar, registrar e enviar |
| Fiscalização | Receber, conferir informações/evidências, validar ou reabrir |
| Consulta | Pesquisar, localizar, consultar e acompanhar |

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

## Mapas e uso móvel

O mapa Leaflet usa **OpenStreetMap por padrão**, com atribuição dos colaboradores. URL, atribuição e zoom do provider podem ser configurados antes do build. A grade local sem cartografia exige configuração explícita de `VITE_MAP_TILE_URL=/map-development-tile.svg`. Consulte [configuração e diagnóstico dos tiles](docs/MAP-TILES.md).

GPS/mapa e endereço manual localizam registros; não há integração ArcGIS. Campo guarda rascunhos no aparelho e permite reenvio manual, mas não oferece sincronização offline completa. GPS e câmera dependem de permissão do dispositivo. Web Push exige configuração e validação real do aparelho conforme [Implantação](docs/DEPLOYMENT.md).

## Testes

```powershell
npm.cmd test
npm.cmd run build
# Testes de navegador: Microsoft Edge instalado e build atualizado.
npm.cmd run test:ui
npm.cmd run test:field
npm.cmd run test:kanban
npm.cmd run test:map
npm.cmd run test:authorization
npm.cmd run test:onboarding
```

Testes de API/regras e scripts de navegador usam bancos temporários isolados. Os scripts de navegador servem a aplicação compilada e salvam capturas em `test-results/`. Testes de mapa usam tiles simulados, sem baixar tiles reais do OpenStreetMap.

A cobertura inclui autenticação, módulos, perfis, conta master, ciclo operacional, evidências, auditoria, rollback, idempotência, planejamento, notas/estoque, setor, Kanban e onboarding. O treinamento é verificado nos seis perfis, em mobile, com retomada, repetição, ausência de módulos/tarefas/alvos e preservação dos dados operacionais.

Na verificação de **2026-10-02**, a suíte geral teve **64 aprovados, zero falhas e 1 não executado** (PostgreSQL/PostGIS sem `URBANA_POSTGRES_TEST_URL`); build e testes de navegador de autorização, onboarding e Campo foram aprovados. Execução local não homologa Docker, PostgreSQL/PostGIS real, push externo, leitor de tela, aparelho físico ou carga municipal. Resultados das entregas estão no [Changelog](docs/CHANGELOG.md).

## Documentação

- [Contexto mestre: domínio, fluxos, arquitetura e roadmap](docs/URBANA-CONTEXTO-MESTRE.md)
- [Autorização, matriz de módulos e conta master](docs/AUTORIZACAO.md)
- [Onboarding e treinamento por perfil](docs/ONBOARDING.md)
- [API REST](docs/API.md)
- [Implantação, migrations, backup e restauração](docs/DEPLOYMENT.md)
- [Mapas e provider de tiles](docs/MAP-TILES.md)
- [Changelog](docs/CHANGELOG.md)
- [Decisões arquiteturais](docs/DECISIONS.md)

O contexto mestre distingue funcionalidades implementadas, parciais e planejadas. Use-o como referência antes de alterar o domínio ou a arquitetura.
