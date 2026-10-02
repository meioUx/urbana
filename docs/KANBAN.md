# Quadro de equipes

O quadro usa as etapas reais da manutenção viária. Uma ocorrência sem OS é um cartão; depois da programação, cada OS representa um item de trabalho, inclusive quando atende vários chamados. Nenhuma movimentação cria uma cópia visual do registro.

As etapas seguem a fonte canônica `server/domain/workflow.js`: **Identificada → Pronta para programar → Programada → Em deslocamento/Em execução → Aguardando validação → Concluída**, com recusa antes da OS, devolução para reprogramação, cancelamento durante a execução e reabertura para correção. O quadro usa essas transições reais; não cria estados próprios.

## Movimentação e ordenação

- Arraste um cartão para outra coluna para abrir a confirmação da etapa. No celular, use o puxador de pontos. O controle **Mover...** oferece as mesmas ações por teclado ou toque.
- Na mesma coluna, solte sobre outro cartão para colocá-lo antes dele; solte no espaço livre para colocá-lo no final. A seta para cima coloca o cartão no topo. A ordem fica no banco e é compartilhada pelos usuários.
- Triagem pede classificação, setor e prioridade. Programação pede equipe, data e responsável; pode designar um operador. Início pede coordenadas de chegada e fotos de antes quando exigidas. Envio para validação pede relato, fotos de depois e materiais exigidos. Validação pede confirmação de conferência. Recusa, devolução, cancelamento e reabertura pedem justificativa.
- As opções respeitam o perfil e a etapa atual. Ao cancelar o formulário, o cartão continua na etapa original. Conflitos e falhas aparecem na tela. Se o salvamento funcionar e a atualização falhar, o formulário permite atualizar sem repetir a operação.
- Fotografias e materiais podem ser consultados e registrados em **Abrir fotos, materiais e detalhes**. Depois, repita a movimentação desejada.

## Acordos e limites

Em **Regras do quadro**, gestores e administradores definem os limites por etapa. Eles valem para o quadro completo, incluindo todos os setores e equipes, e ficam salvos no banco. Zero significa sem limite; o sistema não presume a capacidade das equipes. Ajuste os valores em conjunto com a operação.

O servidor impede novas entradas em uma etapa cheia, inclusive por formulários externos ao quadro. A transação preserva status, auditoria e vínculos se não houver capacidade. Reduzir um limite abaixo da quantidade atual permite diminuir a fila, mas bloqueia novas entradas. Reordenar ou atualizar dados de um cartão que já está naquela etapa não consome outra vaga.

Faça uma revisão diária curta: confira devoluções, prazos vencidos, os itens mais antigos e a capacidade antes de puxar novos serviços. A ordem inicial usa prioridade e antiguidade; depois, a equipe pode ajustar a ordem de atendimento por arraste. Revise os limites e o tempo de entrega periodicamente.

## Indicadores

Os indicadores respeitam o setor e a equipe selecionados; busca textual, prioridade e ocultação de encerradas não distorcem o histórico de entregas.

| Indicador | Definição |
| --- | --- |
| OS em andamento | OS programadas e ainda não concluídas ou canceladas, incluindo espera, validação e devolução |
| Entregas em 30 dias | OS validadas nos últimos 30 dias, contadas uma vez por OS |
| OS mais antiga | Idade da OS aberta mais antiga desde a programação inicial |
| Ciclo médio em 30 dias | Média do tempo entre programação inicial e validação das OS entregues no período |

Reprogramações mantêm o início original do fluxo. Recusas e cancelamentos não contam como entregas. Sem amostras válidas, idade e ciclo mostram um traço. Os prazos de atendimento continuam definidos pelo SLA das categorias; não são apresentados como previsão estatística.

Conceitos de fluxo, limites de trabalho e métricas: [The Kanban Guide](https://kanbanguides.org/the-kanban-guide/2025.5/).

## Menu lateral

- **Ocorrências:** Todas as ocorrências, Triagem, Ordens de serviço e Análise de campo.
- **Operações:** Controle do setor, Equipes, Materiais, Equipamentos e Operação de campo.
- Visão geral, Mapa territorial, Kanban de equipes e Planejamento têm acesso direto. Administração aparece para administradores.

Os grupos são recolhíveis, indicam a área ativa e permitem rolar o menu em telas baixas. Materiais abre o almoxarifado e o catálogo; Equipamentos tem sua própria página.

## Verificação

`npm test` cobre regras de transição, métricas, ordenação, autorização, conflitos e limites transacionais. Após `npm run build`, `npm run test:kanban` verifica arraste real, ordenação após recarregar, limite cheio, cancelamento de movimentação, programação por teclado, exigência de evidências, submenus e layout no celular. `npm run test:ui` e `npm run test:field` verificam os fluxos já existentes.
