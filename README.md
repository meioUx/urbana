# Urbana · Gestão de Manutenção Municipal

Aplicação web para registrar demandas, programar ordens de serviço e acompanhar execução/validação municipal. React + TypeScript, Express e sessão autenticada; SQLite local ou adaptador PostgreSQL/PostGIS.

## Executar

Requer Node.js 24 ou superior. No PowerShell, utilize npm.cmd quando a política local bloquear npm.ps1.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Acesse http://127.0.0.1:3000. Desenvolvimento com atualização automática: `npm.cmd run dev`. PORT escolhe a porta; HOST é 127.0.0.1 por padrão. Variáveis de .env são carregadas na inicialização; consulte [.env.example](.env.example).

Na primeira execução, banco e seed são criados. Os exemplos são demonstrativos, com Balneário Camboriú como referência geográfica, sem representar demandas reais.

| Perfil de demonstração | E-mail | Senha inicial |
| --- | --- | --- |
| Administrador | admin@urbana.local | Urbana@2026 |
| Gestor | gestor@urbana.local | Urbana@2026 |
| Triagem | triagem@urbana.local | Urbana@2026 |
| Equipe de Campo | campo@urbana.local | Urbana@2026 |
| Fiscalização | fiscal@urbana.local | Urbana@2026 |
| Consulta | consulta@urbana.local | Urbana@2026 |

ADMIN_PASSWORD substitui a senha inicial das contas criadas pelo seed, sem redefinir usuários existentes. Para instalação real: banco novo, DEMO_DATA=false, senha própria e HTTPS/SECURE_COOKIE=true, seguindo [Implantação](docs/DEPLOYMENT.md).

Sem DATABASE_URL, os registros ficam em data/urban.sqlite; anexos em data/uploads e PDFs de notas em data/invoices. Não remova dados ao atualizar. Trocar DATABASE_URL não transfere registros automaticamente. Banco, backups e restauração estão em DEPLOYMENT.md.

## Documentação

Para compreender o produto e sua arquitetura:

- [Contexto mestre](docs/URBANA-CONTEXTO-MESTRE.md)
- [API](docs/API.md)
- [Implantação](docs/DEPLOYMENT.md)
- [Changelog](docs/CHANGELOG.md)
- [Decisões arquiteturais](docs/DECISIONS.md)

O contexto mestre reúne domínio, fluxos, módulos, permissões, arquitetura e roadmap, distinguindo IMPLEMENTADO, PARCIAL e PLANEJADO. Comece por ele antes de alterar regras ou arquitetura.

## Experimentar a operação

1. Registre uma ocorrência com localização, origem, categoria e foto.
2. Conclua a triagem e programe uma OS com equipe do mesmo setor.
3. Abra /campo como operador autorizado; registre foto antes e coordenadas de chegada, inicie e informe materiais/equipamentos quando exigidos.
4. Registre foto depois e relato; envie para análise.
5. Como gestão/fiscalização, valide ou solicite correção justificada.

Exigências dependem da categoria; exemplos em etapas avançadas não incluem fotos reais. Crie registro novo para verificar o ciclo inteiro. Planejamento, Kanban e almoxarifado complementam o fluxo descrito no mestre.

Mapa Leaflet usa provider configurável; sem configuração, exibe grade local de desenvolvimento, sem cartografia ou requisições externas. Configure o mapa-base e a atribuição antes da produção: [configuração e diagnóstico dos tiles](docs/MAP-TILES.md). GPS/mapa e endereço manual localizam registros; não há integração ArcGIS. Campo guarda rascunhos no aparelho e permite reenvio manual; não há sincronização offline completa. Web Push exige configuração e validação real do aparelho conforme a implantação.

## Testes

```powershell
npm.cmd test
npm.cmd run build
# Microsoft Edge instalado; acesso à internet para os mapas:
npm.cmd run test:ui
npm.cmd run test:field
npm.cmd run test:kanban
```

API/regras e scripts de navegador usam bancos temporários isolados. Navegador inicia servidor compilado e salva capturas em test-results/. Cobertura inclui autenticação, permissões, ciclo, evidências, auditoria, rollback, idempotência, planejamento, notas/estoque, setor e Kanban. Execução local não homologa Docker, PostgreSQL/PostGIS real, push externo ou carga municipal; resultados históricos estão no Changelog.
