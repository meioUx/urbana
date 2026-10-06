# API REST

Base `/api`. Corpos JSON, exceto anexos multipart. Sessão pelo cookie `urban_session` retornado no login. Erros: `{ "error": "mensagem", "code": "CODIGO", "details": ... }` (`code` e `details` podem ser omitidos). Códigos usuais: 400 validação, 401 sessão, 403 permissão, 404 registro ausente, 409 conflito, 429 limite de login, 500 falha interna.

Verificado contra `server/` em 2026-10-02. Modelo, estados, permissões e regras de negócio estão no [contexto mestre](URBANA-CONTEXTO-MESTRE.md); esta referência documenta os contratos HTTP vigentes, sem tratar roadmap como endpoint disponível.

## Autorização

Todas as rotas autenticadas exigem módulos compatíveis e liberados, além das ações funcionais. Somente Administrador cria/edita usuários e gerencia módulos; essa capacidade não pode ser delegada. `/campo` e ações de execução de OS são exclusivas da Equipe de Campo. Módulos não aumentam poderes do perfil; Consulta nunca realiza mutações operacionais; pode salvar o próprio progresso de treinamento em `/api/onboarding`. [Matriz e migração](AUTORIZACAO.md).

## Convenções, respostas e erros

- Rotas da tabela abaixo são relativas a `/api`. `GET /healthz` está fora dessa base e não exige sessão. Demais rotas exigem sessão, exceto login.
- Sucessos JSON usam **200**, inclusive criação; não presumir 201. Sem retorno específico: `{ "ok": true }`. Downloads retornam conteúdo do arquivo.
- Login retorna `{id,name,email,role,team_id}` e `Set-Cookie`; `/auth/me` retorna o usuário com `modules`. Bootstrap retorna `user`, `catalogs`, `operators` (preenchido somente para quem programa), `roles`, `priorities`, `settings` e `kanban`.
- Corpo JSON tem limite de 1 MB. Campos desconhecidos de objetos validados por Zod são descartados. Mutações com `Origin` de host diferente retornam 403; cliente de navegador deve enviar cookie da sessão.
- Ocorrências, OS e auditoria aceitam `limit` (1–200) e `cursor` e retornam `{items,has_more,next_cursor}`. Sem esses parâmetros, mantém-se array legado (auditoria limitada a 300). Filtros são aplicados por SQL antes da paginação; cursor usa created_at/id e deve ser reutilizado com os mesmos filtros. Listas de ocorrências/triagem/OS na UI usam páginas de 50. Painel, mapa e planejamento ainda possuem consultas amplas separadas.
- `version` é retornada por ocorrência, OS e plano. Classificação/recusa, transições/reprogramação exigem `version` lida no JSON; triagem integrada exige `triage.version`. Ausência retorna 428 VERSION_REQUIRED, formato inválido 400 INVALID_VERSION, versão antiga 409 VERSION_CONFLICT com `details.current_version`. Não há `If-Match` geral. `revision` do Kanban e `kanban_expected_status` são contratos específicos. `request_id` protege somente os envios documentados, não todas as mutações. Chaves são por usuário; reutilizar a mesma chave em outra entidade/tipo retorna 409 `REQUEST_ID_REUSED` ("Identificador de envio já utilizado.").
- Códigos estruturados (mesmo status e mensagem de antes, apenas com `code`): `BEFORE_PHOTO_REQUIRED` (400), `AFTER_PHOTO_REQUIRED` (400), `MATERIAL_REQUIRED` (400), `INVALID_STATUS` (409, "Ação incompatível com o status atual."), `RECORD_CLOSED` (409, anexos), `INVALID_DUPLICATE_LINK` (400), `ORDER_NOT_ACCESSIBLE` (403, OS de outra equipe/operador), `REQUEST_ID_REUSED` (409), `INVALID_CAPTURED_AT` (400), além de `VERSION_*` e `UPLOAD_BUSY`. Clientes devem decidir por `code`, nunca pela mensagem.
- 400: schema, vínculo, coordenadas, arquivo ou requisito inválido; 401: sessão ausente/expirada; 403: ação/equipe/origem; 404: entidade/rota; 409: duplicidade, etapa, WIP, revisão, saldo ou confirmação repetida; 429: tentativas de login ou UPLOAD_BUSY; 500: erro interno. Push sem configuração retorna 503. `details` pode ser omitido; erros Zod usam campos de `flatten()`.

