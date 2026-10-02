# Publicação do Urbana Campo

Referência operacional de implantação do Urbana, verificada contra `Dockerfile`, `compose.yaml`, `Caddyfile`, `server/index.js` e `server/db.js` em 2026-10-02. Produto, domínio e limitações estão no [contexto mestre](URBANA-CONTEXTO-MESTRE.md); decisões de banco, storage e migrations estão em [DECISIONS.md](DECISIONS.md).

## Situação desta entrega

A aplicação foi implementada e testada localmente. Não há endereço público configurado. `http://127.0.0.1:3000/campo` só abre no computador que executa o servidor. A publicação precisa de um domínio e de um servidor com Docker Compose, portas 80/443 disponíveis e armazenamento persistente. Os arquivos Docker/Caddy foram preparados, mas a imagem não foi executada neste ambiente, onde Docker não está disponível.

## Publicar com HTTPS

1. Aponte o DNS do domínio para o servidor escolhido.
2. Copie o projeto (sem `data`, `.env`, `tmp` ou dependências locais). Este procedimento inicia um banco de produção novo; não publica os registros demonstrativos locais.
3. No servidor, crie `.env` com `URBANA_DOMAIN` (somente nome do domínio), `ADMIN_PASSWORD` (pelo menos 10 caracteres, exclusiva para essa instalação), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (um `mailto:` de suporte real). Gere o par de chaves com `npm run push:keys`, após instalar as dependências. Guarde a chave privada apenas no servidor. Não altere o par enquanto houver assinaturas ativas sem reinscrever os aparelhos.
4. Execute `docker compose up -d --build`. O Caddy obtém e renova o certificado TLS do domínio. O banco SQLite e os anexos ficam no volume `urban_data`; os certificados, nos volumes do Caddy.
5. Acesse `https://SEU_DOMINIO/` como `admin@urbana.local`, usando a senha definida. Cadastre equipes/operadores reais e confira os dados municipais. `DEMO_DATA=false` evita as contas demonstrativas de outros perfis.
6. No telefone, abra `https://SEU_DOMINIO/campo`. Entre com a conta do operador, permita a localização e adicione à Tela de Início. Toque em **Ativar avisos neste celular**. No iPhone, faça isso a partir do aplicativo instalado.
7. Distribua uma OS de teste e confira o aviso com o aplicativo fechado, a rota, as duas fotos e a aprovação pelo gestor. A entrega real de push depende do navegador, da permissão e do serviço de notificações; os testes automatizados usam envio simulado.

Esta composição usa SQLite persistente em uma única instância. Não escale para múltiplas réplicas compartilhando esse volume. PostgreSQL/PostGIS é o alvo recomendado para implantação municipal, mas exige configuração adicional e homologação; não é fornecido como serviço no Compose.

## Ambientes e variáveis

| Ambiente | Execução | Persistência |
| --- | --- | --- |
| Desenvolvimento | Node 24+, `npm.cmd ci`, `npm.cmd run dev` | SQLite local por padrão, Vite em middleware |
| Testes | `npm.cmd test`; build e scripts de navegador | Bancos temporários isolados; não usar dados municipais |
| Piloto simples | `npm.cmd run build` / `npm.cmd start` ou Compose | SQLite persistente em instância única |
| Produção municipal recomendada | Imagem Node 24, proxy HTTPS, serviço dedicado | PostgreSQL/PostGIS homologado e anexos persistentes; abstração de object storage disponível por injeção; serviço externo não homologado |

No Linux, use `npm` nos mesmos comandos. `.env` é carregado na inicialização pelo Node se existir; no Compose, a substituição de `.env` só passa ao container as variáveis listadas no bloco `environment`. Mudar o arquivo não altera automaticamente o ambiente de um container já criado.

