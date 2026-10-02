# Decisões arquiteturais e de produto — Urbana

ADRs simplificados, consolidados em 2026-10-02. O [contexto mestre](URBANA-CONTEXTO-MESTRE.md) descreve o funcionamento atual. Uma decisão aceita orienta a evolução, mas não comprova sua implementação; o campo **Aplicação atual** explicita essa diferença. Alterações destas decisões exigem novo ADR, com justificativa e relação com o anterior.

## ADR-001 — Arquitetura modular

**Status:** Aceita. **Decisão:** manter um monólito modular; não migrar para microserviços sem decisão arquitetural explícita.

**Motivo:** menor complexidade operacional, transações locais importantes e domínio ainda em evolução. Modularização incremental é suficiente para o estágio atual.

**Aplicação atual:** um processo Express e interface React com módulos extraídos; `server/app.js` e `src/main.tsx` ainda concentram responsabilidades. Diretórios `modules/` são uma organização alvo, não a estrutura existente.

## ADR-002 — Ocorrência e OS são conceitos diferentes

**Status:** Aceita. **Decisão:** `Occurrence != Order`. Ocorrência é problema, demanda ou necessidade identificada; OS é execução planejada para tratar uma ou mais ocorrências. Não fundir entidades.

**Motivo:** preservar a decisão de atendimento separada da execução, evidências, recursos e validação.

**Aplicação atual:** tabelas separadas e relação N:N; a ocorrência vinculada recebe uma projeção do estado da OS. A projeção não cria transições diretas de execução na ocorrência.

## ADR-003 — Plano, intervenção e obra são diferentes

**Status:** Aceita. **Decisão:** plano de ação é agrupamento/plano operacional; intervenção será conjunto estruturado de serviços em trecho, área ou ativo; obra será projeto municipal de infraestrutura de maior nível. Não converter automaticamente os planos existentes em obras.

**Motivo:** manutenção simples deve continuar independente de uma obra; vínculos futuros são opcionais.

**Aplicação atual:** planos implementados; intervenção e obra como entidades próprias são planejadas para P1. A palavra “intervenção” em textos operacionais existentes não comprova essas entidades.

## ADR-004 — PostgreSQL / PostGIS

**Status:** Aceita. **Decisão:** SQLite para desenvolvimento, testes ou instalação simples controlada; PostgreSQL/PostGIS como banco recomendado para produção municipal.

**Motivo:** necessidades de consultas espaciais, operação e crescimento; trocar configuração de banco não é migração de dados.

**Aplicação atual:** dois adaptadores; PostGIS cria geometria de ponto e índice. Homologação real pendente; o Compose entregue utiliza SQLite em instância única.

## ADR-005 — Dados geográficos

**Status:** Aceita. **Decisão:** utilizar geometria estruturada nos recursos territoriais; endereço textual não deve ser o único identificador territorial. Priorizar `road_segment`, `geometry`, GeoJSON e PostGIS onde aplicável.

**Motivo:** grafias, cruzamentos e nomes de ruas não identificam com segurança um trecho físico.

**Aplicação atual:** coordenadas de ocorrências, GeoJSON de pontos e `geom` no PostgreSQL. Agrupamento de planejamento ainda é textual; segmentos viários e geometrias de obras/intervenções são P1.

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

## ADR-011 — Segurança

**Status:** Aceita. **Decisão:** validar permissões sempre no backend; esconder botão não é controle de acesso.

**Motivo:** API e anexos precisam proteger dados independentemente da interface.

**Aplicação atual:** seis perfis e autorização por ação no servidor, com restrição adicional de equipe/operador. Scripts e componentes de permissões individuais ainda não estão integrados ao servidor vigente.

## ADR-012 — Compatibilidade

**Status:** Aceita. **Decisão:** novas migrations serão aditivas, versionadas e compatíveis com instalações existentes. Não editar migration antiga para representar alteração futura.

**Motivo:** atualização segura sem perda de dados ou mudanças retroativas de significado.

**Aplicação atual:** versões 1–4 em `server/db.js` e esquema base em `server/schema.sql`; 2–4 são transacionais e registradas após sucesso. Não há diretório `migrations/` nem ferramenta de downgrade. Numerações futuras devem ser confirmadas contra o código antes de implementar.

## ADR-013 — Versão obrigatória em edições operacionais

Status: Aceita e aplicada ao checkpoint de concorrência, complementa ADR-009. Classificação/recusa, transições/programação da OS exigem version da leitura; erro 428 quando ausente e 409 VERSION_CONFLICT quando divergente. Escrita usa WHERE id/version e incrementa no mesmo comando; falha reverte a transação e auditoria. Planos recebem version para evolução, sem inventar edição inexistente. Anexos/consumo/equipamentos são adições, preservando idempotência e regras; locking distribuído de WIP/estoque/numeração não está homologado.

## ADR-014 — Storage injetável e arquivos compensados

Status: Aceita e implementada. Complementa ADR-006/008/012, cujo campo Aplicação atual descreve o baseline anterior à revisão. FileStorage usa chaves uploads/ e invoices/ preservadas; default local, object adapter injetável com SDK real a configurar posteriormente. Uploads limitados em memória; assinatura/autorização antes do save. Falhas transacionais limpam arquivos salvos; queda abrupta pode exigir reconciliação. PDF.js deve destruir o loading task em finally, conforme API da versão instalada. Sem serviço externo ativado.

## ADR-015 — Paginação incremental e carregamento por área

Status: Aceita e implementada parcialmente. Complementa ADR-001/009/012 (baseline anterior à revisão). Cursor estável created_at/id, filtros SQL e envelope opt-in para compatibilidade; listas UI paginadas. Consumidores operacionais amplos permanecem explicitamente pendentes para não truncar métricas/cartões. React.lazy/Suspense por área e mapa extraído reduzem entry JS a 318,01 kB. Migrations atuais 1–7; testes reais PostgreSQL/PostGIS preparados e não executados. P0 permanece parcial.