| Método | Rota | Função |
| --- | --- | --- |
| POST | /auth/login | `{email,password}` |
| GET | /auth/me | Usuário autenticado |
| POST | /auth/logout | Encerra sessão |
| GET | /bootstrap | Usuário, catálogos, regras, configuração e estado do onboarding atual |
| GET / POST | /ocorrencias | Listar / cadastrar |
| GET / PATCH | /ocorrencias/:id | Detalhe / classificar em triagem |
| GET | /ocorrencias/proximas?lat=&lng= | Registros no raio configurado |
| POST | /ocorrencias/:id/classificar | Categoria, subcategoria, setor, prioridade |
| POST | /ocorrencias/:id/recusar | `{version,reason}` obrigatório; apenas antes de programar, com permissão de triagem; registra `RECUSADA`, motivo, usuário, data, auditoria |
| POST | /ocorrencias/:id/encaminhar | Mesmo contrato da classificação |
| POST | /ocorrencias/:id/anexos | Arquivo da ocorrência |
| GET / POST | /ordens-servico | Listar / programar |
| GET | /ordens-servico/:id | Detalhe, ocorrências, evidências e consumo |
| POST | /ordens-servico/:id/assumir | Iniciar deslocamento |
| POST | /ordens-servico/:id/iniciar | `{lat,lng}` da chegada |
| POST | /ordens-servico/:id/material | `{material_id,quantity}` |
| POST | /ordens-servico/:id/equipamento | `{equipment_id}` |
| POST | /ordens-servico/:id/anexos | Arquivo da OS |
| POST | /ordens-servico/:id/concluir | `{notes}` da execução |
| POST | /ordens-servico/:id/validar | Validação fiscal |
| POST | /ordens-servico/:id/reabrir | `{reason}` |
| POST | /ordens-servico/:id/cancelar | `{reason}` |
| GET | /anexos/:id | Conteúdo autenticado do arquivo |
| GET | /mapa/ocorrencias | GeoJSON FeatureCollection |
| GET | /dashboard | Indicadores e dados agregados |
| GET / POST | /categorias, /setores, /equipes, /materiais, /equipamentos, /secretarias, /departamentos | Catálogos |
| PATCH | /{catalogo}/:id | Atualizar cadastro |
| GET / POST | /users | Administrador: listar/criar usuário |
| PATCH | /settings | `{municipality,duplicate_radius}` |
| GET | /auditoria | Administrador: pesquisa paginada; array legado até 300 |
| GET | /planejamento | `{groups,plans}` |
| POST | /planos-acao | Criar plano; contrato abaixo |
| GET | /controle-setor?month=AAAA-MM&sector_id= | Controle mensal; Administrador/Gestor |
| GET | /almoxarifado | Materiais, movimentos e notas; módulo Materiais liberado, inclusive Consulta |
| POST | /almoxarifado/movimentos | Entrada/saída manual; Administrador/Gestor |
| POST | /ordens-servico/:id/notas-fiscais/extrair | PDF multipart → rascunho; Administrador/Gestor |
| POST | /notas-fiscais/:id/confirmar | Confirmar dados/estoque; Administrador/Gestor |
| GET | /notas-fiscais/:id/arquivo | PDF, sujeito a acesso à OS |

## Cadastro de ocorrência

```json
{
  "category_id": "category-1",
  "subcategory": "Buraco",
  "description": "Falha no pavimento junto ao cruzamento",
  "lat": -26.99,
  "lng": -48.64,
  "address": "Rua 1500, 300",
  "neighborhood": "Centro",
  "origin": "Fiscalização municipal",
  "priority": "Alta",
  "reference": "Próximo à faixa de pedestres"
}
```

`sector_id` é opcional na criação e assume o padrão da categoria. Se existir ocorrência ativa no raio, retorna 409 com `details.nearby`. Reenvie com `duplicate_action: "new"` para confirmar novo registro ou `duplicate_action: "link"` e `duplicate_id` para registrar uma solicitação relacionada. O vínculo preserva o ID da ocorrência existente.