| Variável | Padrão / efeito |
| --- | --- |
| `PORT` | 3000 |
| `HOST` | 127.0.0.1 local; 0.0.0.0 no container |
| `DATA_DIR` | `data` local; `/app/data` na imagem; banco/arquivos |
| `DATABASE_URL` | Ausente = SQLite; URL PostgreSQL quando definida |
| `ADMIN_PASSWORD` | Senha do seed na primeira inicialização, mínimo 10; não troca senha de banco já inicializado |
| `DEMO_DATA` | Somente `false` desativa contas/ocorrências demonstrativas; Compose fixa `false` |
| `SECURE_COOKIE` | Somente `true` habilita cookie Secure; Compose fixa `true` |
| `URBANA_DOMAIN` | Nome DNS sem protocolo/caminho; usado pelo Caddy |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Trio necessário ao push; subject de suporte real |
| `NODE_ENV` | `production` na imagem; modo estático é ativado por `--production` |

Use `.env.example` como referência, sem versionar segredos. Seed só executa se não houver usuários: mudar `DEMO_DATA` não remove demonstrações de banco existente. Ao desativar demo num banco novo, `ADMIN_PASSWORD` é obrigatório; cria administrador inicial e catálogos. Criar contas reais depois. Alteração de senha/recovery não possui CLI operacional entregue; não presumir que reiniciar com nova variável reseta usuários.

## Docker, domínio e HTTPS

A imagem compila React/Vite em estágio de build e instala dependências de produção no estágio final; executa como usuário `node`, expõe 3000 e usa `/healthz` como healthcheck. O Compose não publica 3000 no host: Caddy encaminha para `app:3000`. Volumes: `urban_data` para persistência, `caddy_data` para certificados e `caddy_config` para configuração interna. O nome físico dos volumes depende do nome do projeto Compose.

DNS deve apontar ao host e portas 80/443 TCP (e 443 UDP para o transporte configurado) devem estar acessíveis. Caddy 2 obtém/renova TLS e comprime respostas. Confirme domínio, firewall, proxy e cookie em HTTPS antes de liberar acesso. O domínio/chaves não devem ser exemplos de demonstração em produção.

Comandos de inspeção:

```sh
docker compose config --quiet
docker compose ps
docker compose logs --tail=100 app https
curl -fsS https://SEU_DOMINIO/healthz
```

`healthz` confirma resposta do processo, não consistência do banco, funcionamento de push, restauração ou todos os fluxos. Não imprimir `docker compose config` completo em canais públicos: pode mostrar segredos resolvidos.

## PostgreSQL / PostGIS

Defina `DATABASE_URL` no ambiente do processo; no Compose acrescente explicitamente `DATABASE_URL: ${DATABASE_URL:?Informe o banco}` ao serviço `app`. Em servidor externo, `localhost` de dentro do container é o próprio container, não o host do banco. Use hostname acessível, rede protegida e conta dedicada.

PostGIS deve estar instalado no servidor. Na inicialização, `openDatabase` tenta `CREATE EXTENSION IF NOT EXISTS postgis`, cria `occurrences.geom` como ponto SRID 4326 gerado de longitude/latitude e índice GiST. A conta precisa das permissões necessárias ou a extensão deve ser previamente provisionada e o procedimento validado pelo administrador do banco. O cliente `pg` usa a URL; requisitos TLS/certificado devem ser configurados e homologados com o destino.

O adaptador retém um cliente/conexão e a API serializa operações no processo; não há garantia de locking distribuído. Não liberar réplicas múltiplas apenas por trocar SQLite por PostgreSQL. Testar migrations, rollback, concorrência, arquivos e todos os fluxos antes de produção. Alterar `DATABASE_URL` **não importa** o SQLite nem transfere anexos.

## Armazenamento e Web Push

Preservar todo `DATA_DIR`: `urban.sqlite` e WAL/SHM quando presentes (SQLite), `uploads/` (evidências) e **`invoices/` (PDFs de notas)**. Os metadados estão no banco; arquivos isolados não restauram seus vínculos. Anexos usam FileStorage; default é disco local. Object storage é adaptador injetável, sem serviço externo ativado. Banco PostgreSQL também exige backup separado desses diretórios.

Push exige as três variáveis VAPID, HTTPS, permissão por aparelho e navegador compatível. Instalar na Tela de Início quando necessário e validar na plataforma escolhida; `/campo` oferece ativação. Não trocar par VAPID sem reinscrever assinaturas. Worker tenta entregar jobs até cinco vezes, revalida atribuição e remove assinaturas expiradas; testar entrega real, incluindo mudança de operador, logout e aparelho fechado. Testes do repositório simulam o serviço externo.

