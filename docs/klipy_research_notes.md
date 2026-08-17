# Notas de pesquisa — Klipy

As rotas públicas do proxy Render retornam HTTP 200, mas listas vazias para GIFs e figurinhas. Isso indica que a chamada ao provedor foi aceita, porém o normalizador atual não reconhece a estrutura JSON devolvida.

A referência publicada pela Klipy informa que a busca usa `GET https://api.klipy.com/api/v1/API_KEY/gifs/search` com `q`, `page` e `per_page`; para o conteúdo popular, há uma rota específica `.../gifs/trending`. A resposta tem a forma `{ "result": true, "data": { "data": [...] } }` e as URLs de mídia ficam em `files` de cada resultado, não somente em `media_formats`.

A documentação pública da Klipy separa GIFs e figurinhas e disponibiliza rotas próprias de busca e tendência. A próxima correção deve ajustar os parâmetros de busca e os campos de mídia reconhecidos pelo proxy, preservando o retorno simplificado para o cliente.

Referências consultadas:

- https://docs.klipy.com/gifs-api
- https://docs.klipy.com/gifs-api/gifs-search-api
- https://github.com/KLIPY-com/Klipy-GIF-API
- https://dev.to/zuplo/exploring-the-klipy-api-29po