Filtros na listagem e GeoJSON: `q`, `status`, `priority`, `category_id`, `sector_id`, `neighborhood`, `from`, `to` (datas no formato YYYY-MM-DD).

`q` busca código/endereço/descrição/bairro sem distinguir caixa; demais filtros textuais são exatos. `from/to` comparam dia de criação, inclusivamente. `/proximas` recebe `lat/lng` numéricos e retorna array por distância (`distance` em metros), incluindo concluídas e excluindo recusadas/canceladas. GeoJSON retorna `{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Point",coordinates:[lng,lat]},properties:ocorrencia}]}`; aceita `bbox=west,south,east,north`, validada nos limites geográficos (sem travessia do antimeridiano), com índice GiST no PostgreSQL e filtro lat/lng no SQLite.

Criação retorna ocorrência com `id`, `code`, campos de cadastro, `status`, `created_at`, `updated_at`; vínculo de duplicata retorna a ocorrência existente com `linked:true`. Detalhe inclui `history`, `evidence`, `orders`. Classificação (`PATCH`, `classificar` ou `encaminhar`) recebe `{version,category_id,subcategory,sector_id,priority}` e retorna ocorrência atualizada. Recusa recebe `{version,reason}`, retorna ocorrência atualizada; motivo vazio é 400 e etapa incompatível é 409.

## Programar OS

```json
{
  "occurrence_ids": ["UUID da ocorrência em triagem"],
  "team_id": "team-1",
  "scheduled_at": "2026-09-15",
  "responsible": "João Santos",
  "notes": "Programação da equipe"
}
```

Todas as ocorrências e a equipe precisam pertencer ao mesmo setor. A categoria define o SLA por prioridade; o prazo é calculado pelo servidor.

Aceita 1–100 IDs distintos. `scheduled_at` exige formato `AAAA-MM-DD`; `responsible` e `team_id` são obrigatórios. Retorna OS com `id`, `code`, `sector_id`, `team_id`, `status`, `priority`, `due_at`, datas e atributos de programação. Listagem acrescenta `occurrence_ids`. Detalhe acrescenta `occurrences` (com evidências), `history`, `evidence`, `materials`, `equipment`, `invoices`, `cost_by_stage`.

Campos opcionais:

- `triage: {version,category_id,subcategory,sector_id,priority}`: classificação integrada, somente com uma ocorrência; desfaz tudo se programação falhar.
- `new_plan: {objective,responsible}`: cria plano usando IDs/data da OS, somente membros prontos, em transação única. Incompatível com `plan_id` explícito. `objective`: 5–3000 caracteres; responsável do plano: 1–200.
- `plan_id`: vínculo existente, também inferido dos membros; `assigned_user_id`: operador da equipe (ou `null`); `notes`: até 3000 caracteres.

Transições retornam OS atualizada. `assumir` e `validar` não exigem campos adicionais; `iniciar` recebe números `lat/lng`; `concluir` recebe `notes` não vazio; `reabrir`, `cancelar`, `devolver` recebem `reason` não vazio. Requisitos por estado/categoria estão no contexto mestre. Material exige `quantity > 0` (até 1.000.000); material/equipamento retornam `{ok:true}` e só são aceitos em execução.

Campos opcionais de sincronização de campo (sem eles o comportamento é o anterior):

