# Publicação do Urbana Campo

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

Variáveis de banco PostgreSQL e ArcGIS podem ser acrescentadas ao ambiente do serviço `app` quando disponíveis. Não configure PostgreSQL apenas para a publicação funcionar: esta composição usa SQLite persistente em uma única instância. Não escale para múltiplas réplicas compartilhando esse volume.

## Atualizar e preservar dados

`docker compose up -d --build` substitui a aplicação e mantém os volumes. Não use `docker compose down -v` em uma instalação com registros que devem ser preservados. Faça backup consistente de todo o volume `urban_data`, incluindo banco e arquivos; para uma cópia simples, pare o serviço `app` durante o backup. Migrações 2 e 3 são aditivas e executadas automaticamente.

## Limites de uso sem rede

O navegador guarda o registro em rascunho (foto e campos), fotos de execução ainda não enviadas e relato de conclusão. A autenticação e a abertura dos dados de trabalho precisam de conexão. Não há cache offline de ordens nem envio automático em segundo plano de evidências. Com a aplicação aberta, uma perda de sinal permite continuar preenchendo o registro; reconecte e toque em enviar. Repetir registros/fotos usa identificadores estáveis para impedir duplicação.

## Referências de implementação

- [Biblioteca Web Push](https://github.com/web-push-libs/web-push): VAPID, assinatura e envio cifrado.
- [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): avisos em segundo plano.
- [Web Push em apps da Tela de Início no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): instalação e permissões.

## Modelos de OS usados como referência

Os documentos `EXEMPLO ORDEM DE SERVIÇO.pdf` e `MODELO DE ORDEM DE SERVIÇO - ana.pdf`, fornecidos pelo usuário, orientaram os campos de emissor, data/hora, solicitante/telefone, local/referência/bairro, descrição, equipe, materiais, resultado e justificativa de impossibilidade. O exemplo preenchido não foi importado como ocorrência real. A autenticação identifica o responsável pela execução e aprovação; as fotos já ficam vinculadas à OS, dispensando fotografar um formulário em papel. As prioridades internas permanecem Emergencial, Alta, Média, Baixa e Programada, sem uma conversão automática das quatro caixas do formulário físico.
