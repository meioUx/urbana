# Urbana · Gestão de Manutenção Municipal

Implementação do MVP de manutenção viária da especificação fornecida. React + TypeScript, API Express, SQLite local ou PostgreSQL/PostGIS, autenticação por sessão.

## Executar

Requer Node.js 24 ou superior. No PowerShell, utilize `npm.cmd` quando a política local bloquear `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Acesse http://127.0.0.1:3000. Para desenvolvimento com atualização automática: `npm.cmd run dev`. `PORT` permite escolher outra porta; `HOST` é `127.0.0.1` por padrão.

Na primeira execução, o banco e os dados demonstrativos são criados automaticamente. Todos os exemplos operacionais estão sinalizados como demonstrativos. Município e coordenadas iniciais usam Balneário Camboriú como referência, não representam demandas reais.

| Perfil de demonstração | E-mail | Senha inicial |
| --- | --- | --- |
| Administrador | admin@urbana.local | Urbana@2026 |
| Gestor | gestor@urbana.local | Urbana@2026 |
| Triagem | triagem@urbana.local | Urbana@2026 |
| Equipe de Campo | campo@urbana.local | Urbana@2026 |
| Fiscalização | fiscal@urbana.local | Urbana@2026 |
| Consulta | consulta@urbana.local | Urbana@2026 |

Essas contas são exclusivamente para demonstração local. `ADMIN_PASSWORD` substitui a senha inicial de todas as contas do seed. Em ambiente municipal, use um banco novo, `DEMO_DATA=false`, uma senha própria em `ADMIN_PASSWORD`, HTTPS e `SECURE_COOKIE=true`. Variáveis são carregadas de `.env`, caso exista. Consulte `.env.example`.

## Funcionalidades

- Login, sessão de 8 horas, logout, senhas com scrypt, limitação de tentativas e permissões verificadas pela API.
- Versão de campo em `/campo`, registro com câmera/GPS, rascunhos locais, tarefas por equipe/operador, devolução justificada e análise pelo gestor.
- Painel com contagens reais, prioridades, SLA, distribuição territorial e custos dos materiais consumidos.
- Ocorrências com categoria configurável, subcategoria, GPS, ajuste no mapa, coordenadas manuais, endereço, bairro, origem, prioridade e foto.
- Localização por GPS ou mapa e preenchimento manual de endereço e bairro.
- Verificação de duplicidade por distância, vínculo de solicitações e confirmação de novo registro; identificação de reincidência próxima a registros concluídos.
- Triagem, classificação e encaminhamento; geração de OS após triagem, equipe compatível com o setor, responsável e programação.
- Execução: deslocamento, chegada georreferenciada, foto antes, material e equipamento, foto depois, relato, envio à fiscalização e validação.
- Reabertura justificada e cancelamento justificado com histórico.
- Evidências JPG, PNG, WebP, PDF e MP4, limitadas a 15 MB, com usuário, data, etapa e coordenadas. Anexos são servidos apenas após autenticação.
- Cadastros de categorias e SLA, secretarias, departamentos, setores, equipes, usuários, materiais e equipamentos.
- Filtros de texto, status, prioridade, categoria, bairro no mapa e intervalo de identificação; exportação CSV dos registros filtrados.
- Histórico detalhado e auditoria administrativa.
- Layout responsivo para desktop e celular, com navegação e formulários operacionais.

## Validar o fluxo

1. Entre como administrador e registre uma ocorrência com endereço, origem, categoria, coordenadas e foto.
2. No detalhe, salve a triagem e gere a OS atribuindo uma equipe do mesmo setor.
3. Na OS, abra Evidências e envie uma foto na etapa `antes`.
4. Em Execução, confirme as coordenadas de chegada e inicie o serviço.
5. Registre um material com quantidade positiva; associe um equipamento quando necessário.
6. Envie uma foto `depois`, registre o relato e envie para validação.
7. Como administrador ou fiscalização, valide o serviço. A ocorrência, o painel e o mapa passam a refletir a conclusão.

As exigências de foto e material são configuráveis por categoria. Os exemplos pré-carregados em estados avançados não têm fotos de campo reais; crie um registro novo para validar todas as etapas.

## Banco e arquivos

Sem `DATABASE_URL`, os dados ficam em `data/urban.sqlite` e os arquivos em `data/uploads/`. Reiniciar o servidor preserva os registros. Não há persistência apenas no navegador.

Com `DATABASE_URL=postgres://usuario:senha@host:5432/urban`, o mesmo repositório utiliza PostgreSQL. O usuário do banco deve poder habilitar PostGIS durante a primeira inicialização. A migration cria a coluna geográfica gerada a partir de longitude/latitude e índice GiST. O esquema inicial e a versão aplicada estão em `server/schema.sql` e `schema_migrations`.