- `assumir`, `iniciar`, `concluir`, `devolver` aceitam `request_id` (UUID). O primeiro envio aplica a transição e registra a chave na mesma transação. Repetição pelo mesmo usuário para a mesma OS não reaplica nem valida `version`/estado: retorna 200 com a OS atual e `replayed: true` (se a OS deixou de ser acessível ao usuário, apenas `{id, replayed: true}`). Chave usada em outra OS/tipo: 409 `REQUEST_ID_REUSED`. Uma transição rejeitada não consome a chave. Outras transições (`validar`, `reabrir`, `cancelar`) ignoram `request_id`.
- As mesmas quatro aceitam `captured_at` (ISO 8601 com fuso, hora real do trabalho offline): `iniciar` grava `started_at`, `concluir` grava `finished_at` e `devolver` grava `returned_at` com `captured_at ?? agora`; em `assumir` fica apenas na auditoria. `updated_at` e auditoria seguem a hora do servidor. Inválido, mais de 5 min no futuro ou mais de 30 dias no passado: 400 `INVALID_CAPTURED_AT`. O valor é normalizado para UTC (`toISOString`).
- `assumir` grava `assumed_by` (ID) e `assumed_by_name` na OS, apenas informativos: não alteram `assigned_user_id` nem o acesso. `programacao` limpa esses campos junto de `started_at`, `finished_at` etc.
- `POST /ordens-servico/:id/material` aceita `request_id` (UUID, tipo `consumption`) e `captured_at` (só auditoria). Repetição retorna `{ok:true, replayed:true}` sem novo lançamento nem validação de estado; chave usada em outra OS/tipo: 409 `REQUEST_ID_REUSED`.

## Evidências

Multipart com `file`, `stage`, `lat` e `lng`. Etapas: `registro`, `antes`, `durante`, `depois`, `documento`. JPG/PNG/WebP/PDF/MP4 até 15 MB. Fotos exigidas no fluxo devem ser arquivos de imagem, não PDFs. Coordenadas da evidência podem ser obtidas do dispositivo ou confirmadas manualmente.

Um arquivo por envio; `request_id` UUID opcional. Resposta é `{ id }` da evidência persistida; repetir o identificador suportado retorna `{ id }` da mesma evidência (chave usada em outra entidade: 409 `REQUEST_ID_REUSED`). O campo multipart opcional `captured_at` (mesmas regras das transições, 400 `INVALID_CAPTURED_AT`) grava a hora de captura; `created_at` continua sendo a hora de recebimento. Detalhes de OS/ocorrência listam `evidence` com `captured_at` (null quando não informado). As exigências de foto antes/depois comparam `captured_at ?? created_at` da evidência com `reprogrammed_at`, `started_at`, `reopened_at` e `created_at` da OS; uma foto capturada antes de uma reprogramação não vale para iniciar, mesmo se recebida depois. Registro encerrado: 409 `RECORD_CLOSED`. Arquivos são consultados por `/anexos/:id`. Nunca reutilizar um identificador em operações distintas.

## Catálogo de categoria

`name`, `subcategories` (array), `sector_id`, `sla` (objeto com Emergencial, Alta, Média, Baixa e Programada em horas), `require_before`, `require_after`, `require_material`. Campos não reconhecidos são descartados pela validação.

## Planejamento territorial

- `GET /api/planejamento`: grupos de ocorrências abertas por rua/bairro, prioridade sugerida e planos persistidos com progresso e OS relacionadas. Ordens de outras equipes permanecem ocultas para usuários de campo.
- `POST /api/planos-acao` (Administrador/Gestor): `{occurrence_ids: [id], objective, responsible, scheduled_at: "AAAA-MM-DD"}`. Aceita 1–100 ocorrências abertas da mesma rua/bairro e setor, sem vínculo prévio a plano; cria plano e auditoria em transação.
- Membros precisam estar em `IDENTIFICADA` ou `EM_TRIAGEM`, sem OS prévia; IDs repetidos são 400, reservas/OS/etapa incompatível são 409. Objetivo: 5–3000 caracteres; responsável: 1–200; data valida formato e existência do dia. Retorna plano com `id`, `code`, `created_at`, membros e atributos de via/setor/prioridade. GET retorna grupos e planos com membros, progresso, contagens de concluídas/canceladas/recusadas e OS autorizadas. Não há PATCH/DELETE de plano.
- `POST /api/ordens-servico` aceita `plan_id` opcional e valida pertencimento. A vinculação também é inferida dos registros, inclusive na criação individual de OS. Não permite misturar ocorrências de planos diferentes ou planejadas com não planejadas na mesma OS.

## Operação de campo

