# Autorização do Urbana

Somente usuários com perfil Administrador podem criar usuários, alterar perfis e gerenciar liberações de módulos.
O acesso a módulos não concede poderes adicionais ao perfil.
O ambiente `/campo` é exclusivo do perfil Equipe de Campo, inclusive suas APIs e ações de execução. Administrador e Gestor não executam OS.

## Catálogo e matriz

`shared/authorization.mjs` centraliza módulos reais, rotas, compatibilidade, sugestões, ações funcionais, destino de login e dependências das APIs. A Administração contém Usuários, Cadastros, Configurações e Auditoria, que são abas reais da mesma tela; não foram criados módulos independentes fictícios. Materiais contém o almoxarifado existente. O módulo `works` ("Obras e intervenções", `/obras`) foi acrescentado ao catálogo na segunda rodada, junto da ação funcional `works` (ver abaixo).

Acesso efetivo = compatibilidade do perfil × módulo individual liberado × ação funcional permitida. Não existem liberações individuais de ações nem checkbox de administrar permissões. A matriz é um limite obrigatório também para Administradores. Consulta é somente leitura; materiais/estoque são consultáveis quando liberados, com formulário de ajuste oculto e mutações recusadas.

| Perfil          | Sugestão inicial / migração 8                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrador   | Visão geral, Mapa, Ocorrências, Triagem, Kanban, Planejamento, Obras e intervenções, OS, Controle do setor, Análise de campo, Equipes, Materiais, Equipamentos, Administração |
| Gestor          | Mesmos módulos operacionais acima, sem Administração e sem Campo                                                                                                              |
| Triagem         | Visão geral, Mapa, Ocorrências, Triagem, Kanban                                                                                                                               |
| Equipe de Campo | Campo                                                                                                                                                                         |
| Fiscalização    | Visão geral, Mapa, Ocorrências, OS, Análise de campo, Kanban, Obras e intervenções (leitura)                                                                                  |
| Consulta        | Visão geral, Mapa, Ocorrências, OS, Kanban, Planejamento, Equipes, Materiais, Equipamentos, Obras e intervenções (leitura)                                                    |

A coluna acima é a sugestão do código atual (`roleModules` em `shared/authorization.mjs`, usada pelo seed e pela criação de usuário sem `modules`). **A migração 8 é anterior ao módulo Obras e intervenções e não o inclui**; a migração 12 também **não** o libera a nenhum usuário existente. Em instalações já em uso, só a conta master o recebe; o Administrador o libera por usuário em Administração. A migração 8 inicializa os usuários existentes uma única vez com módulos compatíveis; o seed faz o mesmo para a instalação nova. Mantém os acessos de consulta e operação compatíveis com as responsabilidades novas. As antigas possibilidades de executar como Administrador/Gestor, usar Campo com outros perfis, e acessar módulos incompatíveis são intencionalmente retiradas. Não reaplica padrões no login ou reinício: uma lista vazia continua vazia. Concessões são persistidas em `user_module_permissions`, com timestamps e chave usuário/módulo. A migração é transacional em SQLite e PostgreSQL. O código da migração 8 está em `server/migrations/008-user-modules.js`.

## Administração e APIs

- `POST /api/users`: dados existentes e `modules: string[]`. Ausência de modules usa a sugestão do perfil; lista vazia é respeitada. Valores desconhecidos/incompatíveis retornam 400.
- `GET /api/users/:id/permissions`: dados públicos do usuário, módulos efetivos e catálogo. Exclusivo do Administrador.
- `PATCH /api/users/:id`: `{name,email,role,team_id,modules}`, salvamento atômico, validação de equipe, perfil e compatibilidade, e auditoria com Administrador responsável, usuário afetado, perfil/equipe/módulos anteriores e novos e horário. A interface remove acessos incompatíveis e informa o Administrador ao trocar o perfil. A API rejeita um payload que ainda contenha módulos incompatíveis.
- `PATCH /api/users/:id/permissions`: contrato antigo de overrides funcionais desativado; retorna 400 ao Administrador. Outros perfis recebem 403.
- Não é permitido alterar o próprio perfil ou os próprios módulos, mesmo no endpoint administrativo. Outros campos podem ser editados por Administrador.
- Bootstrap e auth/me incluem `user.modules`. Somente os próprios módulos efetivos são retornados na sessão; a leitura da configuração administrativa exige Administrador.