SQLite e PostgreSQL são alternativas de execução. Alterar `DATABASE_URL` não transfere dados existentes automaticamente. A migração de dados reais entre bancos precisa de uma etapa própria de importação. A versão PostgreSQL foi implementada, mas não exercitada contra uma instância real neste ambiente.

Faça backup consistente do banco e da pasta de anexos. No modo local, pare o serviço antes de copiar `data/` ou use um procedimento de backup SQLite que inclua WAL. Não remova a pasta de dados para atualizar o código.

## Mapa e localização

O mapa-base usa OpenStreetMap pelo Leaflet, com atribuição visível. Consulte a [política de uso dos mapas](https://operations.osmfoundation.org/policies/tiles/). O cadastro aceita GPS, seleção no mapa ou coordenadas e endereço manual. O mapa-base requer internet; ocorrências e formulários continuam utilizáveis se ele estiver indisponível.

## Testes

```powershell
npm.cmd test
npm.cmd run build
# Com Microsoft Edge instalado e acesso à internet para os mapas:
npm.cmd run test:ui
```

Os testes da API e do navegador usam bancos temporários isolados. Cobrem autenticação, autorização, origem das requisições, validação, duplicidade, ciclo de execução, fotos obrigatórias, consumo, auditoria, propagação para mapa, atomicidade. O teste de navegador inicia seu próprio servidor com a versão compilada, verifica desktop e celular, cadastro, triagem, geração de OS e navegação, e captura telas em `test-results/`.

## Escopo e evolução

Ativos e planos preventivos têm tabelas reservadas, mas não possuem telas ou geração automática de OS nesta entrega, conforme a seção de recursos fora do MVP. BC Digital não está integrado: é apenas uma origem disponível no cadastro. Não há estoque, roteirização, aplicativo nativo, custos de mão de obra, notificações ao cidadão ou SSO. Há instalação como aplicativo web e Web Push para operadores quando configurado.

Anexos usam disco local; o adaptador S3 ainda precisa ser implementado antes de implantação distribuída. Equipes possuem responsável e quantidade de integrantes; usuários de campo têm vínculo com uma equipe. Não há gestão de múltiplas equipes por usuário. A API aceita agrupar várias ocorrências em uma OS do mesmo setor; a interface cria uma OS por vez a partir da ocorrência. Novas intervenções posteriores podem reutilizar a OS pela reabertura.

O processo utiliza uma conexão e fila serializada para consistência no MVP. Escala horizontal, rotação de credenciais, monitoramento, migrações incrementais futuras e homologação PostgreSQL devem preceder uma implantação municipal de produção.

Mais detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/API.md](docs/API.md).

## Planejamento por rua e planos de ação

A tela **Planejamento** agrupa ocorrências abertas pelo nome normalizado da rua e bairro. Remove acentos, diferenças de maiúsculas, abreviações R./Av. e números de imóveis após vírgula ou marcador nº. Nomes de ruas numeradas são preservados. Endereços sem separador explícito, grafias diferentes ou cruzamentos precisam de revisão manual; o agrupamento não usa proximidade geográfica nem identifica automaticamente ruas equivalentes.

Grupos com duas ou mais ocorrências recebem prioridade de planejamento **Alta**, preservando **Emergencial** quando presente. A ordenação considera prioridade, quantidade e registro mais antigo. Solicitações vinculadas como duplicadas não viram novas ocorrências. Concluídas e canceladas saem do ranking. A prioridade individual não é alterada.