- `GET /api/campo`: ordens autorizadas com endereços, registros criados pelo usuário, horário do servidor e disponibilidade/chave pública de push.
- `POST /api/ocorrencias`: também permitido a Equipe de Campo; aceita `requested_by`, `phone` e UUID `request_id` opcional para reenvio idempotente. Com `duplicate_action: "link"` e `request_id`, o vínculo é registrado (tipo `occurrence_link`); repetir a chave retorna a ocorrência alvo com `linked:true`, sem nova auditoria, e nunca cria ocorrência nova (mesmo com `duplicate_action: "new"`). Vínculo inválido: 400 `INVALID_DUPLICATE_LINK`.
- `POST /api/ocorrencias/:id/anexos` e `/api/ordens-servico/:id/anexos`: multipart aceita UUID `request_id`; reenvios retornam a mesma evidência. Operadores só anexam a ocorrências próprias ou a ordens que podem executar; quem registrou um vínculo de duplicidade com `request_id` também pode anexar foto da etapa `registro` à ocorrência vinculada. Multipart aceita `captured_at`.
- `POST /api/ordens-servico`: aceita `assigned_user_id` opcional, restrito aos operadores da equipe. Registra emissor e enfileira aviso para os destinatários.
- `POST /api/ordens-servico/:id/programacao`: Administrador/Gestor; `{version, team_id, assigned_user_id?, responsible, scheduled_at, notes}`. Permitido para `PROGRAMADA` ou `DEVOLVIDA`.
- `POST /api/ordens-servico/:id/devolver`: executor autorizado; `{reason}` obrigatório. Retorna à gestão no estado `DEVOLVIDA`.
- `assumir`/`iniciar`/`concluir`/`devolver` e `material` aceitam `request_id` e `captured_at` para fila offline (ver Programar OS → campos de sincronização). OS de outra equipe/operador: 403 `ORDER_NOT_ACCESSIBLE`.
- `POST /api/campo/notificacoes`: cadastra assinatura Web Push `{endpoint,keys:{p256dh,auth}}`; requer configuração VAPID e endpoint de serviço de push reconhecido.
- `DELETE /api/campo/notificacoes`: `{endpoint}`; remove a assinatura do usuário naquele aparelho.
- `GET /healthz`: verificação de disponibilidade do processo, sem autenticação.

`/bootstrap` inclui `operators` (id/nome/equipe) apenas para perfis com permissão de programação. `validar`/`reabrir` também são permitidos a Gestor; continuam bloqueados para Equipe de Campo.

## Kanban compartilhado

- `GET /api/kanban`: retorna `{revision, limits, order}`; o bootstrap inclui a mesma configuração.
- `PATCH /api/kanban`: gestores/administradores enviam `{revision, limits}` com limites inteiros de 0 a 999 para etapas abertas. Zero desativa o limite.
- `POST /api/kanban/ordem`: triagem, gestão e fiscalização enviam `{revision, status, keys}` com todos os cartões da etapa em ordem, no formato `occurrence:id` ou `order:id`. Duplicados, conjuntos incompletos e revisões desatualizadas retornam 409.
- Movimentações usam as rotas operacionais existentes com `kanban_expected_status`. O servidor valida a etapa esperada, os requisitos da ação e os limites compartilhados antes do commit.

Os limites também se aplicam às outras telas. Consulte as regras de cartão, WIP e métricas no [contexto mestre](URBANA-CONTEXTO-MESTRE.md).

## Almoxarifado e notas fiscais

`GET /api/almoxarifado` retorna `{materials,movements,invoices}`. Material acrescenta `stock`, `average_cost`, `stock_value`, `consumed_90_days`, `monthly_average`, `minimum_stock`, `target_90_days`, `suggested_purchase`, `status` (`sem_estoque`, `baixo`, `repor`, `adequado`). Movimentos: últimos 100, com usuário/código da OS quando presentes; notas: lista com atributos, sem itens hidratados nessa rota.

`POST /api/almoxarifado/movimentos`:

```json
{"material_id":"material-1","type":"entrada","quantity":10,"unit_cost":25.5,"notes":"Entrada conferida"}
```

`type`: `entrada|saida`; quantidade positiva/custo não negativo (até 1e9), motivo obrigatório. Retorna `{id}`. Material inexistente: 400; saída acima do saldo de material controlado: 409. A regra não impõe saldo inicial a material ainda sem movimentos.

