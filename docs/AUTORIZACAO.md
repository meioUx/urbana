# Autorização do Urbana

Somente usuários com perfil Administrador podem criar usuários, alterar perfis e gerenciar liberações de módulos.
O acesso a módulos não concede poderes adicionais ao perfil.
O ambiente `/campo` é exclusivo do perfil Equipe de Campo, inclusive suas APIs e ações de execução. Administrador e Gestor não executam OS.

## Catálogo e matriz

`shared/authorization.mjs` centraliza módulos reais, rotas, compatibilidade, sugestões, ações funcionais, destino de login e dependências das APIs. A Administração contém Usuários, Cadastros, Configurações e Auditoria, que são abas reais da mesma tela; não foram criados módulos independentes fictícios. Materiais contém o almoxarifado existente.

Acesso efetivo = compatibilidade do perfil × módulo individual liberado × ação funcional permitida. Não existem liberações individuais de ações nem checkbox de administrar permissões. A matriz é um limite obrigatório também para Administradores. Consulta é somente leitura; materiais/estoque são consultáveis quando liberados, com formulário de ajuste oculto e mutações recusadas.

| Perfil | Sugestão inicial / migração 8 |
| --- | --- |
| Administrador | Visão geral, Mapa, Ocorrências, Triagem, Kanban, Planejamento, OS, Controle do setor, Análise de campo, Equipes, Materiais, Equipamentos, Administração |
| Gestor | Mesmos módulos operacionais acima, sem Administração e sem Campo |
| Triagem | Visão geral, Mapa, Ocorrências, Triagem, Kanban |
| Equipe de Campo | Campo |
| Fiscalização | Visão geral, Mapa, Ocorrências, OS, Análise de campo, Kanban |
| Consulta | Visão geral, Mapa, Ocorrências, OS, Kanban, Planejamento, Equipes, Materiais, Equipamentos |

A migração inicializa os usuários existentes uma única vez com módulos compatíveis; o seed faz o mesmo para a instalação nova. Mantém os acessos de consulta e operação compatíveis com as responsabilidades novas. As antigas possibilidades de executar como Administrador/Gestor, usar Campo com outros perfis, e acessar módulos incompatíveis são intencionalmente retiradas. Não reaplica padrões no login ou reinício: uma lista vazia continua vazia. Concessões são persistidas em `user_module_permissions`, com timestamps e chave usuário/módulo. A migração é transacional em SQLite e PostgreSQL.

## Administração e APIs

- `POST /api/users`: dados existentes e `modules: string[]`. Ausência de modules usa a sugestão do perfil; lista vazia é respeitada. Valores desconhecidos/incompatíveis retornam 400.
- `GET /api/users/:id/permissions`: dados públicos do usuário, módulos efetivos e catálogo. Exclusivo do Administrador.
- `PATCH /api/users/:id`: `{name,email,role,team_id,modules}`, salvamento atômico, validação de equipe, perfil e compatibilidade, e auditoria com Administrador responsável, usuário afetado, perfil/equipe/módulos anteriores e novos e horário. A interface remove acessos incompatíveis e informa o Administrador ao trocar o perfil. A API rejeita um payload que ainda contenha módulos incompatíveis.
- `PATCH /api/users/:id/permissions`: contrato antigo de overrides funcionais desativado; retorna 400 ao Administrador. Outros perfis recebem 403.
- Não é permitido alterar o próprio perfil ou os próprios módulos, mesmo no endpoint administrativo. Outros campos podem ser editados por Administrador.
- Bootstrap e auth/me incluem `user.modules`. Somente os próprios módulos efetivos são retornados na sessão; a leitura da configuração administrativa exige Administrador.

O servidor verifica módulos antes do handler e volta a consultar perfil/módulos na fila transacional, evitando que uma revogação seja contornada por um pedido aguardando execução. Rotas administrativas sempre verificam o perfil Administrador. APIs sem correspondência no catálogo são recusadas por padrão.

APIs de leitura de ocorrências/OS são dependências compartilhadas de mapa, dashboard, triagem, planejamento, Kanban, fiscalização e campo. Um acesso de leitura é permitido quando necessário por um desses módulos autorizados; isso não libera a tela de OS/Ocorrências no menu nem suas mutações. APIs específicas de mapa, dashboard, planejamento, almoxarifado, fiscalização de OS e campo exigem suas autorizações correspondentes. As restrições de equipe/atribuição existentes continuam aplicadas aos registros.

## Experiência e validação

Menu filtra módulos incompatíveis/não liberados; rotas diretas são bloqueadas; login escolhe destino autorizado. Usuários sem módulos recebem “Sem módulos disponíveis” e orientação para procurar o Administrador. Há testes de API para todos os perfis, Campo exclusivo, autoelevação, liberação/revogação, sessão atualizada, auditoria e migração/reinício. Testes existentes de fluxo agora executam com operador de campo, preservando regras de evidências, estados, estoque e concorrência.

## Conta master de manutenção

Por definição, `admin@urbana.local` com perfil Administrador tem acesso permanente a todos os módulos do catálogo, incluindo /campo, e às ações de manutenção desses módulos. É a única exceção às restrições comuns de perfil/Campo. Novos módulos do catálogo ficam disponíveis automaticamente. Remover liberações persistidas não retira o acesso master; ao salvar essa conta, o servidor grava novamente todos os módulos.

E-mail e perfil da conta são protegidos na edição administrativa. A interface mostra todos os módulos marcados e bloqueados para remoção. Nome pode ser editado. A autenticação, sessão, auditoria, validação de versão, estados, evidências, justificativas e demais regras operacionais continuam exigidas. Outros administradores permanecem sujeitos aos módulos liberados e não executam em Campo.

A identidade é verificada no servidor a partir do usuário autenticado; informar o e-mail no corpo de uma requisição não concede acesso master. Implementação compartilhada: isMasterUser, canPerformAction e hasModuleAccess; userModules resolve todos os módulos do catálogo para essa conta sem depender de migração ou reaplicação do seed.

Verificação da exceção master: build aprovado; suíte geral com 64 aprovados, zero falhas e 1 PostgreSQL/PostGIS não executado; navegador de autorização aprovado, incluindo Campo e formulário protegido da conta master.