Administradores e gestores podem selecionar de 2 a 100 registros da mesma rua/bairro, informar objetivo, responsável e data, e salvar um plano **PA**. Uma ocorrência pertence a apenas um plano. Novos registros são apresentados como disponíveis para outro plano, sem inclusão silenciosa nos já criados. Os planos são persistidos pela migration 2 e registrados na auditoria.

No plano, salve a triagem das ocorrências identificadas e use **Programar ordem de serviço**. Cada OS reúne as ocorrências em triagem do setor escolhido, com equipe compatível. A prioridade da nova OS considera o plano e as ocorrências; o SLA utiliza essa elevação sem reiniciar a contagem desde a identificação. Ordens anteriores ao plano mantêm prioridade e prazo originais. O plano mostra as OS relacionadas e acompanha as conclusões e cancelamentos pelos estados atuais das ocorrências. Atualize a página para refletir alterações de outros usuários.

A data planejada organiza a intervenção, mas não substitui o SLA. A criação do plano depende da revisão do gestor; sugestões no ranking são automáticas. Nesta versão não há edição/cancelamento do plano nem inclusão posterior de ocorrências.

## Operação no celular

Abra `/campo`. O perfil **Equipe de Campo** entra automaticamente na interface móvel, com **Tarefas**, **Registrar** e **Meus registros**. No ambiente demonstrativo, use `campo@urbana.local` / `Urbana@2026`. Gestores podem abrir **Operação de campo** para conhecer a interface; no modo de gestão a consulta mostra todas as ordens permitidas ao perfil.

1. O operador fotografa o problema, captura GPS (ou informa coordenadas), confirma endereço/bairro e descreve o serviço. Solicitante, telefone e referência são opcionais, conforme os modelos de OS fornecidos.
2. Foto e dados ficam em rascunho no aparelho (IndexedDB). Ao enviar, a ocorrência e a imagem são persistidas no servidor. Falhas de rede mantêm o rascunho; identificadores de envio impedem duplicação da ocorrência e da foto em uma repetição. O envio é manual.
3. A gestão faz a triagem e cria a OS. Pode designar a equipe inteira ou um operador dela, com data e instruções. Em uma OS programada, abra **Distribuir para equipe ou operador** para atualizar essa distribuição.
4. O operador vê endereço, referência, foto original, descrição, equipe, responsável, emissor, prioridade, data e prazo. **Como chegar** abre o aplicativo de mapas. Captura GPS/foto antes, inicia, registra materiais, fotografa depois e envia relato para análise.
5. **Não foi possível executar** devolve a OS com justificativa. A gestão pode reprogramá-la, incluindo a troca de equipe/operador do mesmo setor.
6. **Análise de campo** reúne serviços enviados e devolvidos. Administrador, Gestor ou Fiscalização revisam as evidências e podem validar o serviço ou pedir correção (reabertura). Operadores não validam nem encerram suas próprias ordens.

A fila é atualizada a cada 15 segundos enquanto a tela está visível. Web Push permite avisos com o aplicativo fechado quando HTTPS, chaves VAPID, navegador compatível e permissão do usuário estão configurados. O registro de push é removido desse aparelho ao sair. No iPhone, instale na Tela de Início e ative os avisos pelo aplicativo instalado. Veja [publicação e operação](docs/DEPLOYMENT.md).

Rascunhos persistem no navegador/aparelho onde foram criados. Limpar os dados do navegador os remove. A abertura inicial/login e as operações no servidor exigem rede; a tela offline orienta a reconectar. Isso não é sincronização offline automática. Fotos antes/depois selecionadas também ficam guardadas localmente para reenvio, e o relato de conclusão fica em rascunho.

Testes adicionais: `npm.cmd run test:field` valida registro móvel, recuperação de rascunho, reenvio de foto, distribuição individual, execução e aprovação pelo gestor em banco isolado. Os testes da API cobrem permissões, reenvios, devolução e fila de push com serviço simulado.

## Quadro de equipes e navegação

O Kanban permite arrastar cartões entre etapas, ordenar a fila de forma compartilhada e controlar limites de trabalho, mantendo permissões e evidências do fluxo operacional. Busca e equipe ficam na barra principal; filtros, carga e regras são recolhíveis. O menu lateral agrupa Ocorrências e Operações. Consulte [o guia do quadro](docs/KANBAN.md).
