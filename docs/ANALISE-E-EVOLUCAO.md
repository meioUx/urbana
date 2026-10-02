# Análise e evolução do sistema Urbana

Avaliação realizada em 1 de outubro de 2026, por leitura do código e testes automatizados da API e da interface desktop e móvel. Não substitui uma sessão de observação com servidores municipais e operadores reais.

## Fluxo e resultado operacional

O fluxo principal é coerente: registro → triagem → programação de OS → deslocamento e chegada → execução → envio para validação → conclusão validada. Devolução permite revisão da programação; reabertura exige justificativa e novas evidências conforme o ciclo. O resultado enviado pelo operador permanece pendente até análise da gestão ou fiscalização.

Os testes existentes verificam permissões, duplicidade, evidências obrigatórias, consumo, validação, auditoria, persistência, planejamento por rua, distribuição individual, devoluções e integração entre notas fiscais, estoque e custos. Os testes móveis exercitam recuperação de rascunhos e reenvio de foto sem duplicação. Isso oferece uma base funcional consistente para evoluir a experiência.

## Problemas encontrados e melhorias implementadas

| Achado | Efeito para o usuário | Melhoria |
| --- | --- | --- |
| Painel com indicadores sem acesso direto às principais pendências | Usuário precisa descobrir onde agir | Filas com contadores e acesso filtrado à triagem, devoluções, validação e prazos vencidos |
| Detalhe sem explicação uniforme de próxima etapa | Dúvida sobre responsabilidade e sequência | Guia de andamento, próximo passo e resultado final |
| Exigências de fotos e materiais descobertas somente ao executar a ação | Tentativas frustradas | Lista das exigências reais das categorias relacionadas, considerando evidências do ciclo atual |
| Sucesso pouco explícito nas ações do detalhe e do operador | Dúvida entre envio, validação e encerramento | Mensagens específicas para cada ação e confirmação persistente no detalhe |
| Falha de atualização após gravação tratada como falha da operação | Risco de repetir uma operação já salva | Separação entre gravação confirmada e falha ao atualizar os dados nos fluxos tratados |
| Timeout ou perda de conexão orientava repetir o envio | Resultado da gravação pode ser desconhecido | Orientação para conferir o registro antes de reenviar |
| Atualização automática falhava silenciosamente | Dados antigos pareciam atuais | Aviso de falha, horário da última atualização e atualização manual |
| Almoxarifado permanecia carregando após erro inicial | Módulo inutilizável sem recarregar a página | Erro visível com tentativa de recuperação e confirmação do movimento |
| Contador da navegação de triagem considerava só identificadas | Contador divergia da fila exibida | Mesma seleção de estados na navegação e na fila |

As mensagens e orientações complementam as regras do servidor. Não alteram permissões nem dispensam requisitos de validação.

## Usabilidade

A interface oferece navegação lateral, filtros, mapa, histórico e formulários específicos para campo. O guia novo reduz a necessidade de conhecer os nomes técnicos dos estados. As filas destacam a tarefa a executar antes dos indicadores gerais. Os componentes novos adaptam-se à largura móvel e usam anúncios de status e erro para tecnologias assistivas.

## Limites e próximas evoluções

1. **Confirmação de gravação em todos os formulários:** ampliar o tratamento separado de salvamento e atualização aos cadastros, planos e notas fiscais. Os fluxos corrigidos nesta entrega não cobrem todos os formulários.
2. **Concorrência:** introduzir controle de versão no servidor para impedir que duas pessoas sobrescrevam alterações simultâneas. A atualização periódica não resolve esse problema.
3. **Sessão expirada:** evoluir para recuperação centralizada da autenticação, preservando formulários e rascunhos antes de pedir novo login. Nesta entrega, a atualização automática informa a expiração.
4. **Escala de dados:** paginação e filtros no servidor, carregamento por módulo e divisão do JavaScript. A compilação ainda avisa sobre um arquivo acima de 500 kB.
5. **Validação operacional:** observar usuários reais em triagem, execução e fiscalização, medindo tempo por tarefa, abandonos e erros. Não atribuir uma nota de usabilidade sem essa evidência.
6. **Integrações e publicação:** homologar PostgreSQL/PostGIS reais, infraestrutura e restauração de backups antes de uso municipal em produção.

## Validação desta entrega

- Compilação TypeScript e Vite concluída.
- 17 testes automatizados existentes passaram.
- Teste de navegador desktop (1440 × 1000) e móvel (390 × 844) passou, incluindo fila de validação e orientação/feedback da triagem.
- Teste de campo passou com rascunho recuperado, reenvio sem duplicação, atribuição individual, execução e revisão pela gestão.
- Nenhum erro de JavaScript capturado nos dois testes de navegador.
- Captura do painel desktop revisada visualmente.

Os testes usam bancos temporários isolados. A aprovação dos testes não comprova desempenho sob carga nem homologação das integrações externas.

## Evolução: distribuição com contexto operacional

A abertura de uma ocorrência identificada ou em triagem agora inclui as operações abertas do setor e o planejamento de suas vias. Cada equipe mostra OS abertas, chamados distintos vinculados, execução/deslocamento, programação, validações, devoluções, prazos vencidos e compromissos na data escolhida. Os vínculos vêm da tabela de relacionamento do banco, incluindo ordens demonstrativas anteriores.

A programação individual deixa de selecionar a primeira equipe automaticamente. É possível selecionar a equipe por seu cartão de carga. A mesma visão aparece na programação de um plano e na redistribuição/reprogramação de uma OS, excluindo a própria ordem da carga para não contar sua atribuição duas vezes.