## Atualizar e preservar dados

`docker compose up -d --build` substitui a aplicação e mantém os volumes. Não use `docker compose down -v` em uma instalação com registros que devem ser preservados. Faça backup consistente antes da atualização, registre revisão Git/imagem/configuração e confira migrations aplicáveis. Versões 1–9 são executadas/verificadas automaticamente na inicialização.

| Versão | Conteúdo vigente |
| --- | --- |
| 1 | Esquema base em `server/schema.sql`, execução idempotente e registro em `schema_migrations` |
| 2 | `action_plans`, `action_plan_occurrences` e índice de vínculos |
| 3 | `client_requests`, `push_subscriptions`, `push_jobs` |
| 4 | `invoices`, `invoice_items`, `inventory_movements` e índices |
| 5 | version em occurrences/orders/action_plans |
| 6 | Índices de paginação/filtros/auditoria/relacionamentos/consumo |
| 7 | Índices de paginação e FKs dos movimentos de estoque |
| 8 | Inicialização das liberações individuais de módulos |
| 9 | Progresso versionado e eventos internos de onboarding |

Versões 2–8 são transacionais e registradas após sucesso. A versão 9 registra a criação idempotente das tabelas de onboarding no esquema base. Implementação em `server/db.js`; não há diretório `migrations/`, CLI separado ou downgrade automatizado. Não editar migrations antigas para futuras mudanças; adicionar versão aditiva e verificar em instalação existente. Scripts em `scripts/` que reescrevem permissões/perfis não fazem parte deste procedimento nem de migrations ativas.

Após atualizar: verificar logs/healthcheck, login, catálogo, programação, evidência, conclusão/validação, nota/estoque e push configurado; comparar dados preservados. Se falhar, interromper tráfego e investigar; voltar somente para imagem compatível com o esquema aplicado ou restaurar o conjunto banco+arquivos/configuração da cópia anterior. Não pressupor rollback de schema ao trocar imagem.

## Backup e restauração

Defina frequência/retenção conforme perda tolerável, guarde cópia fora do host com acesso restrito e teste restauração em ambiente isolado. Preserve também configuração, chaves VAPID e versão da aplicação de forma segura; volumes do Caddy podem ser copiados separadamente. As receitas abaixo são procedimentos a homologar, não registro de execução neste ambiente.

### SQLite no Compose

Para cópia simples consistente, parar todos os escritores antes de copiar o diretório inteiro:

```sh
mkdir -p backups/2026-10-02
docker compose stop app
docker compose cp app:/app/data backups/2026-10-02/data
docker compose start app
```

Confirme a cópia antes de reiniciar e use diretório novo a cada execução. Para execução local, parar servidor e copiar `DATA_DIR` inteiro; copiar somente `urban.sqlite` com processo ativo pode perder dados no WAL. Uma estratégia online precisa usar mecanismo de backup SQLite adequado, sem copiar arquivo ativo isoladamente.

Restaurar a cópia **num ambiente isolado com volume vazio**, usando Compose e imagem compatíveis (não sobrepor dados ativos):

```sh
docker compose create app
docker compose cp backups/2026-10-02/data/. app:/app/data
docker compose run --rm --no-deps --user root --entrypoint chown app -R node:node /app/data
docker compose up -d
```

O comando `chown` ajusta acesso ao usuário da imagem Linux. Confirmar `schema_migrations`, contagens, autenticação e abertura de evidências/PDFs antes de promover restauração. Para substituir instalação real, manter tráfego/escritas interrompidos e guardar cópia do estado anterior; planejar troca do volume/banco e domínio, sem apagar o original até validar.

### PostgreSQL

Utilize ferramentas compatíveis com a versão do servidor. Configure conexão por `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` e credenciais por meio seguro; não colocar senha na linha de comando ou no histórico. Com escritores parados, faça dump e copie os anexos do mesmo ponto operacional:

```sh
pg_dump --format=custom --file=backups/urban.dump
```

Provisionar banco vazio de homologação com PostGIS/permissões e restaurar usando credenciais do **destino isolado**:

```sh
pg_restore --no-owner --dbname=urban_restore backups/urban.dump
```

Restaurar também `uploads/` e `invoices/`, preservar permissões e apontar uma instância isolada à base restaurada; desabilitar entrega externa de push nesse teste. Validar schema, índices/geom, fluxos e anexos. Dump de banco sem arquivos não é backup completo; não usar `--clean` contra banco ativo como procedimento genérico.

## Limites de uso sem rede

O navegador guarda o registro em rascunho (foto e campos), fotos de execução ainda não enviadas e relato de conclusão. A autenticação e a abertura dos dados de trabalho precisam de conexão. Não há cache offline de ordens nem envio automático em segundo plano de evidências. Com a aplicação aberta, uma perda de sinal permite continuar preenchendo o registro; reconecte e toque em enviar. Repetir registros/fotos usa identificadores estáveis para impedir duplicação.

As regras de execução, permissões e retenção local estão no [contexto mestre](URBANA-CONTEXTO-MESTRE.md); limpar dados do navegador elimina rascunhos locais.

## Referências de implementação

- [Biblioteca Web Push](https://github.com/web-push-libs/web-push): VAPID, assinatura e envio cifrado.
- [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): avisos em segundo plano.
- [Web Push em apps da Tela de Início no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): instalação e permissões.

Os modelos de OS fornecidos como referência orientaram o domínio; sua interpretação funcional foi consolidada no contexto mestre.

## Migration 5 — checkpoint de concorrência (2026-10-02)

Adiciona version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0) a occurrences/orders/action_plans, em transação registrada após sucesso. Dados existentes recebem 1; não há reconstrução de histórico. Inserts de OS agora nomeiam as colunas. Migrations 1–4 preservadas. Clientes que editam classificação, recusa, estado ou programação devem enviar a versão que leram; API retorna 428 se ausente. Homologação PostgreSQL/PostGIS real ainda pendente.

## Migration 6 — índices de listagem

Índices aditivos para created_at/id, setor/status, prioridade/categoria, prazos, vínculos inversos de OS, usuário/evento da auditoria e consumo por OS/material. Migrations 1–5 preservadas. Paginação não altera dados existentes.

## FileStorage e homologação PostgreSQL/PostGIS preparada

Default: LocalFileStorage(DATA_DIR), preserva uploads/ e invoices/. Ambos os downloads permanecem autenticados. ObjectFileStorage recebe client/bucket/prefix por injeção em createApp(db,{storage}); o client deve adaptar putObject/getObject/deleteObject/headObject ao SDK S3/MinIO escolhido. Não existe ativação externa automática por variável nem SDK/credencial fictícios. Backup continua incluindo banco e arquivos; uma migração para bucket exige transferência verificada dos arquivos históricos. Upload usa buffer limitado a 15 MB; dimensionar memória e concorrência do proxy para homologação. Erros após save limpam arquivo após rollback; queda abrupta exige reconciliação de órfãos.

Para executar homologação posteriormente, configure URBANA_POSTGRES_TEST_URL por meio seguro apontando EXCLUSIVAMENTE para banco isolado de testes com PostGIS instalado e permissão de criar schema. Execute `node --test tests/postgres.test.js`. O teste cria schema urbana_test_<UUID>, executa migrations/seed/consultas/corrida/rollback e remove apenas esse schema no final. DATABASE_URL de produção nunca é escolhido implicitamente. Sem a variável, teste fica explicitamente não executado; isso não comprova homologação PostgreSQL/PostGIS.

## Atualização dos assets

O build gera chunks dinâmicos. Publique todo dist/ da mesma revisão; mantenha assets antigos acessíveis durante atualização de sessões abertas ou peça recarregamento antes de operar. Os nomes têm hash; não misture index/assets de revisões diferentes. Code splitting não adiciona cache offline de módulos, OS ou sincronização.

Há limite de quatro uploads concorrentes por aplicação (maxConcurrentUploads na fábrica), compartilhado entre evidências e PDFs. Excesso retorna 429 UPLOAD_BUSY e pode ser reenviado; limite e política do proxy devem ser dimensionados em homologação.
