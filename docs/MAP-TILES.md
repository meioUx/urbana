# Mapa e provider de tiles

## Diagnóstico

`src/modules/map/GeoMap.tsx` usava a URL canônica do OSM diretamente no componente, com atribuição. Não foi encontrado uso de `{s}.tile.openstreetmap.org`, proxy de tiles, prefetch ou download de regiões. O service worker intercepta somente navegação da mesma origem, não tiles. O `no-store` do backend é restrito à API e não altera requisições de imagens externas. Não há `no-cache`/`Pragma` de tiles configurado no código.

`server/app.js` enviava `Referrer-Policy: same-origin`: isso elimina o Referer em tiles externos e viola a política do OSM. Foi corrigido para `strict-origin-when-cross-origin`, que deixa o navegador enviar a origem verdadeira em HTTPS sem expor caminhos. Não há alteração de User-Agent ou falsificação de Referer. O código comprova essa violação, mas não permite atribuir com certeza o bloqueio específico a ela sem logs do serviço. Os testes headless também carregavam tiles reais, inclusive em navegação/zoom.

## Configuração

A configuração central fica em `src/modules/map/config.ts` e `tile-provider.mjs`. Componentes não contêm URLs de provider. Em `.env.local`, antes de iniciar o desenvolvimento ou compilar:

```dotenv
VITE_MAP_TILE_URL=https://seu-provider.example/tiles/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=© atribuição exigida pelo seu provider
VITE_MAP_MAX_ZOOM=19
```

As variáveis `VITE_*` são públicas e incorporadas durante o build. Use somente tokens destinados a uso público no navegador. Alterar apenas o ambiente do processo de produção não modifica um bundle já compilado; execute novamente `npm run build`. Docker aceita esses valores como build args; Compose os encaminha automaticamente: `docker compose up -d --build`.

Sem URL, todos os ambientes usam uma grade SVG local, identificada como desenvolvimento e sem cartografia. Isso permite desenvolver marcadores, seleção, calor e GeoJSON sem consumir um servidor externo; não é um mapa-base de produção. Providers externos exigem atribuição. O OSM só é aceito por configuração explícita com sua URL canônica, sempre com atribuição dos colaboradores.

## Camadas e uso

Leaflet foi mantido. Tiles são uma camada independente dos registros e do mapa de calor. O prop `overlays` recebe camadas GeoJSON com `id`, `data` e `options` de Leaflet, permitindo pontos, linhas e polígonos de obras, intervenções, road segments, interdições e mobilidade sem vincular esses dados ao provider. As telas continuam usando seus dados existentes; não foram inventadas integrações de dados operacionais novas.

A camada solicita a área visível após navegação/zoom, com `updateWhenIdle`, `updateWhenZooming: false` e `keepBuffer: 0`, sem prefetch. O cache de tiles externos permanece sob controle normal do navegador e dos headers do provider. A atribuição permanece no controle Leaflet, com fonte de 11px.

Todos os scripts browser usam `tests/map-browser-fixture.mjs`: antes da navegação, mockam imagens externas e a grade local, bloqueiam outros acessos aos hosts OSM e desativam service workers. Não fazem download real de tiles, mesmo se o bundle apontar explicitamente para OSM. Novos testes browser devem usar essa fixture.

## Produção

Escolha um serviço contratado compatível com o tráfego esperado ou infraestrutura própria e configure URL, atribuição e zoom segundo seus termos. Não assuma disponibilidade ou SLA dos servidores voluntários OSM. Se optar explicitamente pelo OSM, siga sua política completa, preserve Referer verdadeiro e cache, mantenha atribuição visível e não faça prefetch/offline. Verifique também se o CDN/proxy da implantação não substitui Referrer-Policy por uma política que suprima Referer. A correção não garante que um bloqueio já aplicado seja levantado; não rotacione identidade, proxy ou host para contorná-lo.

Política oficial: https://operations.osmfoundation.org/policies/tiles/

## Validação desta correção

- `npm run build`: TypeScript e Vite.
- `npm test`: 48 testes passaram; 1 teste PostgreSQL/PostGIS pulado por falta de `URBANA_POSTGRES_TEST_URL`.
- `npm run test:ui`: desktop e celular, tiles mockados, sem erros de JavaScript.
- `npm run test:map`: Referer com origem verdadeira, atribuição OSM visível, pontos/linhas/polígonos GeoJSON, mapa de calor e preservação das camadas com falha dos tiles, sem rede OSM.
