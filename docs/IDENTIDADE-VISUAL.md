# Identidade visual

## Direção

A identidade combina papelaria botânica em aquarela, fotografia documental quente e composição editorial. As páginas devem ter bastante respiro, hierarquia delicada, bordas discretas e movimentos mínimos. A sensação é de álbum íntimo, convite impresso e caminhada compartilhada.

Evite cores saturadas, sombras fortes, excesso de ornamentos, cartões com aparência de e-commerce e qualquer efeito que concorra com as fotografias.

## Paleta ativa

Os tokens principais estão em `src/app/globals.css`.

| Papel | Token/valor | Uso |
| --- | --- | --- |
| Marfim | `--paper`, efetivamente `#FBF7ED` | Fundo principal. |
| Creme | `--cream: #EEE5D8` | Cartões e faixas de apoio. |
| Café | `--ink`/`--color-coffee: #493825` | Texto principal e contraste quente. |
| Texto secundário | `--muted: #716352` | Corpo secundário e legendas. |
| Oliva | `--olive: #596333` | Ações, títulos em destaque e elementos botânicos. |
| Rosa queimado | `--rose: #BB7B80` | Ênfase romântica pontual. |
| Linha | `--line: #CBBB9F` | Divisórias e bordas. |
| Areia | `--sand: #D9C6AC` | Placeholders e apoio. |
| Champanhe/dourado | `--color-gold: #B58D50` | Detalhes especiais. |

Na seção Insanos, a base é quase preta (`#080807`), com marfim `#F3EFE8`, bronze, prata e ouro. Essas cores não devem se espalhar pela Home.

## Tipografia

- Corpo: `Aptos`, com fallback para `Segoe UI`, Arial e sans-serif. Peso predominante 400.
- Títulos: Georgia/`Times New Roman`, serifada clássica e editorial.
- Assinaturas: `Segoe Script`/`Brush Script MT`, usada pontualmente.
- Eyebrows: caixa alta, tamanho pequeno e espaçamento amplo entre letras.

A Aptos não está incorporada ao repositório. A aparência depende da fonte disponível no sistema e deve continuar aceitável com os fallbacks.

## Marca oficial

Arquivo: `public/images/papelaria/Logo.png`.

Uso obrigatório por `src/components/wedding-logo.tsx`:

- `navbar`: compacto;
- `hero`: principal;
- `medium`: RSVP e áreas intermediárias.

Regras:

- preservar a proporção quadrada;
- `object-fit: contain`;
- não cortar;
- não aplicar filtros, blur, saturação, recoloração ou sombra pesada;
- manter fundo marfim compatível e respiro;
- não substituir a marca por “Paula & Erik” digitado.

## Fotografia

As fotos vêm do ensaio de Raquel Reis. A linguagem aprovada privilegia luz quente, madeira, plantas, gestos cotidianos, proximidade e enquadramentos naturais.

`DreamPhoto` centraliza o tratamento: `object-position` configurável, máscara suave nas bordas, cantos arredondados e nenhum filtro de cor. O original não é editado.

### Fotografias ativas na Home

| Arquivo | Uso atual |
| --- | --- |
| `pe-12.jpg` | Hero e primeiro quadro da história. |
| `pe-9.jpg` | “A beleza de dividir os dias”. |
| `pe-15.jpg` | “Um passo de cada vez”, junto à janela. |
| `pe-22.jpg` | Fundo de “Eu escolhi você”. |
| `pe-26.jpg` | Encerramento horizontal da Home. |

`pe-6.jpg`, `pe-32.jpg` e `pe-33.jpg` continuam no acervo e também abastecem os presentes mockados quando referenciadas em `gift-list.tsx`.

### Ornamentos de papelaria

| Arquivo | Situação |
| --- | --- |
| `Logo.png` | Marca oficial. |
| `Ornamento_Ramos_Coracao.png` | Divisor centralizado da história. |
| `Arranjo_Floral_Intenso_Transparente.png` | Cartão público do evento. |
| `Floral_Canto_Intenso_Transparente.png` | Hero da página de presentes. |
| `rodape_site.png` | Arte panorâmica do rodapé da Home. |
| `Folhagem_Intensa.png` e `Paula_Erik_Nomes_Coracao_Transparente.png` | Mantidos no acervo; não substituir a marca ou preencher fundos sem pedido. |

Os materiais de convite e save the date foram referência visual, não fonte automática de texto, datas antigas ou regras de privacidade.

## Ícones

Setas reutilizáveis ficam em `src/components/icons.tsx`. A linguagem aprovada usa SVG inline, `fill: none`, `stroke: currentColor`, `stroke-width: 1.4`, extremidades arredondadas e tamanho de 12–15 px. Links discretos podem deslocar o ícone `2px` no hover.

Não use `↗`, `→`, `➜`, `⤴` ou emoji como ícone novo.

## Responsividade da Home

- Navegação vira menu até 900 px.
- O conteúdo usa `.section-shell` com largura máxima e margens laterais.
- Até 640 px, a história passa para fluxo vertical: foto grande, frase abaixo e foto da janela visível em seguida.
- Nenhum bloco da narrativa pode usar `display: none`, posição absoluta ou deslocamento que o retire do viewport.
- O ramo decorativo é centralizado por largura/auto margins, sem `margin-left` ou transformações corretivas.
- Fotografias preservam rostos com `object-position`; não fazer crop agressivo.

## Página de presentes

A página mantém fundo marfim, hero centralizado, filtros em pills, cards leves e modal editorial. O título “Lista de Presentes” está em uma linha quando houver espaço e recebeu aumento de tamanho aprovado; nomes dos presentes ficam limitados a uma linha com reticências.

### Presentes Insanos

Background ativo: `public/images/presentes/banner-presentes-insanos.png`.

Moedas ativas:

- `moeda-bronze-final.png`;
- `moeda-prata-final.png`;
- `moeda-ouro-final.png`.

Outras versões de moedas permanecem na pasta, mas não são referências ativas. Não troque os arquivos sem atualizar esta lista.

Textos dos cards:

- Bronze: “Uma contribuição simbólica para seguir na estrada.”
- Prata: “Um gesto especial para acompanhar o próximo capítulo.”
- Ouro: “Uma grande força para esta nova caminhada.”

Composição:

- desktop largo: texto à esquerda, três cards verticais à direita;
- 768–1199 px: uma única imagem de fundo com `cover`, ponto focal horizontal próximo de 58%, cards integrados abaixo do texto e transição escura gradual;
- até 767 px: fundo contínuo na seção inteira e cards horizontais, com moeda à esquerda e conteúdo à direita;
- 768–820 px: cards comuns da seção Insanos continuam em duas colunas, com Ouro centralizado na linha seguinte;
- a seção termina com linhas, símbolo vetorial de motocicleta e “MAIS QUE PRESENTES, CONQUISTAS COMPARTILHADAS.”

A ordem textual nunca deve ser invertida por `order`: introdução sempre antes de “Gratidão, irmãos!”.