Extração: `POST /api/ordens-servico/:id/notas-fiscais/extrair`, multipart `file` PDF até 15 MB. Retorna nota `RASCUNHO`, campos de fornecedor/número/data/total, `items`, `extraction_status` (`sem_texto`, `itens_encontrados`, `revisao_manual`) e texto extraído. Não há OCR nem lançamento automático nessa etapa.

Confirmação: `POST /api/notas-fiscais/:id/confirmar`:

```json
{
  "supplier":"Fornecedor municipal",
  "invoice_number":"123",
  "issue_date":"2026-10-02",
  "total_value":255,
  "items":[{
    "description":"Material para pavimento",
    "material_id":"material-1",
    "stage":"execucao",
    "purchased_quantity":10,
    "used_quantity":2,
    "unit":"UN",
    "unit_value":25.5,
    "product_total":255
  }]
}
```

Fornecedor: 1–200; número: 1–40; data opcional/nula com formato `AAAA-MM-DD`; total não negativo até 1e11; 1–200 itens. Descrição: 1–300; `material_id` opcional/nulo; unidade: 1–20; quantidade comprada positiva; usada/custo não negativos até 1e9; `product_total` não negativo até 1e11. Etapas: `registro|triagem|execucao|validacao|outros`. A API valida usada ≤ comprada e material existente; não garante conciliação automática de todos os totais informados. Retorna nota `CONFIRMADA` hidratada com itens e dados de confirmação. Nota já confirmada ou mesmo fornecedor/número confirmado: 409.

Itens vinculados a material geram entradas e, se aplicados, saídas por OS/etapa. A aplicação direta de nota não cria necessariamente `consumption`; veja distinção de custos/requisitos no mestre. `GET /api/notas-fiscais/:id/arquivo` retorna PDF inline após verificar acesso à OS.

## Controle do setor, painel e administração

- `GET /api/controle-setor?month=AAAA-MM&sector_id=id`: Administrador/Gestor; mês inválido/ausente usa mês UTC atual. Retorna `{month,sector_id,rows,summary}`; resumo contém `orders`, `services`, `completed`, `completion_rate`, `codes`, `contacts`. Semântica de serviço/contato/mês no mestre; não há paginação.
- `/dashboard`: retorna indicadores (`total`, `open`, `emergency`, `executing`, `validation`, `completed`, `overdue`), `cost`, `actual_cost`, `cost_by_stage`, `byNeighborhood`, `byCategory`, `materials`, `orders` autorizadas e `occurrences`. É uma resposta ampla, não apenas agregados. A série diária da visão geral é derivada no frontend.
- `/auditoria`: pesquisa por entity_type, entity_id, user_id, event (exatos) e from/to (dias inclusivos); limit/cursor retorna envelope paginado com usuário; sem paginação mantém array de até 300. Histórico por entidade vem nos detalhes.
- Catálogos: GET retorna array; POST/PATCH retornam `{id,kind,...atributos}`. Escrita administrativa; `name` 2–120 caracteres. PATCH valida o objeto completo, não somente campos parciais. Categoria exige todas as prioridades de SLA (inteiros positivos até 8760 horas), ao menos uma subcategoria e os três booleanos de exigência. Materiais: `unit` 1–10 caracteres, `unit_cost` não negativo, `minimum_stock` não negativo (padrão zero). Equipes: `sector_id`, `leader` obrigatório e `members` inteiro 1–500. Equipamentos: `code` obrigatório. Departamento/setor exigem `parent_id` do tipo correto. Vínculos são validados.
- `/users` POST: `{name,email,password,role,team_id?}`; senha 10–200 caracteres; Campo exige equipe. Retorna `{id}`; e-mail já cadastrado: 409. GET: array `{id,name,email,role,team_id}`. `modules?: string[]` define acessos compatíveis (ausente: sugestão; vazio: nenhum). `GET /users/:id/permissions` lê a configuração administrativa; `PATCH /users/:id` edita `{name,email,role,team_id,modules}` com auditoria. Todos exclusivos de Administrador; perfil/módulos próprios não podem ser alterados.
- `/settings` PATCH: ambos `{municipality,duplicate_radius}` obrigatórios, raio 1–500 metros; retorna `{ok:true}`.
- Exportação CSV é gerada pela interface a partir dos registros filtrados; não há endpoint dedicado de exportação.

