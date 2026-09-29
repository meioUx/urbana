# Arquitetura do MVP

## Módulos e responsabilidade

| Módulo | Responsabilidade | Arquivo |
| --- | --- | --- |
| Interface | Painel, mapa, fluxo operacional e administração | src/main.tsx, src/styles.css |
| API | Rotas REST, validação Zod, autorização e transações | server/app.js |
| Domínio | Estados, prioridades, perfis, distância e credenciais | server/domain.js |
| Persistência | Adaptador SQLite/PostgreSQL e migration inicial | server/db.js, server/schema.sql |
| Inicialização | Catálogos e dados demonstrativos | server/seed.js |
| GIS | Fila persistente, repetição e integração Feature Service | server/gis.js |

## Entidades e relacionamentos

`users` possui perfil e vínculo opcional com uma equipe. `sessions` guarda apenas o hash do token, a referência ao usuário e a expiração.

`catalogs` guarda entidades configuráveis com discriminador de tipo e atributos estruturados. Secretaria, departamento e setor usam `parent_id`; equipes e categorias usam `sector_id`. A API valida o tipo dos vínculos. Subcategorias, exigências e regras de SLA pertencem à categoria. Esses atributos são JSON em texto para manter o mesmo esquema entre os dois bancos.

`occurrences` representa o problema físico: código, categoria, setor, prioridade, status e coordenadas são colunas indexáveis. Descrição, origem, endereço e metadados ficam nos atributos. Em PostgreSQL, `geom` é uma geometria calculada e indexada.

`orders` representa a intervenção: setor, equipe, prioridade, prazo e status próprios. `order_occurrences` implementa a relação N:N, sem misturar as duas entidades. O fluxo inicial programa ocorrências em triagem. O prazo é o menor prazo das ocorrências agrupadas e conta desde a identificação, não desde a criação da OS.

`evidence`, `consumption` e `order_equipment` guardam anexos, quantidades com custo unitário histórico e equipamentos. Anexos de ocorrências e OS compartilham o armazenamento, com autorização apropriada.

`audit_logs` registra usuário, horário, evento, valor anterior e novo. A aplicação não oferece edição/exclusão de auditoria. `gis_sync` guarda o estado da última sincronização por ocorrência. `settings` mantém município e raio geográfico. `assets` e `maintenance_plans` reservam os vínculos das fases futuras.

## Estados

```text
IDENTIFICADA -> EM_TRIAGEM -> PROGRAMADA
PROGRAMADA -> EM_DESLOCAMENTO -> EM_EXECUCAO
PROGRAMADA -> EM_EXECUCAO
EM_EXECUCAO -> AGUARDANDO_VALIDACAO -> CONCLUIDA
AGUARDANDO_VALIDACAO / CONCLUIDA -> EM_EXECUCAO (reabertura justificada)
PROGRAMADA / EM_DESLOCAMENTO / EM_EXECUCAO -> CANCELADA (justificada)
```

Triagem exige perfil próprio. Criar OS exige gestor ou administrador. Iniciar valida foto antes quando obrigatória; concluir valida foto depois, relato e material quando obrigatório. Conclusão operacional não equivale à validação fiscal. Fotos, mudanças de estado e consumos não são aceitos em estados incompatíveis.

## Permissões

| Ação | Admin | Gestor | Triagem | Campo | Fiscalização | Consulta |
| --- | --- | --- | --- | --- | --- | --- |
| Consultar ocorrências e mapa | Sim | Sim | Sim | Sim | Sim | Sim |
| Registrar ocorrência | Sim | Sim | Sim | Sim | Sim | Não |
| Classificar e encaminhar | Sim | Sim | Sim | Não | Não | Não |
| Programar/cancelar OS | Sim | Sim | Não | Não | Não | Não |
| Executar OS | Sim | Sim | Não | Própria equipe | Não | Não |
| Validar/reabrir | Sim | Sim | Não | Não | Sim | Não |
| Cadastros e auditoria global | Sim | Não | Não | Não | Não | Não |

Sessões usam cookie HttpOnly e SameSite estrito, com checagem da origem em mutações. O servidor guarda scrypt com salt aleatório e compara em tempo constante. Arquivos são renomeados aleatoriamente, limitados por tamanho/tipo e têm assinatura básica conferida. Uma implantação real pode acrescentar análise antimalware e armazenamento S3.

## Consistência e limites

Mutações operacionais e seus eventos/filas usam uma transação. As requisições são serializadas sobre uma única conexão; isso evita entrelaçamento de transações em SQLite e PostgreSQL no processo local. O worker GIS participa da mesma fila. Cada chamada externa tem timeout, mas um lote GIS pode aumentar a latência da API; separar o worker com controle de concorrência é um passo de produção.

Upload em disco acontece antes da transação. Erros esperados removem o arquivo temporário. Uma falha de processo/commit entre disco e banco pode deixar um arquivo órfão, exigindo coleta periódica em produção. O ID polimórfico dos anexos e vínculos internos de catálogos são validados pela API, não por FKs específicas por tipo.

A migration 1 é idempotente. Novas versões devem ser adicionadas explicitamente; editar o esquema inicial não migra automaticamente tabelas de instalações existentes. O PostgreSQL é suportado por adaptador, mas exige validação de implantação com a versão e permissões do servidor de destino.

## Campo, distribuição e notificações

`src/Operator.tsx` e `src/operator.css` implementam a interface móvel. `field-storage.ts` guarda rascunhos por usuário no IndexedDB, sem cache de respostas autenticadas no service worker. `public/sw.js` recebe notificações e fornece uma página offline, sem copiar dados de usuários para o cache.

`assigned_user_id`, emissor e informações de execução ficam no JSON da OS. `canAccessOrder` aplica equipe e operador em consultas, ações, anexos, painel, planejamento e notificações. Uma ordem sem operador é compartilhada pela equipe; com operador, apenas ele a executa no perfil de campo. Gestores mantêm a visão autorizada de gestão.

A migration 3 adiciona `client_requests` para idempotência de registros/fotos, `push_subscriptions` por aparelho e `push_jobs` para entrega com até cinco tentativas. O worker verifica a atribuição atual antes do envio, remove assinaturas expiradas e faz a chamada externa fora da fila serial do banco. A fila registra distribuição/reprogramação e reabertura. Reentregas podem ocorrer em falhas ambíguas do serviço push; a notificação usa a OS como tag para substituição.

Novo estado `DEVOLVIDA`: pode ser alcançado a partir de programada, deslocamento ou execução, exige justificativa e bloqueia execução/anexos até a reprogramação. A atualização pelo gestor volta para `PROGRAMADA` e preserva o prazo de SLA original. O envio normal continua passando por `AGUARDANDO_VALIDACAO`, sem permitir conclusão direta pelo operador.
