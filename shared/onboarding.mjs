import {
  actionRoles,
  hasModuleAccess,
  moduleCatalog,
} from "./authorization.mjs";
export { ONBOARDING_VERSION } from "./onboarding-version.mjs";
export const operationFlow = [
  "Demanda",
  "Triagem",
  "Programação",
  "Execução",
  "Validação",
  "Conclusão",
];
export const roleJourneys = {
  Administrador: {
    title: "Prepare o Urbana para a operação",
    description:
      "Você prepara o ambiente, organiza a estrutura e libera os acessos para que cada pessoa possa trabalhar.",
    workflow: [
      "Configurar",
      "Estruturar",
      "Criar usuários",
      "Liberar acessos",
      "Acompanhar",
    ],
    participation: [],
    handoff:
      "Depois de criar o usuário, ele acessa somente os módulos liberados e executa as ações do próprio perfil.",
    cta: "Começar a administrar",
  },
  Gestor: {
    title: "Transforme demandas em serviços programados",
    description:
      "Você prioriza atendimentos, programa e distribui serviços e acompanha a operação.",
    workflow: [
      "Priorizar",
      "Programar",
      "Distribuir",
      "Acompanhar",
      "Resolver exceções",
    ],
    participation: [2, 4],
    handoff:
      "Depois da programação, a equipe recebe a OS. Após a execução, a gestão ou fiscalização confere o resultado.",
    cta: "Ir para a operação",
  },
  Triagem: {
    title: "Prepare a demanda para atendimento",
    description:
      "Você analisa as ocorrências, confere as informações e prepara as demandas para a programação.",
    workflow: ["Receber", "Analisar", "Classificar", "Encaminhar"],
    participation: [1],
    handoff:
      "Sua responsabilidade termina quando a demanda está corretamente preparada. A gestão decide a programação do atendimento.",
    cta: "Ir para minhas demandas",
  },
  "Equipe de Campo": {
    title: "Execute sua Ordem de Serviço",
    description:
      "Você recebe os serviços da sua equipe, realiza o atendimento e registra as evidências do trabalho.",
    workflow: [
      "Receber",
      "Assumir",
      "Chegar",
      "Executar",
      "Registrar",
      "Enviar",
    ],
    participation: [3],
    handoff:
      "Enviar para análise coloca a OS em Aguardando validação. A gestão ou fiscalização confere antes de concluir definitivamente.",
    cta: "Ver minhas tarefas",
  },
  Fiscalização: {
    title: "Confira o serviço executado",
    description:
      "Você confere os serviços enviados pelas equipes e decide se o atendimento pode ser validado ou precisa de correção.",
    workflow: [
      "Receber",
      "Conferir informações",
      "Conferir evidências",
      "Validar ou reabrir",
    ],
    participation: [4],
    handoff:
      "Ao validar, a OS fica Concluída. Ao reabrir com motivo, o serviço retorna à execução para correção.",
    cta: "Ver serviços para conferência",
  },
  Consulta: {
    title: "Acompanhe a operação",
    description:
      "Você pesquisa e acompanha as informações nos módulos liberados. Seu perfil possui acesso para consulta.",
    workflow: ["Pesquisar", "Localizar", "Consultar", "Acompanhar"],
    participation: [],
    handoff:
      "Você acompanha a cadeia do atendimento, sem editar, programar, executar ou validar registros.",
    cta: "Começar a consultar",
  },
};
const step = (id, module, title, description, options = {}) => ({
  id,
  module,
  title,
  description,
  target: '[data-guide="page-heading"]',
  ...options,
});
const mapStep = step(
  "map",
  "map",
  "Entenda o território",
  "Use os filtros para localizar demandas. Selecione um ponto para consultar o resumo do atendimento e as evidências disponíveis. O mapa completo reúne esses recursos em uma tela dedicada.",
  {
    stage: "Localizar",
    target: '[data-guide="map"]',
    map: true,
    checklist: "consultar pontos, filtros e resumos no mapa",
  },
);
const definitions = {
  Administrador: [
    step(
      "settings",
      "admin",
      "Confira o ambiente do município",
      "Comece pelo nome do município e pela distância usada para alertar sobre possíveis duplicatas. Revise os campos e salve quando estiver preparando o ambiente, após sair do treinamento.",
      {
        adminTab: "settings",
        target: '[data-guide="settings"]',
        stage: "Configurar",
        action: "admin",
        checklist: "conferir as configurações do município",
      },
    ),
    step(
      "structure",
      "admin",
      "Organize a estrutura operacional",
      "Secretarias e departamentos organizam os setores. Categorias definem serviços, setor padrão, prazos por prioridade e exigências de evidência. Essas informações serão utilizadas nos atendimentos.",
      {
        adminTab: "categorias",
        target: '[data-guide="admin-tabs"]',
        stage: "Estruturar",
        action: "admin",
        checklist: "organizar setores e categorias",
      },
    ),
    step(
      "teams",
      "teams",
      "Prepare as equipes",
      "Cadastre as equipes no setor correspondente e informe responsável e integrantes. A equipe e a demanda precisam pertencer ao mesmo setor. A quantidade de integrantes não representa uma agenda de disponibilidade.",
      {
        target: '[data-guide="teams"]',
        stage: "Estruturar",
        action: "admin",
        requiresModules: ["admin"],
        checklist: "conferir equipes e setores",
      },
    ),
    step(
      "users",
      "admin",
      "Crie as pessoas que usarão o Urbana",
      "Em Novo usuário, informe nome, e-mail e senha, selecione o perfil e vincule uma equipe quando for Equipe de Campo. Escolha os módulos compatíveis e salve quando estiver pronto. O treinamento não cria usuários.",
      {
        adminTab: "users",
        guideMode: "new-user",
        target: '[data-guide="user-fields"]',
        stage: "Criar usuários",
        action: "admin",
        checklist: "criar usuários com perfil e equipe corretos",
      },
    ),
    step(
      "access",
      "admin",
      "Libere somente os acessos necessários",
      "Perfil define o que a pessoa pode fazer; módulos definem onde ela pode entrar. Use Editar usuário para revisar os acessos. Somente Administradores gerenciam essas liberações; Campo é exclusivo da Equipe de Campo.",
      {
        adminTab: "users",
        guideMode: "new-user",
        target: '[data-guide="module-access"]',
        fallback: '[data-guide="new-user"]',
        stage: "Liberar acessos",
        action: "admin",
        checklist: "gerenciar módulos sem ampliar poderes do perfil",
      },
    ),
    step(
      "audit",
      "admin",
      "Acompanhe quem alterou o sistema",
      "Na auditoria, pesquise as ações e confira responsável, horário e alterações registradas. Mudanças de perfil e módulos guardam a configuração anterior e a nova.",
      {
        adminTab: "audit",
        target: '[data-guide="admin-tabs"]',
        stage: "Acompanhar",
        action: "admin",
        checklist: "consultar alterações na auditoria",
      },
    ),
  ],
  Triagem: [
    step(
      "queue",
      "triagem",
      "Comece pelas demandas a analisar",
      "A fila A analisar reúne ocorrências ainda não classificadas. Confira prioridade, endereço, descrição, localização e situação antes de abrir uma demanda.",
      {
        target: '[data-guide="triage-queue"]',
        filter: "IDENTIFICADA",
        stage: "Receber",
        checklist: "encontrar demandas que precisam de análise",
      },
    ),
    step(
      "inspect",
      "triagem",
      "Abra e entenda a ocorrência",
      "Abra uma ocorrência e leia o contexto: endereço, descrição, solicitante, categoria e evidências disponíveis. Uma ocorrência é a demanda; ela ainda não é uma Ordem de Serviço.",
      {
        detail: "occurrence",
        states: ["IDENTIFICADA", "EM_TRIAGEM"],
        target: '[data-guide="detail-summary"]',
        fallback: '[data-guide="page-heading"]',
        stage: "Analisar",
        checklist: "conferir informações antes de decidir",
      },
    ),
    step(
      "classify",
      "triagem",
      "Qualifique a demanda",
      "Selecione categoria e subcategoria, quando disponível. Confira prioridade e setor responsável. Salvar triagem prepara a demanda para a gestão, sem programar ou executar uma OS.",
      {
        detail: "occurrence",
        states: ["IDENTIFICADA", "EM_TRIAGEM"],
        target: '[data-guide="classification"]',
        fallback: '[data-guide="detail-summary"], [data-guide="page-heading"]',
        stage: "Classificar",
        action: "classify",
        checklist: "classificar categoria, prioridade e setor",
      },
    ),
    step(
      "refuse",
      "triagem",
      "Decida se a demanda deve seguir",
      "Quando a demanda não puder prosseguir, use Recusar e informe uma justificativa clara. A decisão e seu motivo ficam registrados no histórico. Não recuse uma demanda apenas para aprender.",
      {
        detail: "occurrence",
        states: ["IDENTIFICADA", "EM_TRIAGEM"],
        target: '[data-guide="refuse"]',
        fallback: '[data-guide="detail-summary"], [data-guide="page-heading"]',
        stage: "Encaminhar",
        action: "classify",
        checklist: "recusar com justificativa quando necessário",
      },
    ),
    step(
      "handoff",
      "triagem",
      "Confira o que já foi preparado",
      "Em Prontas para programar, acompanhe as demandas classificadas. Depois da análise, a gestão define equipe e data. Sua parte termina quando as informações estão corretas para essa próxima etapa.",
      {
        target: '[data-guide="triage-queue"]',
        filter: "EM_TRIAGEM",
        stage: "Encaminhar",
        checklist: "acompanhar pendências e a passagem para a gestão",
      },
    ),
    { ...mapStep, stage: "Analisar" },
  ],
  Gestor: [
    step(
      "ready",
      ["dashboard", "triagem", "orders", "planning"],
      "Identifique o que precisa ser atendido",
      "Comece pelas demandas já analisadas. Confira prioridade, prazo, setor, localização e contexto disponível para decidir o atendimento. Os indicadores mostram demandas, serviços e carga registrada; não calculam capacidade real por jornada.",
      {
        target: '[data-guide="triage-queue"], [data-guide="page-heading"]',
        filter: "EM_TRIAGEM",
        stage: "Priorizar",
        checklist: "priorizar demandas prontas e acompanhar prazos",
      },
    ),
    { ...mapStep, stage: "Priorizar" },
    step(
      "plan",
      "planning",
      "Organize o atendimento quando fizer sentido",
      "Planejamento ajuda a comparar intervenções e agrupar demandas compatíveis da mesma via e setor. Confira prioridade e prazo original. Criar um plano não é obrigatório para emitir uma OS.",
      {
        target: '[data-guide="page-heading"]',
        stage: "Priorizar",
        action: "schedule",
        checklist: "usar planejamento como apoio opcional",
      },
    ),
    step(
      "schedule",
      ["orders", "planning"],
      "Programe e distribua a OS",
      "Abra uma demanda pronta e escolha Gerar ordem de serviço. Selecione equipe do setor, operador quando aplicável, responsável e data; confira prioridade e prazo. Toda a equipe recebe a tarefa quando não há operador específico; uma designação direciona ao profissional escolhido.",
      {
        detail: "occurrence",
        states: ["EM_TRIAGEM"],
        guideMode: "program",
        target: '[data-guide="scheduling"]',
        fallback: '[data-guide="detail-summary"], [data-guide="page-heading"]',
        stage: "Programar",
        includesStages: ["Distribuir"],
        action: "schedule",
        checklist: "programar e distribuir para equipe ou operador",
      },
    ),
    step(
      "track",
      ["kanban", "orders", "dashboard"],
      "Acompanhe a passagem de responsabilidade",
      "Programada aguarda atendimento; Em deslocamento indica equipe a caminho; Em execução indica serviço em andamento. Aguardando validação significa que a equipe enviou o resultado para conferência. Concluída significa execução validada.",
      {
        target: '[data-guide="page-heading"]',
        stage: "Acompanhar",
        checklist: "acompanhar execução e distinguir envio de conclusão",
      },
    ),
    step(
      "returned",
      ["orders", "planning"],
      "Resolva os impedimentos da operação",
      "Uma OS Devolvida precisa de análise da gestão. Abra o atendimento, leia a justificativa e use a programação disponível para escolher nova equipe, operador ou data. Reprogramar não reinicia o prazo original da demanda.",
      {
        detail: "order",
        states: ["DEVOLVIDA"],
        target: '[data-guide="assignment"]',
        fallback: '[data-guide="detail-summary"], [data-guide="page-heading"]',
        filter: "DEVOLVIDA",
        stage: "Resolver exceções",
        action: "schedule",
        checklist: "ler o motivo e reprogramar uma OS devolvida",
      },
    ),
  ],
  "Equipe de Campo": [
    step(
      "tasks",
      "field",
      "Encontre e confira sua tarefa",
      "Suas Ordens de Serviço estão aqui. Veja prioridade, endereço, serviço, prazo e situação. Abra a tarefa antes de sair para conferir as instruções. Você vê os serviços da sua equipe ou atribuídos a você.",
      {
        target: '[data-guide="field-task"]',
        fallback: '[data-guide="field-tasks"]',
        stage: "Receber",
        checklist: "encontrar e abrir suas tarefas",
      },
    ),
    step(
      "assume",
      "field",
      "Informe que está a caminho",
      "Em uma tarefa A fazer, use Estou a caminho para assumir o deslocamento. A situação passa de Programada para Em deslocamento. Esse registro é feito no trabalho real, depois de encerrar o treinamento.",
      {
        detail: "field",
        states: ["PROGRAMADA"],
        target: '[data-guide="field-assume"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        stage: "Assumir",
        action: "execute",
        transition: ["PROGRAMADA", "EM_DESLOCAMENTO"],
        checklist: "assumir o deslocamento quando disponível",
      },
    ),
    step(
      "arrival",
      "field",
      "Registre a chegada e a situação encontrada",
      "No local, capture o GPS ou informe as coordenadas. Se a categoria exigir foto anterior, registre a situação encontrada antes de executar. Depois utilize Confirmar chegada e iniciar serviço. As exigências reais da categoria continuam valendo.",
      {
        detail: "field",
        states: ["PROGRAMADA", "EM_DESLOCAMENTO"],
        target: '[data-guide="field-arrival"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        stage: "Chegar",
        action: "execute",
        transition: ["EM_DESLOCAMENTO", "EM_EXECUCAO"],
        checklist:
          "registrar chegada, localização e foto anterior quando exigida",
      },
    ),
    step(
      "execute",
      "field",
      "Execute e registre os recursos utilizados",
      "Com o atendimento Em execução, realize o serviço e informe material e quantidade utilizados quando aplicável. Confira as evidências solicitadas. A tela móvel atual permite registrar materiais; equipamentos existentes podem ser consultados nas informações da OS.",
      {
        detail: "field",
        states: ["EM_EXECUCAO"],
        target: '[data-guide="field-materials"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        stage: "Executar",
        action: "execute",
        checklist: "registrar materiais e evidências da execução",
      },
    ),
    step(
      "send",
      "field",
      "Registre o resultado e envie para conferência",
      "Adicione a foto depois, quando exigida, e aguarde a confirmação do envio. Em O que foi feito, descreva o serviço realizado. Enviar para análise deixa a OS Aguardando validação: a gestão ou fiscalização confere antes da conclusão definitiva.",
      {
        detail: "field",
        states: ["EM_EXECUCAO"],
        target: '[data-guide="field-send"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        stage: "Enviar",
        includesStages: ["Registrar"],
        action: "execute",
        transition: ["EM_EXECUCAO", "AGUARDANDO_VALIDACAO"],
        checklist: "registrar foto posterior, relato e enviar para validação",
      },
    ),
    step(
      "return",
      "field",
      "Não conseguiu executar? Informe o motivo",
      "Use Não foi possível executar, descreva o impedimento e devolva a OS. Ela fica Devolvida à gestão para análise e reprogramação. Informe um motivo que ajude a gestão a decidir o próximo atendimento.",
      {
        detail: "field",
        states: ["PROGRAMADA", "EM_DESLOCAMENTO", "EM_EXECUCAO"],
        target: '[data-guide="field-return"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        stage: "Enviar",
        action: "execute",
        transition: ["EM_EXECUCAO", "DEVOLVIDA"],
        checklist: "devolver com justificativa quando houver impedimento",
      },
    ),
  ],
  Fiscalização: [
    step(
      "review",
      "review",
      "Veja os serviços que aguardam conferência",
      "A equipe enviou a execução e a OS ficou Aguardando validação. Abra um atendimento dessa fila para verificar o resultado. Serviços devolvidos são impedimentos da operação, não execuções prontas para aprovação.",
      {
        target: '[data-guide="review"]',
        stage: "Receber",
        checklist: "encontrar serviços aguardando validação",
      },
    ),
    step(
      "inspect",
      "review",
      "Confira o atendimento e o relato",
      "No detalhe da OS, confira demanda, serviço, endereço, equipe, relato de execução e materiais quando aplicável. Compare essas informações com o atendimento solicitado.",
      {
        detail: "order",
        states: ["AGUARDANDO_VALIDACAO"],
        target: '[data-guide="detail-summary"]',
        fallback: '[data-guide="review"]',
        stage: "Conferir informações",
        checklist: "conferir informações, relato e recursos",
      },
    ),
    step(
      "evidence",
      "review",
      "Compare as evidências disponíveis",
      "Na aba Evidências, veja as imagens antes e depois e os demais registros. Utilize as evidências para conferir o resultado informado pela equipe. Ausência de imagem não deve ser preenchida com uma foto demonstrativa.",
      {
        detail: "order",
        states: ["AGUARDANDO_VALIDACAO"],
        detailTab: "evidence",
        target: '[data-guide="evidence"]',
        fallback: '[data-guide="detail-summary"], [data-guide="review"]',
        stage: "Conferir evidências",
        checklist: "comparar evidências antes e depois",
      },
    ),
    step(
      "validate",
      "review",
      "Se estiver adequado, valide",
      "Depois de conferir relato e evidências, use Validar e concluir. A situação passa de Aguardando validação para Concluída. Somente a validação encerra definitivamente o atendimento.",
      {
        detail: "order",
        states: ["AGUARDANDO_VALIDACAO"],
        target: '[data-guide="validate"]',
        fallback: '[data-guide="detail-summary"], [data-guide="review"]',
        stage: "Validar ou reabrir",
        action: "validate",
        transition: ["AGUARDANDO_VALIDACAO", "CONCLUIDA"],
        checklist: "validar o atendimento quando adequado",
      },
    ),
    step(
      "reopen",
      "review",
      "Se precisar de correção, explique o motivo",
      "Use a reabertura disponível e informe claramente o que precisa ser corrigido. A OS retorna para Em execução. A equipe precisa entender a justificativa para refazer ou complementar o trabalho.",
      {
        detail: "order",
        states: ["AGUARDANDO_VALIDACAO", "CONCLUIDA"],
        target: '[data-guide="reopen"]',
        fallback: '[data-guide="detail-summary"], [data-guide="review"]',
        stage: "Validar ou reabrir",
        action: "validate",
        transition: ["AGUARDANDO_VALIDACAO", "EM_EXECUCAO"],
        checklist: "reabrir com motivo claro quando houver correção",
      },
    ),
    { ...mapStep, stage: "Conferir informações" },
  ],
  Consulta: [
    step(
      "dashboard",
      "dashboard",
      "Entenda a visão geral",
      "Consulte indicadores de demandas, atendimentos, prioridades e prazos. Você acompanha a operação sem realizar alterações.",
      {
        stage: "Acompanhar",
        checklist: "acompanhar os indicadores disponíveis",
      },
    ),
    step(
      "search",
      "occurrences",
      "Encontre a demanda que precisa consultar",
      "Use a pesquisa e os filtros de situação, prioridade, categoria e período. Abra um resultado para conferir informações e histórico. Seu acesso é de consulta.",
      {
        target: '[data-guide="filters"]',
        stage: "Pesquisar",
        checklist: "pesquisar e filtrar demandas",
      },
    ),
    step(
      "occurrence",
      "occurrences",
      "Consulte o contexto da ocorrência",
      "No detalhe, leia a descrição, endereço, categoria, situação e evidências. Uma ocorrência representa a demanda; uma OS representa o atendimento programado.",
      {
        detail: "occurrence",
        target: '[data-guide="detail-summary"]',
        fallback: '[data-guide="page-heading"]',
        stage: "Consultar",
        checklist: "consultar informações e histórico de ocorrências",
      },
    ),
    step(
      "orders",
      "orders",
      "Acompanhe o atendimento",
      "Abra uma OS para consultar equipe, programação, prazo, situação e evidências disponíveis. Acompanhar um serviço não concede permissão para alterar ou validar.",
      {
        detail: "order",
        target: '[data-guide="detail-summary"]',
        fallback: '[data-guide="page-heading"]',
        stage: "Consultar",
        checklist: "consultar situação e evidências das OS",
      },
    ),
    { ...mapStep, stage: "Localizar" },
  ],
};
const tutorialNames = {
  settings: "Como conferir as configurações",
  structure: "Como organizar a estrutura",
  teams: "Como preparar as equipes",
  users: "Como criar usuários",
  access: "Como gerenciar acessos",
  audit: "Como consultar a auditoria",
  queue: "Onde chegam as demandas",
  inspect: "Como conferir as informações",
  classify: "Como classificar uma demanda",
  refuse: "Como recusar uma demanda",
  handoff: "Como acompanhar demandas preparadas",
  ready: "Como priorizar atendimentos",
  plan: "Como utilizar o planejamento",
  schedule: "Como programar e distribuir um atendimento",
  track: "Como acompanhar uma OS",
  returned: "Como tratar uma OS devolvida",
  tasks: "Como encontrar minhas tarefas",
  assume: "Como assumir uma OS",
  arrival: "Como iniciar uma OS e registrar a foto antes",
  execute: "Como informar materiais",
  send: "Como registrar fotos e finalizar meu atendimento",
  return: "O que fazer quando não consigo executar",
  review: "Onde estão os serviços para conferência",
  evidence: "Como comparar as evidências",
  validate: "Como validar um atendimento",
  reopen: "Como solicitar correção",
  dashboard: "Como acompanhar os indicadores",
  search: "Como pesquisar uma demanda",
  occurrence: "Como consultar uma ocorrência",
  orders: "Como consultar uma OS",
  map: "Como utilizar o mapa",
};
export function getJourney(user) {
  const base = roleJourneys[user.role];
  if (!base) return null;
  const steps = (definitions[user.role] || []).flatMap((raw) => {
    const module = (Array.isArray(raw.module) ? raw.module : [raw.module]).find(
      (m) => hasModuleAccess(user, m),
    );
    if (
      !module ||
      raw.requiresModules?.some((m) => !hasModuleAccess(user, m)) ||
      (raw.action && !(actionRoles[raw.action] || []).includes(user.role))
    )
      return [];
    return [
      {
        ...raw,
        module,
        page: module,
        path: moduleCatalog.find((m) => m.key === module).path,
      },
    ];
  });
  // Profiles with only a secondary reading module still receive useful guidance.
  if (!steps.length) {
    const module = moduleCatalog.find((m) => hasModuleAccess(user, m.key));
    if (module)
      steps.push({
        ...step(
          "available",
          module.key,
          "Comece pelo seu ambiente disponível",
          "Use as informações disponíveis nesta área para cumprir sua função. A Ajuda acompanha os módulos liberados e nunca muda seus acessos.",
          {
            stage: base.workflow[0],
            checklist: "localizar o ambiente liberado para seu usuário",
          },
        ),
        page: module.key,
        path: module.path,
      });
  }
  return {
    ...base,
    role: user.role,
    steps,
    workflow: base.workflow.filter((stage) =>
      steps.some((s) => s.stage === stage || s.includesStages?.includes(stage)),
    ),
  };
}
const extraTutorials = {
  "Equipe de Campo": [
    step(
      "photo-before",
      "field",
      "Fotografe a situação encontrada",
      "Na área Foto antes do serviço, selecione uma imagem real do local. Capture a localização e use Enviar foto antes. Aguarde a confirmação de envio. Quando a categoria exigir essa evidência, ela precisa estar registrada antes de iniciar.",
      {
        stage: "Registrar",
        action: "execute",
        detail: "field",
        states: ["PROGRAMADA", "EM_DESLOCAMENTO"],
        target: '[data-guide="field-photo-before"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        checklist: "registrar a foto anterior quando exigida",
      },
    ),
    step(
      "photo-after",
      "field",
      "Registre o resultado do atendimento",
      "Em Foto depois do serviço, selecione uma imagem do resultado e envie com a localização. Aguarde Foto enviada antes de mandar o atendimento para análise. A foto posterior pode ser exigida pela categoria.",
      {
        stage: "Registrar",
        action: "execute",
        detail: "field",
        states: ["EM_EXECUCAO"],
        target: '[data-guide="field-photo-after"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        checklist: "registrar e conferir o envio da foto posterior",
      },
    ),
    step(
      "report",
      "field",
      "Relate o que foi realizado",
      "No campo O que foi feito, descreva o serviço e as condições encontradas. Registre o resultado de forma objetiva. Depois do relato e das evidências exigidas, Enviar para análise encaminha à gestão ou fiscalização; ainda não é a conclusão definitiva.",
      {
        stage: "Registrar",
        action: "execute",
        detail: "field",
        states: ["EM_EXECUCAO"],
        target: '[data-guide="field-report"]',
        fallback: '[data-guide="field-summary"], [data-guide="field-tasks"]',
        checklist: "escrever um relato objetivo da execução",
      },
    ),
  ],
  Gestor: [
    step(
      "distribution",
      ["orders", "planning"],
      "Escolha equipe ou operador",
      "Na programação, escolha uma equipe do setor da demanda. Toda a equipe compartilha a tarefa quando não há operador designado. Selecionar um operador direciona o atendimento àquela pessoa da equipe. Confira responsável, data e prazo antes de salvar fora do treinamento.",
      {
        stage: "Distribuir",
        action: "schedule",
        detail: "occurrence",
        states: ["EM_TRIAGEM"],
        guideMode: "program",
        target: '[data-guide="scheduling"]',
        fallback: '[data-guide="detail-summary"], [data-guide="page-heading"]',
        checklist: "distribuir para a equipe ou um operador",
      },
    ),
    step(
      "team-load",
      "teams",
      "Consulte a distribuição das equipes",
      "Veja setor, responsável, integrantes e Ordens de Serviço ativas. Use a carga registrada para acompanhar a distribuição. Ela não informa disponibilidade real por jornada.",
      {
        stage: "Acompanhar",
        target: '[data-guide="teams"]',
        fallback: '[data-guide="page-heading"]',
        checklist: "acompanhar equipes e carga registrada",
      },
    ),
  ],
};
export function getTutorials(user) {
  const journey = getJourney(user);
  const extra = (extraTutorials[user.role] || []).flatMap((raw) => {
    const module = (Array.isArray(raw.module) ? raw.module : [raw.module]).find(
      (m) => hasModuleAccess(user, m),
    );
    if (
      !module ||
      (raw.action && !actionRoles[raw.action]?.includes(user.role))
    )
      return [];
    return [
      {
        ...raw,
        module,
        page: module,
        path: moduleCatalog.find((m) => m.key === module).path,
      },
    ];
  });
  return journey
    ? [...journey.steps, ...extra].map((s) => ({
        id: "task:" + s.id,
        title:
          {
            "photo-before": "Como registrar a foto antes",
            "photo-after": "Como registrar a foto depois",
            report: "Como relatar minha execução",
            distribution: "Como distribuir para equipe ou operador",
            "team-load": "Como acompanhar as equipes",
          }[s.id] ||
          tutorialNames[s.id] ||
          s.title,
        steps: [s],
      }))
    : [];
}
export function getTutorial(user, id) {
  if (id === "main") return getJourney(user);
  const journey = getJourney(user),
    tutorial = getTutorials(user).find((t) => t.id === id);
  return tutorial
    ? {
        ...journey,
        ...tutorial,
        workflow: [
          ...new Set([
            ...journey.workflow,
            ...tutorial.steps.map((s) => s.stage),
          ]),
        ].filter((stage) =>
          tutorial.steps.some(
            (s) => s.stage === stage || s.includesStages?.includes(stage),
          ),
        ),
      }
    : null;
}
export function canOfferOnboarding(user, state) {
  return (
    !!getJourney(user)?.steps.length &&
    (!state || state.status === "not_started" || state.status === "started")
  );
}