### Concorrência — limites do checkpoint

Versionamento cobre alterações de atributos/estado de ocorrência e OS e projeção da OS em ocorrências. Planos têm version, mas não possuem API de edição; progresso é uma projeção dos membros. Anexos, consumo, equipamentos e criação de OS são operações aditivas com regras/transações próprias, não edições de formulário. Não há proteção distribuída geral de estoque, numeração ou WIP. Clientes precisam atualizar payloads de edição antes do deploy desta revisão.

### Listagens SQL — checkpoint 3

Filtros comuns: q, status, priority, sector_id, from/to; ocorrência: category_id/neighborhood; OS: team_id e deadline=late|soon|ontime. Busca OS inclui código, responsável e nome da equipe. status aceita lista separada por vírgula para filas de triagem. Datas/cursor/limit inválidos retornam 400; cursor é específico da entidade, filtros e escopo do operador. LIKE trata %/_ como caracteres literais. Ordenação created_at DESC,id DESC garante desempate; não representa snapshot imutável entre requisições. Exportar página exporta somente a página exibida.

## Histórico de movimentos — P0

GET /api/almoxarifado/movimentos (Administrador/Gestor): limit/cursor e filtros material_id/order_id/user_id/type/from/to. Resposta paginada {items,has_more,next_cursor}; sem paginação, array legado limitado a 100. UI usa páginas de 50. GET /almoxarifado mantém seu contrato, mas calcula stock/average_cost/stock_value no SQL sobre todo o histórico, sem carregar todos os movimentos no JavaScript. Nenhuma reserva/transferência/inventário P2 criada nesta revisão.

Uploads simultâneos são limitados a quatro por instância (configurável por maxConcurrentUploads na fábrica da aplicação) antes do Multer; excesso retorna 429 UPLOAD_BUSY, preservando a possibilidade de reenvio.

## Onboarding e treinamento

- `GET /api/onboarding`: estado próprio da versão atual e `tutorials` com progresso dos tutoriais individuais.
- `PATCH /api/onboarding`: JSON estrito `{version: 1, tutorial_id: "main", event: "started", step_id: null}`. Eventos: `started`, `progress`, `skipped`, `completed`, `replayed`. `tutorial_id` pode ser `task:<id>`; `step_id` é opcional/nulo ou ID de etapa autorizada.
- Sessão obrigatória; não recebe ID de outro usuário. O servidor valida perfil, módulos e ações do tutorial. Tutorial não autorizado retorna 403; versão, etapa ou campos inválidos retornam 400.
- Resposta inclui `version`, `status`, datas e `step_id`. Sem progresso: `not_started`; pular: `skipped`; terminar: `completed`. Repetir preserva a primeira conclusão. Este endpoint não concede módulos nem altera a operação.
- Estado inicial também em `bootstrap.onboarding`. [Arquitetura, fluxos e testes](ONBOARDING.md).

## Conta master de manutenção

Por definição, `admin@urbana.local` com perfil Administrador tem acesso permanente a todos os módulos do catálogo, incluindo /campo, e às ações de manutenção desses módulos. É a única exceção às restrições comuns de perfil/Campo. Novos módulos do catálogo ficam disponíveis automaticamente. Remover liberações persistidas não retira o acesso master; ao salvar essa conta, o servidor grava novamente todos os módulos.

E-mail e perfil da conta são protegidos na edição administrativa. A interface mostra todos os módulos marcados e bloqueados para remoção. Nome pode ser editado. A autenticação, sessão, auditoria, validação de versão, estados, evidências, justificativas e demais regras operacionais continuam exigidas. Outros administradores permanecem sujeitos aos módulos liberados e não executam em Campo.

A identidade é verificada no servidor a partir do usuário autenticado; informar o e-mail no corpo de uma requisição não concede acesso master. Implementação compartilhada: isMasterUser, canPerformAction e hasModuleAccess; userModules resolve todos os módulos do catálogo para essa conta sem depender de migração ou reaplicação do seed.