As operações mostram status, equipe, responsável ou operador, data e endereços; na triagem, pode-se abrir a OS relacionada. O planejamento mostra vias com chamados abertos, planos ativos, prioridade, objetivo, data, responsável e a via da ocorrência atual. A consulta é atualizada a cada 15 segundos e informa falhas de atualização.

“Sem operação em andamento” descreve apenas os registros do sistema. Ainda não há agenda de turnos, férias, duração estimada ou reservas por horário. Os compromissos na data são um alerta para revisão, não uma garantia de conflito nem um bloqueio absoluto: mais de um serviço pode caber no mesmo dia. O acesso respeita os perfis existentes; a função de triagem consulta o contexto e a gestão continua responsável por programar.

Validação ampliada: 19 testes de unidade/API passaram; o navegador verifica seleção explícita pelo cartão, contagem real de chamados, aviso de compromissos na data e largura móvel. O fluxo de campo também passou após a integração.

## Evolução: mapa territorial de calor

O mapa territorial alterna entre pontos individuais e uma camada de calor por concentração das ocorrências. Os dois modos usam os mesmos filtros; cada ocorrência tem peso igual. A sobreposição espacial aumenta a intensidade, e o zoom altera a concentração visual. A legenda explicita essa interpretação, sem apresentar a intensidade como risco ou prioridade. A lista de registros permanece disponível para abrir os detalhes no modo de calor.

A busca de endereço agora é opcional no componente de mapa: permanece no mapa territorial e no panorama, mas não aparece nos detalhes com localização já registrada. O teste de navegador verifica camada desenhada, alteração por filtro, alternância de modo, zoom, ausência da busca no detalhe e ausência de transbordamento no celular.

## Evolução: Kanban de equipes

A navegação inclui **Kanban de equipes** com colunas de identificadas, triagem, programação, deslocamento, execução, validação e devoluções. Concluídas e canceladas podem ser incluídas por opção. Cada equipe tem uma cor consistente nos cartões e no resumo de carga; os nomes permanecem visíveis para não depender apenas das cores.

O quadro representa demandas sem OS por cartões de ocorrência e agrupa os chamados vinculados em um único cartão da OS. Os filtros incluem setor, equipe, demandas sem equipe, prioridade e busca por via, código ou responsável. O resumo informa OS abertas, chamados, operações em andamento e programação, independentemente dos filtros de busca e prioridade.

Os cartões abrem a triagem, programação/reprogramação ou execução/validação conforme o estado e as permissões. A mudança de etapa usa os formulários existentes com evidências, justificativas e validação do servidor; o quadro não move cartões apenas por arraste. A atualização do fluxo também atualiza o quadro. O layout tem rolagem horizontal interna, incluindo no celular.

Foram acrescentados testes para agrupamento de chamados, redistribuição entre equipes, filtros e acesso à triagem pelo cartão.

## Evolução: visão geral como dashboard de operações

A visão geral passa a mostrar seis indicadores consolidados: demandas abertas, ordens abertas, equipes em operação, prazos vencidos, pendências de validação e OS concluídas. Quatro painéis apresentam evolução diária, distribuição dos estados das OS abertas, carga por equipe e prioridades das demandas, com resumo dos bairros de maior concentração.

Foram retirados da visão geral os registros individuais, filas de execução, mapa com pesquisa e botões de criação/exportação. Esses recursos permanecem nas telas de ocorrências, triagem, Kanban, ordens e mapa territorial. A atualização manual dos indicadores e o aviso de falha de atualização permanecem visíveis.

Os indicadores retratam o estado atual. O período de 14, 30 ou 90 dias afeta somente o gráfico de evolução: entradas são ocorrências criadas; saídas são OS atualmente concluídas, na data da validação. As duas séries têm unidades diferentes e não são uma taxa de resolução. OS reabertas deixam de ser contadas como atualmente concluídas. Não há uma série histórica imutável de validações neste gráfico.

O layout adapta os indicadores e gráficos ao celular. A validação no navegador verifica dados do indicador de ordens abertas, troca do período e ausência de listas operacionais, busca de endereço e criação de ocorrência na visão geral.

## Evolução: decisão da triagem

Para os perfis que programam serviços, a triagem oferece **Gerar ordem de serviço** e **Recusar**. A primeira ação abre a programação de equipe/data/responsável; a confirmação envia a classificação e a programação juntas na transação do servidor. Falhas de equipe ou programação desfazem a classificação da mesma solicitação, preservando o estado anterior. A classificação isolada continua disponível pela API e para o perfil de triagem que não tem permissão de programar.

O demonstrativo **Equipes e planejamento de vias** aparece somente após **Gerar ordem de serviço**, dentro da programação. A abertura inicial da triagem e a justificativa de recusa não exibem esse bloco. **Voltar à triagem** fecha a programação e oculta o demonstrativo novamente. Os testes de navegador verificam essas três condições.

**Recusar** abre a justificativa obrigatória e o botão **Enviar**. O servidor permite essa decisão somente em demandas identificadas ou em triagem, sem OS vinculada, para usuários com permissão de classificação. A recusa registra o estado `RECUSADA`, texto do motivo, responsável, data, auditoria. O detalhe exibe a justificativa, e a demanda sai das contagens e filas abertas, do agrupamento de planejamento e da sugestão de duplicidade. Os anexos ficam disponíveis para consulta, mas novos envios são bloqueados após a recusa.

O Kanban permite consultar as recusadas ao mostrar os cartões encerrados. Planos contam as recusas separadamente dos cancelamentos. Não há exclusão do registro nem reaproveitamento silencioso de uma demanda recusada para gerar OS.

Validação: 23 testes de API/unidade passaram, incluindo justificativa vazia, permissões, histórico, bloqueios após recusa e rollback da geração integrada. A interface verifica os botões, formulário da justificativa, envio, histórico e retirada do cartão da fila ativa.