O servidor verifica módulos antes do handler e volta a consultar perfil/módulos na fila transacional, evitando que uma revogação seja contornada por um pedido aguardando execução. Rotas administrativas sempre verificam o perfil Administrador. APIs sem correspondência no catálogo são recusadas por padrão. Caminhos inexistentes em `/api` seguem outra regra, desde a segunda rodada: um usuário autenticado recebe **404** `Rota não encontrada.` (a lista de rotas é derivada do próprio roteador), um anônimo recebe 401 e uma rota real de módulo não liberado continua 403 `Módulo não autorizado.`.

APIs de leitura de ocorrências/OS são dependências compartilhadas de mapa, dashboard, triagem, planejamento, Kanban, fiscalização e campo. Um acesso de leitura é permitido quando necessário por um desses módulos autorizados; isso não libera a tela de OS/Ocorrências no menu nem suas mutações. APIs específicas de mapa, dashboard, planejamento, almoxarifado, fiscalização de OS e campo exigem suas autorizações correspondentes. As restrições de equipe/atribuição existentes continuam aplicadas aos registros.

## Obras e intervenções (módulo e ação `works`)

Todas as rotas `/api/intervencoes` e `/api/obras` exigem o módulo `works`; as mutações (cadastrar, editar, mudar a situação, vincular, excluir, avaliar conflito) exigem também a ação funcional `works`, concedida a **Administrador e Gestor** (e à conta master). Fiscalização e Consulta, com o módulo liberado, apenas leem; Triagem e Equipe de Campo não têm o módulo. Quem tem só o módulo `works` também lê `GET /api/ocorrencias` e `GET /api/ordens-servico` (busca de registros para vincular), sem as mutações desses módulos, e o mapa territorial só mostra a camada de intervenções a quem tem o módulo. Detalhes do contrato em [API](API.md#obras-e-intervenções) e a decisão em [ADR-024](DECISIONS.md).

## Perfil de sistema do portal do cidadão

O perfil `Sistema` **não é um dos seis perfis de pessoas** e não consta de `roleModules`: existe só para o usuário técnico `system-portal-cidadao`, que o portal do cidadão usa como autor da ocorrência e da auditoria (as duas tabelas têm chave estrangeira para `users`). Esse usuário é criado no primeiro registro público, tem uma senha que nenhum valor pode satisfazer, é recusado no login, não tem módulos, não aparece em `GET /api/users` e responde 404 em `GET /users/:id/permissions` e `PATCH /users/:id`. As rotas públicas `/api/publico/*` não passam pelo controle de módulos: não têm sessão. Ver [ADR-025](DECISIONS.md) e a [API](API.md#portal-do-cidadão-rotas-públicas).

## Experiência e validação

Menu filtra módulos incompatíveis/não liberados; rotas diretas são bloqueadas; login escolhe destino autorizado. Usuários sem módulos recebem “Sem módulos disponíveis” e orientação para procurar o Administrador. Há testes de API para todos os perfis, Campo exclusivo, autoelevação, liberação/revogação, sessão atualizada, auditoria e migração/reinício. Testes existentes de fluxo agora executam com operador de campo, preservando regras de evidências, estados, estoque e concorrência.

## Conta master de manutenção

Por definição, `admin@urbana.local` com perfil Administrador tem acesso permanente a todos os módulos do catálogo, incluindo /campo, e às ações de manutenção desses módulos. É a única exceção às restrições comuns de perfil/Campo. Novos módulos do catálogo ficam disponíveis automaticamente. Remover liberações persistidas não retira o acesso master; ao salvar essa conta, o servidor grava novamente todos os módulos.

E-mail e perfil da conta são protegidos na edição administrativa. A interface mostra todos os módulos marcados e bloqueados para remoção. Nome pode ser editado. A autenticação, sessão, auditoria, validação de versão, estados, evidências, justificativas e demais regras operacionais continuam exigidas. Outros administradores permanecem sujeitos aos módulos liberados e não executam em Campo.

A identidade é verificada no servidor a partir do usuário autenticado; informar o e-mail no corpo de uma requisição não concede acesso master. Implementação compartilhada: isMasterUser, canPerformAction e hasModuleAccess; userModules resolve todos os módulos do catálogo para essa conta sem depender de migração ou reaplicação do seed.

Verificação da exceção master: build aprovado; suíte geral com 64 aprovados, zero falhas e 1 PostgreSQL/PostGIS não executado; navegador de autorização aprovado, incluindo Campo e formulário protegido da conta master. (Contagem da entrega original, de 2026-10-02; a atual está no [Changelog](CHANGELOG.md).)
