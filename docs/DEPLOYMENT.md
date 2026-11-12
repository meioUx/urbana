# Publicação do Urbana Campo

Referência operacional de implantação do Urbana, verificada contra `Dockerfile`, `compose.yaml`, `Caddyfile`, `server/index.js` e `server/db.js` em 2026-10-02 e revisada em 2026-11-12 (duas vezes: primeira série e segunda rodada) contra `server/security.js`, `server/logger.js`, `server/migrations/`, `server/modules/files/clamav.js`, `server/routes/portal.js`, `scripts/`, `compose.yaml`, `compose.local.yaml`, `.env.example` e `.github/workflows/ci.yml`. Produto, domínio e limitações estão no [contexto mestre](URBANA-CONTEXTO-MESTRE.md); decisões de banco, storage e migrations estão em [DECISIONS.md](DECISIONS.md).

## Situação desta entrega

A aplicação foi implementada e testada localmente. Não há endereço público configurado. `http://127.0.0.1:3000/campo` só abre no computador que executa o servidor. A publicação precisa de um domínio e de um servidor com Docker Compose, portas 80/443 disponíveis e armazenamento persistente. Os arquivos Docker/Caddy foram preparados, mas a imagem da aplicação nunca foi construída nem executada, e o Caddy nunca foi exercitado com domínio e certificado reais. Em 2026-11-12 só o banco PostgreSQL/PostGIS (não a imagem do app) tinha sido executado em container local, para os testes (ver [Ambiente local](#ambiente-local-com-postgresqlpostgis-desenvolvimento-e-homologação)). Nada da segunda rodada (antimalware, portal do cidadão, obras e intervenções, cabeçalho `X-Urbana-Client`) foi exercitado com a imagem do app, com o Caddy real, em HTTPS ou em Node 24.

## Publicar com HTTPS

1. Aponte o DNS do domínio para o servidor escolhido.
2. Copie o projeto (sem `data`, `.env`, `tmp` ou dependências locais). Este procedimento inicia um banco de produção novo; não publica os registros demonstrativos locais.
3. No servidor, crie `.env` com `URBANA_DOMAIN` (somente nome do domínio), `ADMIN_PASSWORD` (pelo menos 10 caracteres, exclusiva para essa instalação), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (um `mailto:` de suporte real). Gere o par de chaves com `npm run push:keys`, após instalar as dependências. Guarde a chave privada apenas no servidor. Não altere o par enquanto houver assinaturas ativas sem reinscrever os aparelhos. Se usar um provider de mapa diferente do OpenStreetMap, defina também `VITE_MAP_TILE_URL` (e atribuição/zoom) no `.env`: o Compose a passa ao build e ao processo em execução.
4. Execute `docker compose up -d --build`. O Caddy obtém e renova o certificado TLS do domínio. O banco SQLite e os anexos ficam no volume `urban_data`; os certificados, nos volumes do Caddy.
5. Acesse `https://SEU_DOMINIO/` como `admin@urbana.local`, usando a senha definida. Cadastre equipes/operadores reais e confira os dados municipais. `DEMO_DATA=false` evita as contas demonstrativas de outros perfis.
6. No telefone, abra `https://SEU_DOMINIO/campo`. Entre com a conta do operador, permita a localização e adicione à Tela de Início. Toque em **Ativar avisos neste celular**. No iPhone, faça isso a partir do aplicativo instalado.
7. Distribua uma OS de teste e confira o aviso com o aplicativo fechado, a rota, as duas fotos e a aprovação pelo gestor. A entrega real de push depende do navegador, da permissão e do serviço de notificações; os testes automatizados usam envio simulado.

Esta composição usa SQLite persistente em uma única instância. Não escale para múltiplas réplicas compartilhando esse volume. PostgreSQL/PostGIS é o alvo recomendado para implantação municipal, mas exige configuração adicional e homologação; não é fornecido como serviço no `compose.yaml` (o `compose.local.yaml` o traz só para desenvolvimento). O `compose.yaml` recusa subir sem `ADMIN_PASSWORD` e `URBANA_DOMAIN`, fixa `DEMO_DATA=false`, `SECURE_COOKIE=true` e `TRUST_PROXY=1` e aguarda o `/healthz` do app antes de iniciar o Caddy.

### Recusa de credenciais de demonstração em produção

`npm start` (`--production`) **não sobe** quando o servidor é alcançável fora do computador (`HOST` não é `127.0.0.1`/`localhost`/`::1`, ou `SECURE_COOKIE=true`) e há qualquer um destes problemas: `DEMO_DATA` diferente de `false`; `ADMIN_PASSWORD` igual à senha pública de demonstração (`Urbana@2026`); alguma conta do banco que ainda aceita essa senha. A verificação do ambiente roda antes do seed (uma recusa não cria contas de demonstração); a das contas roda depois da abertura do banco. O erro lista o que corrigir e o processo termina com código 1. Para um banco antigo, troque a senha das contas existentes ou use um banco novo. Exceção explícita: `URBANA_ALLOW_INSECURE_DEMO=true` desliga a verificação só quando `SECURE_COOKIE` não é `true` e registra um aviso no log; existe para o `compose.local.yaml` e **nunca deve ser definida num servidor público**. Em desenvolvimento (`npm run dev`) a verificação não se aplica.

### Clientes nativos e o app urbana-campo

O app móvel `urbana-campo` (repositório irmão) não envia `Origin`. Desde a segunda rodada, uma mutação sem `Origin` e sem `Sec-Fetch-Site` só é aceita com o cabeçalho `X-Urbana-Client` (ver [ADR-026](DECISIONS.md) e [API](API.md)); o app o envia como `urbana-campo/<versão>` a partir do ajuste R10a (branch `chore/compat-servidor-novo` daquele repositório, ainda sem commit).

> **Aviso de implantação.** Publique a versão do `urbana-campo` que envia `X-Urbana-Client` **antes** de colocar este backend em produção. Instalações antigas do app recebem 403 `ORIGIN_REQUIRED` em toda mutação, inclusive no login. Os itens já na fila offline do aparelho ficam retidos com erro (não se perdem) até o app ser atualizado. O APK que está no repositório do app é de um build antigo e não funciona contra este servidor.

Um proxy ou CDN na frente não deve remover `Origin`, `Sec-Fetch-Site` nem `X-Urbana-Client`, nem reescrever `Host`.

## Ambientes e variáveis

| Ambiente                       | Execução                                         | Persistência                                                                                                                            |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Desenvolvimento                | Node 24+, `npm.cmd ci`, `npm.cmd run dev`        | SQLite local por padrão, Vite em middleware                                                                                             |
| Testes                         | `npm.cmd test`; build e scripts de navegador     | Bancos temporários isolados; não usar dados municipais                                                                                  |
| Piloto simples                 | `npm.cmd run build` / `npm.cmd start` ou Compose | SQLite persistente em instância única                                                                                                   |
| Produção municipal recomendada | Imagem Node 24, proxy HTTPS, serviço dedicado    | PostgreSQL/PostGIS homologado e anexos persistentes; abstração de object storage disponível por injeção; serviço externo não homologado |

No Linux, use `npm` nos mesmos comandos. `.env` é carregado na inicialização pelo Node se existir; no Compose, a substituição de `.env` só passa ao container as variáveis listadas no bloco `environment`. Mudar o arquivo não altera automaticamente o ambiente de um container já criado.

| Variável                                                 | Padrão / efeito                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                   | 3000                                                                                                                                                                                                                                                           |
| `HOST`                                                   | 127.0.0.1 local; 0.0.0.0 no container                                                                                                                                                                                                                          |
| `DATA_DIR`                                               | `data` local; `/app/data` na imagem; banco/arquivos                                                                                                                                                                                                            |
| `DATABASE_URL`                                           | Ausente = SQLite; URL PostgreSQL quando definida (pool padrão do `pg`, 10 conexões, sem configuração)                                                                                                                                                          |
| `ADMIN_PASSWORD`                                         | Senha do seed na primeira inicialização, mínimo 10; não troca senha de banco já inicializado                                                                                                                                                                   |
| `DEMO_DATA`                                              | Somente `false` desativa contas/ocorrências demonstrativas; Compose fixa `false`; qualquer outro valor com servidor público é recusado (ver acima)                                                                                                             |
| `SECURE_COOKIE`                                          | Somente `true` habilita cookie Secure, o cabeçalho HSTS (`max-age` de um ano, sem `includeSubDomains`) e `upgrade-insecure-requests` na CSP; Compose fixa `true`                                                                                               |
| `URBANA_ALLOW_INSECURE_DEMO`                             | `true` = ignora a recusa de demonstração em servidor não loopback por HTTP; somente homologação local; sem efeito com `SECURE_COOKIE=true`                                                                                                                     |
| `TRUST_PROXY`                                            | Número de proxies confiáveis (ou valor aceito pelo Express) para `X-Forwarded-For`; o limite de login é por IP. Compose fixa `1` (Caddy). Sem proxy, deixe ausente                                                                                             |
| `VITE_MAP_TILE_URL`                                      | Provider de mapa; vale **no build e também em tempo de execução**: o servidor a lê para liberar o host dos tiles em `img-src` da CSP. Vazio = OpenStreetMap. O Compose a repassa aos dois. Valores diferentes entre build e execução deixam o mapa sem imagens |
| `VITE_MAP_ATTRIBUTION`, `VITE_MAP_MAX_ZOOM`              | Somente no build (ver [MAP-TILES](MAP-TILES.md))                                                                                                                                                                                                               |
| `LOG_LEVEL`                                              | `debug`, `info` (padrão), `warn`, `error` ou `silent`                                                                                                                                                                                                          |
| `LOG_FORMAT`                                             | `json` (padrão com `NODE_ENV=production`, ou seja, na imagem) ou `text`                                                                                                                                                                                        |
| `UPLOAD_SWEEP_INTERVAL_HOURS`                            | Ausente/0 = varredura de uploads órfãos desligada; valor positivo (limitado a 168) agenda no processo                                                                                                                                                          |
| `UPLOAD_SWEEP_GRACE_HOURS`                               | Carência da varredura, em horas (padrão 24, mínimo 1)                                                                                                                                                                                                          |
| `BACKUP_DIR`, `BACKUP_KEEP`                              | Destino (padrão `backups`) e quantidade de backups mantidos (padrão 14; 0 = manter todos), lidos por `npm run backup`                                                                                                                                          |
| `PG_DUMP_BIN`                                            | Executável do `pg_dump` usado pelo backup (padrão `pg_dump`)                                                                                                                                                                                                   |
| `URBANA_DOMAIN`                                          | Nome DNS sem protocolo/caminho; usado pelo Caddy                                                                                                                                                                                                               |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Trio necessário ao push; subject de suporte real                                                                                                                                                                                                               |
| `CLAMAV_HOST`                                            | Ausente = antimalware desligado. Com valor (por exemplo `clamav`), os uploads passam pelo `clamd` antes de serem gravados (ver [Antimalware](#antimalware-opcional-clamav))                                                                                    |
| `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `CLAMAV_FAIL_MODE`   | Porta do `clamd` (3310), tempo limite total da verificação em ms (10000) e modo de falha: `closed` (padrão, recusa o upload com 503) ou `open` (aceita com aviso no log); o `compose.yaml` repassa as três                                                     |
| `CLAMAV_STREAM_MAX_BYTES`                                | Limite de stream do `clamd` em bytes (padrão 26214400, 25 MB; uploads são limitados a 15 MB). O `compose.yaml` a repassa ao serviço `app`                                                                                                                      |
| `URBANA_PUBLIC_PORTAL`                                   | `off` desliga o portal do cidadão e vence a configuração da Administração; ausente ou outro valor deixa a decisão à configuração (padrão: desligado). O `compose.yaml` a repassa ao serviço `app` (ver [Portal do cidadão](#portal-do-cidadão))                |
| `NODE_ENV`                                               | `production` na imagem; modo estático é ativado por `--production`                                                                                                                                                                                             |

Use `.env.example` como referência, sem versionar segredos. Seed só executa se não houver usuários: mudar `DEMO_DATA` não remove demonstrações de banco existente. Ao desativar demo num banco novo, `ADMIN_PASSWORD` é obrigatório; cria administrador inicial e catálogos. Criar contas reais depois. Alteração de senha/recovery não possui CLI operacional entregue; não presumir que reiniciar com nova variável reseta usuários.

## Docker, domínio e HTTPS

A imagem compila React/Vite em estágio de build e instala dependências de produção no estágio final; executa como usuário `node`, expõe 3000 e usa `/healthz` como healthcheck. Ela copia `scripts/backup.mjs` e `scripts/cleanup-orphan-uploads.mjs`, mas **não traz o cliente PostgreSQL** (`pg_dump`). O Compose não publica 3000 no host: Caddy encaminha para `app:3000`. Volumes: `urban_data` para persistência, `caddy_data` para certificados e `caddy_config` para configuração interna. O nome físico dos volumes depende do nome do projeto Compose.

DNS deve apontar ao host e portas 80/443 TCP (e 443 UDP para o transporte configurado) devem estar acessíveis. Caddy 2 obtém/renova TLS e comprime respostas. Confirme domínio, firewall, proxy e cookie em HTTPS antes de liberar acesso. O domínio/chaves não devem ser exemplos de demonstração em produção.

Cabeçalhos e limites de borda:

- A aplicação envia `Content-Security-Policy` estrita em produção (`default-src 'self'`, sem `unsafe-inline` em scripts nem estilos; fontes do Google Fonts e imagens de tiles do provider configurado liberadas), `X-Frame-Options: DENY` (e `frame-ancestors 'none'`), `Permissions-Policy` (geolocalização e câmera só na própria origem), `Cross-Origin-Opener-Policy`, `Referrer-Policy: strict-origin-when-cross-origin` e `X-Content-Type-Options`. Com `SECURE_COOKIE=true` acrescenta HSTS de um ano e `upgrade-insecure-requests`. Em desenvolvimento a CSP é afrouxada para o Vite. Esses cabeçalhos vêm da aplicação, com ou sem proxy.
- O `Caddyfile` limita o corpo da requisição a **20 MB** (a aplicação limita uploads a 15 MB e JSON a 1 MB), remove o cabeçalho `Server` e preserva o `Host`, que a aplicação compara com `Origin`.
- Requisições que alteram dados (`POST`, `PATCH`, `PUT`, `DELETE`) precisam de `Origin` igual ao `Host` ou de `Sec-Fetch-Site: same-origin`; caso contrário, 403 `ORIGIN_REQUIRED` ou `ORIGIN_FORBIDDEN`. Navegadores cumprem isso sozinhos; scripts e integrações precisam enviar `Origin` igual ao `Host` ou `X-Urbana-Client: <nome>` (o app móvel usa o segundo; ver [Clientes nativos](#clientes-nativos-e-o-app-urbana-campo) e a [API](API.md)). Um proxy ou CDN novo na frente não deve reescrever `Host` nem remover `Origin` ou `X-Urbana-Client`.
- O limite de tentativas de login (10 falhas por IP em 15 minutos) fica na tabela `login_attempts` e sobrevive a reinícios. Atrás do Caddy ele depende de `TRUST_PROXY=1`; sem isso todos os clientes pareceriam o mesmo IP.

Logs: a aplicação escreve uma linha por requisição (método, rota, status, duração, usuário e `X-Request-Id`; sem corpo, cookies ou tokens) em JSON na imagem e em texto no desenvolvimento, conforme `LOG_FORMAT`; `warn` e `error` vão para `stderr`. Cada resposta traz `X-Request-Id`; um valor enviado pelo cliente é aceito se tiver 8–128 caracteres seguros, senão é gerado um UUID. Use esse identificador para cruzar o relato de um usuário com o log (`docker compose logs app`). O `/healthz` só aparece com `LOG_LEVEL=debug`.

Comandos de inspeção:

```sh
docker compose config --quiet
docker compose ps
docker compose logs --tail=100 app https
curl -fsS https://SEU_DOMINIO/healthz
```

`GET /healthz` executa uma consulta trivial no banco com limite de 2 segundos, fora da fila de escrita: responde `{"ok":true}` com o banco acessível e **503** `{"ok":false}` quando a consulta falha ou estoura o prazo (o motivo vai para o log, nunca para a resposta). Confirma processo e acesso ao banco; não confirma consistência dos dados, push, restauração ou os demais fluxos. O healthcheck do Docker e o `depends_on` do Compose usam essa rota. Não imprimir `docker compose config` completo em canais públicos: pode mostrar segredos resolvidos.

## PostgreSQL / PostGIS

Defina `DATABASE_URL` no ambiente do processo; no Compose acrescente explicitamente `DATABASE_URL: ${DATABASE_URL:?Informe o banco}` ao serviço `app`. Em servidor externo, `localhost` de dentro do container é o próprio container, não o host do banco. Use hostname acessível, rede protegida e conta dedicada.

PostGIS deve estar instalado no servidor. Na inicialização, `openDatabase` tenta `CREATE EXTENSION IF NOT EXISTS postgis`, cria `occurrences.geom` como ponto SRID 4326 gerado de longitude/latitude e índice GiST. A conta precisa das permissões necessárias ou a extensão deve ser previamente provisionada e o procedimento validado pelo administrador do banco. O cliente `pg` usa a URL; requisitos TLS/certificado devem ser configurados e homologados com o destino.

No PostgreSQL o adaptador usa um **pool** (`pg.Pool`, padrão de 10 conexões): cada transação de escrita usa um cliente dedicado por `db.transaction(fn)` e `BEGIN`/`COMMIT` avulsos são recusados. As **escritas continuam serializadas por processo** (fila serial), porque WIP, numeração de códigos e saldo de estoque são verificados por leitura-e-escrita sem lock distribuído; as leituras `GET`/`HEAD` saem da fila e rodam em paralelo no pool em `READ COMMITTED` (uma resposta com várias consultas pode ver um commit entre elas). O aviso sobre réplicas continua valendo, mais estreito: **não suba mais de uma instância de escrita** apenas por trocar SQLite por PostgreSQL, pois duas instâncias não se serializam entre si. O que já é seguro com várias instâncias: o limite de login (no banco) e a entrega de push (cada job é reivindicado por um `UPDATE` atômico com concessão de 5 minutos, entrega pelo menos uma vez, notificação duplicada possível se uma instância cair no meio). Duas instâncias reais nunca foram testadas (só duas pools no mesmo processo). Testar migrations, rollback, concorrência, arquivos e todos os fluxos antes de produção. Alterar `DATABASE_URL` **não importa** o SQLite nem transfere anexos.

## Armazenamento e Web Push

Preservar todo `DATA_DIR`: `urban.sqlite` e WAL/SHM quando presentes (SQLite), `uploads/` (evidências) e **`invoices/` (PDFs de notas)**. Os metadados estão no banco; arquivos isolados não restauram seus vínculos. Anexos usam FileStorage; default é disco local. Object storage é adaptador injetável, sem serviço externo ativado. Banco PostgreSQL também exige backup separado desses diretórios.

Push exige as três variáveis VAPID, HTTPS, permissão por aparelho e navegador compatível. Instalar na Tela de Início quando necessário e validar na plataforma escolhida; `/campo` oferece ativação. Não trocar par VAPID sem reinscrever assinaturas. Worker tenta entregar jobs até cinco vezes, revalida atribuição e remove assinaturas expiradas; testar entrega real, incluindo mudança de operador, logout e aparelho fechado. Testes do repositório simulam o serviço externo. Cada job é reivindicado por uma atualização atômica com concessão de 5 minutos, o que evita entrega dupla entre instâncias; se a instância cair no meio da entrega, o job volta a ser tentado quando a concessão expira (entrega pelo menos uma vez; a tag da OS substitui uma notificação repetida). Isso não torna as **escritas** seguras entre instâncias (ver [PostgreSQL / PostGIS](#postgresql--postgis)).

### Uploads órfãos

Um arquivo é gravado em disco antes de o banco confirmar a transação; uma queda entre as duas etapas deixa um arquivo sem registro. `npm run uploads:cleanup` (`scripts/cleanup-orphan-uploads.mjs`) lista e remove arquivos de `uploads/` e `invoices/` sem linha em `evidence.filename` / `invoices.filename`. Use `npm run uploads:cleanup -- --dry-run` para só listar, `--grace-hours=N` para a carência (padrão 24, mínimo 1) e `--allow-empty-db` para o caso excepcional de um banco sem referências. Cuidados embutidos: só toca arquivos mais antigos que a carência; **recusa rodar** (código 3) se o banco não tiver nenhuma referência de arquivo mas o storage tiver candidatos (provável `DATABASE_URL`/`DATA_DIR` errado); recusa um `DATA_DIR` sem banco SQLite (código 2). Funciona **só com o storage local**: o adaptador de object storage não lista arquivos e a varredura não faz nada nele.

A varredura também pode rodar dentro do servidor, **desligada por padrão**: defina `UPLOAD_SWEEP_INTERVAL_HOURS` (positivo, até 168) e, se quiser, `UPLOAD_SWEEP_GRACE_HOURS`. Recomenda-se rodar antes `--dry-run` e conferir o resultado. Qualquer nova tabela que guarde um nome de arquivo precisa ser acrescentada em `server/modules/files/orphans.js`, ou seus arquivos seriam tratados como órfãos.

## Antimalware opcional (ClamAV)

Desligado por padrão: sem `CLAMAV_HOST` nada muda. Com ele, evidências, PDFs de nota fiscal e a foto do portal do cidadão são enviados ao `clamd` (protocolo `INSTREAM`, por TCP) depois das checagens baratas de tipo e assinatura e **antes** de qualquer gravação ([ADR-027](DECISIONS.md)).

Subir o `clamd` junto com o app no Compose:

```sh
# .env: CLAMAV_HOST=clamav
docker compose --profile antimalware up -d
```

O serviço `clamav` (`clamav/clamav:stable`) só existe no profile `antimalware`; um `docker compose up` comum não o inicia. Na primeira subida ele baixa as assinaturas e leva alguns minutos (o healthcheck espera até 5 minutos); as assinaturas ficam no volume `clamav_db`. A imagem oficial não tem build arm64, então em Apple Silicon ela roda emulada.

- **Arquivo infectado:** 422 `MALWARE_DETECTED` ("O arquivo foi recusado pela verificação de segurança e não foi salvo."), nada é gravado no disco nem no banco, e a auditoria registra o evento sem o nome da assinatura (que vai só para o log do servidor).
- **`clamd` fora do ar, lento, com resposta inesperada ou arquivo acima do limite de stream:** depende de `CLAMAV_FAIL_MODE`. `closed` (padrão): 503 `SCAN_UNAVAILABLE`, o upload é recusado e pode ser repetido depois. `open`: o arquivo é aceito, sem análise, e o log registra um aviso. Escolha `open` só se a disponibilidade dos uploads de campo pesar mais que a verificação.
- O scan roda dentro da fila serial de escritas: um `clamd` travado segura as escritas até `CLAMAV_TIMEOUT_MS` (10 s por padrão). `/healthz` **não** depende do `clamd`; monitore o serviço à parte.
- Verificado com um `clamd` real em container emulado (arquivo limpo aceito, infectado recusado, sem sobras no storage) e por 18 testes com um `clamd` falso (`tests/antimalware.test.js`); o script manual `tests/clamav-integration.mjs` repete o teste real. Não verificado: carga, `clamd` em outro host ou com TLS, atualização de assinaturas em produção.
- Não reanalisa arquivos gravados antes de ligar o recurso.

## Portal do cidadão

Desligado por padrão e sem canal externo de notificação ([ADR-025](DECISIONS.md)). Contrato das rotas públicas em [API](API.md#portal-do-cidadão-rotas-públicas).

1. **Antes de ligar:** revise com o jurídico o texto de consentimento (LGPD) e o prazo de retenção; o texto padrão é um ponto de partida, não uma validação. Confirme `TRUST_PROXY` (o `compose.yaml` fixa `1`): sem ele, todos os cidadãos apareceriam com o IP do proxy e os limites por IP bloqueariam todos juntos. Considere ligar o antimalware (foto de cidadão é entrada pública).
2. **Ligar:** como Administrador, em **Administração > Configurações**, habilite o portal e ajuste o texto de consentimento e os limites. As páginas são `/portal` (formulário) e `/portal/acompanhar` (consulta); com o portal desligado, ambas respondem 404.
3. **Desligar de emergência:** defina `URBANA_PUBLIC_PORTAL=off` no ambiente do processo e reinicie. A variável vence a configuração (`forced_off` aparece na Administração) e, desligado, `/api/publico/*` responde 404 e as páginas respondem 404 com "Portal indisponível". No Compose, defina `URBANA_PUBLIC_PORTAL=off` no `.env` e recrie o serviço com `docker compose up -d app`.
4. **Limites contra abuso** (padrões, ajustáveis na Administração): 10 criações por hora por IP, 30 consultas a cada 15 minutos por IP, teto global de 30 demandas aceitas por hora, tempo mínimo de 5 s no formulário e campo isca; até 2 uploads públicos simultâneos. **Não há CAPTCHA**: um robô que troque de IP pode esgotar o teto global e impedir cidadãos de registrar por até uma hora. Os contadores ficam na tabela `portal_rate_limits` (migration 13), com o IP como SHA-256 truncado, que é pseudonimização e não anonimização.
5. **O que entra no sistema:** ocorrências `IDENTIFICADA` de origem "Portal do cidadão", criadas pelo usuário de sistema `system-portal-cidadao` (perfil `Sistema`, que não faz login nem aparece na administração), para a triagem tratar normalmente. O portal ignora o limite de WIP do Kanban. A Caddy limita o corpo a 20 MB e a aplicação, a foto a 8 MB.
6. **Backup:** nada novo a copiar além do banco e de `uploads/`; os hashes de acompanhamento e a chave do formulário (`portal_secret`, na tabela `settings`) ficam no banco.

Verificado em Chrome headless e por testes (`tests/portal.test.js`, `tests/portal-browser.mjs`) e curl em modo produção; **não verificado** atrás de Caddy/HTTPS real, em aparelho físico nem com leitor de tela.

## Atualizar e preservar dados

`docker compose up -d --build` substitui a aplicação e mantém os volumes. Não use `docker compose down -v` em uma instalação com registros que devem ser preservados. Faça backup consistente antes da atualização, registre revisão Git/imagem/configuração e confira migrations aplicáveis. Versões 1–13 são executadas/verificadas automaticamente na inicialização.

| Versão | Conteúdo vigente                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Esquema base em `server/schema.sql`, execução idempotente e registro em `schema_migrations`                                                                                  |
| 2      | `action_plans`, `action_plan_occurrences` e índice de vínculos                                                                                                               |
| 3      | `client_requests`, `push_subscriptions`, `push_jobs`                                                                                                                         |
| 4      | `invoices`, `invoice_items`, `inventory_movements` e índices                                                                                                                 |
| 5      | version em occurrences/orders/action_plans                                                                                                                                   |
| 6      | Índices de paginação/filtros/auditoria/relacionamentos/consumo                                                                                                               |
| 7      | Índices de paginação e FKs dos movimentos de estoque                                                                                                                         |
| 8      | Inicialização das liberações individuais de módulos                                                                                                                          |
| 9      | Progresso versionado e eventos internos de onboarding                                                                                                                        |
| 10     | Coluna `evidence.captured_at` (hora de captura em campo; idempotente)                                                                                                        |
| 11     | Tabela `login_attempts` (limite de tentativas de login persistido) e índice de expiração                                                                                     |
| 12     | Obras e intervenções: `projects`, `interventions`, vínculos, avaliações de conflito, índices e, no PostgreSQL, `geom` gerada com GiST; não libera o módulo `works` a ninguém |
| 13     | Portal do cidadão: `portal_tracking`, `portal_rate_limits` e as linhas `portal` (desligado) e `portal_secret` em `settings`                                                  |

As migrations são arquivos numerados `server/migrations/NNN-nome.js` (`001-baseline.js` a `013-public-portal.js`), cada um exportando `up(db)`; o executor está em `server/db.js` e **exige numeração contínua** (um arquivo fora de sequência impede a inicialização). Versões 2–8 e 10–13 são transacionais e registradas após sucesso; as migrations 12 e 13 são aditivas (nenhuma tabela existente muda). As versões 1 (esquema base em `server/schema.sql` e PostGIS) e 9 (marcador das tabelas de onboarding, criadas pelo esquema base) são **repetíveis**: rodam a cada inicialização, fora de transação, e são registradas de forma idempotente. Não há CLI separado nem downgrade automatizado. Não editar migrations existentes; adicionar versão aditiva e verificar em instalação existente. A mudança das migrations 1–10 para arquivos não alterou o SQL; foi conferida em cópias de um banco SQLite existente e de um banco legado, com esquema e dados idênticos aos do código anterior. Scripts em `scripts/` que reescrevem permissões/perfis não fazem parte deste procedimento nem de migrations ativas.

Após atualizar: verificar logs/healthcheck, login, catálogo, programação, evidência, conclusão/validação, nota/estoque e push configurado; comparar dados preservados. Se falhar, interromper tráfego e investigar; voltar somente para imagem compatível com o esquema aplicado ou restaurar o conjunto banco+arquivos/configuração da cópia anterior. Não pressupor rollback de schema ao trocar imagem.

## Backup e restauração

Defina frequência/retenção conforme perda tolerável, guarde cópia fora do host com acesso restrito e teste restauração em ambiente isolado. Preserve também configuração, chaves VAPID e versão da aplicação de forma segura; volumes do Caddy podem ser copiados separadamente.

### `npm run backup`

`npm run backup` (`scripts/backup.mjs`) cria uma pasta `urbana-AAAAMMDD-HHMMSSZ` (UTC) em `BACKUP_DIR` (padrão `backups/`, ignorada pelo Git) com o banco, as pastas `uploads/` e `invoices/` e um `manifest.json` (dialeto, data, SHA-256 do banco, versão do esquema no SQLite e contagem de arquivos). Opções: `--out=DIR` e `--keep=N` (ou `BACKUP_DIR`/`BACKUP_KEEP`); a retenção remove só pastas com o nome do script **e** `manifest.json`, nunca o backup novo. Lê `DATA_DIR` e `DATABASE_URL` como o servidor. O backup é montado numa pasta `.tmp-` e renomeado só ao final; uma falha não deixa pasta parcial.

- **SQLite:** `VACUUM INTO` gera a cópia **com o servidor em execução** (inclui o conteúdo do WAL), e a cópia é aberta e verificada (`quick_check`) antes de ser declarada backup. O arquivo ativo nunca é copiado diretamente.
- **PostgreSQL:** executa `pg_dump --format=custom --no-owner` (formato `urban.dump`), com a conexão passada por variáveis `PG*` (a senha não aparece na linha de comando). O `pg_dump` precisa ser **de versão compatível com o servidor** (igual ou mais nova); defina `PG_DUMP_BIN` se o padrão do sistema for mais antigo. **A imagem do app não traz o cliente PostgreSQL**: rode o script no host (ou em outro container com `pg_dump` e acesso a `DATA_DIR`).
- O banco é copiado antes dos arquivos, então todo registro do banco tem seu arquivo na cópia (arquivos mais novos que o dump são apenas órfãos inofensivos).
- Na imagem, `docker compose exec app node scripts/backup.mjs --out=/app/data/backups` deve funcionar para SQLite, mas **não foi executado** (Docker/imagem não testados); a pasta fica no mesmo volume e precisa ser copiada para fora do host (`docker compose cp`).

Verificado por testes automatizados (`tests/backup.test.js`): backup SQLite com o banco aberto em WAL, cópia reaberta e restaurada; retenção; falha sem pasta parcial; variáveis `PG*`. **Não verificado:** `pg_dump` do host contra o servidor (só foi validado dentro do container do banco, quando o cliente do host era de versão menor que a do servidor) e **restauração de um dump** (`pg_restore`) em banco novo. Trate a restauração PostgreSQL como procedimento a homologar.

Restaurar um backup do script: com o app parado, copie `urban.sqlite` para `DATA_DIR` (removendo `urban.sqlite-wal` e `urban.sqlite-shm` antigos), restaure `uploads/` e `invoices/`, ajuste o dono no Linux (`chown`) e confira `schema_migrations`, contagens, login e abertura de evidências/PDFs antes de promover. Para PostgreSQL use `pg_restore` como em [PostgreSQL](#postgresql).

As receitas manuais abaixo continuam válidas como alternativa e são procedimentos a homologar, não registro de execução neste ambiente.

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

O Campo (`/campo`) abre sem rede depois de ter sido usado uma vez com conexão e guarda, por usuário, no IndexedDB do aparelho: a sessão, a lista de tarefas e o detalhe das OS ativas, os rascunhos de registro e uma **fila de ações** (assumir, iniciar, concluir, devolver, material, equipamento e fotos), sincronizada ao reconectar, ao voltar ao app, a cada 15 segundos, pelo botão **Enviar agora** e por Background Sync quando o navegador o oferece. Cada ação leva `request_id` e `captured_at`, então reenviar não duplica e os horários refletem o trabalho real (a API aceita no máximo 30 dias de atraso e 5 minutos de adiantamento; fora disso a ação é rejeitada e o operador decide). O service worker (`v4`) guarda o HTML e os arquivos com hash do build e **não toca em nenhuma requisição de `/api`**: sem rede, é o próprio app que abre o Campo com a sessão salva no IndexedDB quando `/api/bootstrap` não responde (sem rede, tempo de 15 s ou 502/503/504), revalida a sessão ao voltar a rede e trata o 401 como sessão expirada ([ADR-020](DECISIONS.md)). A troca do `v3` para o `v4` em aparelhos que já tinham o `v3` não foi observada.

Limites: login e a primeira abertura exigem rede; **registrar nova ocorrência exige rede** (rascunho local e reenvio manual); fotos de até 15 MB ficam no IndexedDB sem compressão; iOS não tem Background Sync e pode apagar dados do site após cerca de sete dias sem uso se o app não estiver instalado; limpar os dados do navegador elimina fila e rascunhos; ao publicar um build novo, o HTML vem da rede quando há conexão e os arquivos antigos continuam servindo a página aberta até ela recarregar. Verificado em Chrome headless e por testes da fila; **não testado em aparelho real**. As regras de execução, permissões e retenção local estão no [contexto mestre](URBANA-CONTEXTO-MESTRE.md).

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

Default: LocalFileStorage(DATA_DIR), preserva uploads/ e invoices/. Ambos os downloads permanecem autenticados. ObjectFileStorage recebe client/bucket/prefix por injeção em createApp(db,{storage}); o client deve adaptar putObject/getObject/deleteObject/headObject ao SDK S3/MinIO escolhido. Não existe ativação externa automática por variável nem SDK/credencial fictícios. Backup continua incluindo banco e arquivos; uma migração para bucket exige transferência verificada dos arquivos históricos. Upload usa buffer limitado a 15 MB; dimensionar memória e concorrência do proxy para homologação. Erros após save limpam arquivo após rollback; queda abrupta deixa arquivos órfãos, tratados pela varredura descrita em [Uploads órfãos](#uploads-órfãos).

Para executar homologação posteriormente, configure URBANA_POSTGRES_TEST_URL por meio seguro apontando EXCLUSIVAMENTE para banco isolado de testes com PostGIS instalado e permissão de criar schema. Execute `node --test tests/postgres.test.js`. O teste cria schema urbana_test_<UUID>, executa migrations/seed/consultas/corrida/rollback e remove apenas esse schema no final. DATABASE_URL de produção nunca é escolhido implicitamente. Sem a variável, teste fica explicitamente não executado; isso não comprova homologação PostgreSQL/PostGIS.

## Atualização dos assets

O build gera chunks dinâmicos. Publique todo dist/ da mesma revisão; mantenha assets antigos acessíveis durante atualização de sessões abertas ou peça recarregamento antes de operar. Os nomes têm hash; não misture index/assets de revisões diferentes. O service worker de `/campo` guarda os arquivos com hash do build já carregados (até 200) para abrir o app sem rede; trocar `VERSION` em `public/sw.js` descarta os caches antigos. Os dados de OS e a sincronização do Campo não vêm desses arquivos (ver [Limites de uso sem rede](#limites-de-uso-sem-rede)).

Há limite de quatro uploads concorrentes por aplicação (maxConcurrentUploads na fábrica), compartilhado entre evidências e PDFs. Excesso retorna 429 UPLOAD_BUSY e pode ser reenviado; limite e política do proxy devem ser dimensionados em homologação. O portal do cidadão tem fila própria, de até 2 uploads públicos simultâneos, separada da das equipes (excesso: 429 `PORTAL_BUSY`).

## Ambiente local com PostgreSQL/PostGIS (desenvolvimento e homologação)

`compose.local.yaml` sobe o Urbana com PostgreSQL/PostGIS e dados demonstrativos, sem HTTPS — **não usar em produção**.

```bash
docker compose -f compose.local.yaml up -d --build      # API/web na porta 3000; Postgres em localhost:5442
URBANA_POSTGRES_TEST_URL=postgres://urbana:urbana@localhost:5442/urbana_test npm test   # inclui tests/postgres.test.js
docker compose -f compose.local.yaml down -v            # apaga banco e anexos locais
```

O banco `urbana_test` (com PostGIS) é criado por `docker/postgres-init/` na primeira subida do volume. A imagem oficial `postgis/postgis` só existe para amd64; em Apple Silicon roda emulada. Em 2026-10-03 a suíte completa (72 testes, incluindo PostgreSQL/PostGIS) passou contra esse ambiente; nas tarefas técnicas de novembro de 2026 ela foi repetida várias vezes, e o registro da R6 (segunda rodada) relata **184 de 184** contra PostgreSQL/PostGIS real (sem PostgreSQL: 179 aprovados e 5 não executados). Essa execução com PostgreSQL não foi repetida na revisão desta documentação, e as suítes de API continuam rodando só sobre SQLite. O serviço `app` desse arquivo usa `DEMO_DATA=true`, `SECURE_COOKIE=false` e `URBANA_ALLOW_INSECURE_DEMO=true`; sem esta última o servidor recusaria subir com `HOST=0.0.0.0` e contas de demonstração. A chave foi **mantida** (decisão da segunda rodada, a revisar) porque o app móvel `urbana-campo` é testado contra esse backend pelo IP da rede, o que exige `HOST` fora de loopback; o arquivo traz um comentário com o motivo. A senha do banco é fixa: não use esse arquivo em produção. O CI do GitHub (`.github/workflows/ci.yml`: lint, `format:check`, testes com essa imagem como serviço e build) **ainda não foi executado** lá; os testes de navegador não fazem parte do CI.

**Não verificado neste ambiente:** carga e benchmark de volume em PostgreSQL; a imagem Docker da aplicação (os testes rodam o código direto; o serviço `app` do `compose.local.yaml` não foi construído); Caddy real e HTTPS; instâncias múltiplas reais; Node 24 (a máquina de desenvolvimento tem Node 22.20.0); aparelho físico e Edge; o workflow no GitHub Actions.
