# Nós — editorial fotográfico

Página pública estática `/nos`, implementada após aprovação da curadoria de 15 fotografias do ensaio de Raquel Reis. A revisão visual pelo casal permanece pendente. Não houve publicação.

## Curadoria e composição

Ordem: **06, 14, 01, 02, 03, 08, 09, 18, 21, 26, 27, 31, 32, 16, 33**.

- Abertura: 06 vertical em todos os dispositivos, com “Nós.” e os nomes.
- Ambiente: 14 + 01, com 02 menor como detalhe.
- Aproximação: 03 isolada.
- Dança: 08 + 09 em escalas e posições diferentes.
- Café: 18 horizontal + 21 vertical.
- Cartas: 26 dominante + 27 menor à direita.
- Objetos: 31 isolada; depois 32 ampla e 16 contemplativa.
- Encerramento: 33 vertical, “E continuo escolhendo você.” e “Paula & Erik”.

São nove verticais e seis horizontais, sem repetição dentro da página. Os nomes dos blocos não aparecem para o visitante. A introdução usa apenas “Entre todos os caminhos.”. Textos futuros permanecem em comentários no código.

## Arquivos e apresentação

`src/app/nos/page.tsx` define a composição manual, dimensões e textos alternativos. `nos.module.css` isola os estilos. Reutiliza `Navigation`, incluindo `WeddingLogo`, sem modificar o menu compartilhado.

As imagens usam Next/Image com largura, altura e proporção originais, `sizes` por composição, `object-fit: contain` e sem máscaras, filtros ou recortes. Apenas 06 tem `preload` (substituto de `priority` no Next 16); as outras usam lazy loading. A proporção explícita reserva o espaço mesmo durante a troca entre resoluções otimizadas.

Arquivos novos, copiados sem edição para `public/images/casal`: `pe-1.jpg`, `pe-2.jpg`, `pe-3.jpg`, `pe-8.jpg`, `pe-14.jpg`, `pe-16.jpg`, `pe-18.jpg`, `pe-21.jpg`, `pe-27.jpg`, `pe-31.jpg`. Os arquivos 06, 09, 26, 32 e 33 já existiam e foram reutilizados. A cópia duplicada da 33 não foi importada.

No mobile, larguras variam entre 62% e 92%, com margens e pausas específicas. As verticais nunca viram banners horizontais. Os pares usam uma sequência legível em vez de miniaturas lado a lado.

## Home

A única adição visual é o link “CONHEÇA NOSSA HISTÓRIA” com `ArrowRightIcon`, para `/nos`, dentro de `.choice-frame` depois de “e continuo escolhendo.”. Estilos em `src/app/home-cta.module.css`: transparente, borda fina, foco claro, alvo de 44px e hover discreto. O espaçamento do próprio link é 16px no mobile, 17px no tablet e 20px no desktop. Nenhum estilo anterior da seção, imagem, overlay ou texto foi alterado.

## Verificação

Revisar em 375, 390, 430, 768, 1024, 1280 e 1440px: ordem das 15 fotos, proporções, ausência de overflow, abertura e encerramento, menu mobile, retorno à Home e CTA dentro da moldura. Comparar a altura da seção Home com 520px no mobile, 580px no tablet e 660px no desktop.

Executar `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` e `git diff --check`. Capturas de revisão ficam fora do repositório. A página não consulta banco, Supabase ou APIs e não modifica RSVP, presentes, contribuições ou administração.
