# Ajustes visuais sobre a Fase 1

Esta revisão substitui as definições anteriores de fonte e marca.

- `src/components/wedding-logo.tsx`: componente oficial com tamanhos navbar, hero e médio. Referência direta ao Logo.png via Next/Image, proporção original, `contain`, sem filtros ou alterações no arquivo.
- `src/components/dream-photo.tsx`: fotografia reutilizável com ponto focal configurável. A máscara e o arredondamento ficam somente nas fotografias.
- `src/components/navigation.tsx`: logo oficial no cabeçalho.
- `src/components/photo.tsx`: P&E-12 como primeira foto; integração com DreamPhoto.
- `src/app/page.tsx`: logo maior, data e versículo duplicados removidos do hero; pausas emocionais mantidas na história; fotografia final inteira; arte rodape_site completa no encerramento.
- `src/app/globals.css`: Aptos, Segoe UI, Arial e sans-serif; corpo 400 e entrelinha 1.35; narrativa com largura máxima de 720px; justificação somente em desktop; bordas fotográficas com transição duas vezes mais ampla (6% desktop, 3% mobile) e cantos de 12px/10px; arte final limitada a 1000px no desktop e 94% no celular; frase final reduzida cerca de 20%.
- `public/images/papelaria/Logo.png` e `rodape_site.png`: cópias idênticas dos arquivos fornecidos.
- `public/images/casal/pe-12.jpg`: cópia idêntica da fotografia original.

A Aptos depende de disponibilidade no dispositivo; a stack usa Segoe UI ou Arial quando necessário. Não foi incorporada nem redistribuída uma fonte proprietária.

Verificados: 375, 390, 430, 768, 1024 e 1440px, proporções das marcas, imagem P&E-12, ausência de filtros, menu, teclado, história expansível e contagem regressiva. Capturas específicas do encerramento em 1440px e 390px foram salvas na pasta de entregas.

O projeto continua em Next.js padrão, compatível com a futura publicação na Vercel. Segredos não foram adicionados; `.env.local` segue ignorado pelo Git. Supabase, migrations e configuração de publicação permanecem para as próximas fases. Nenhum deploy foi realizado nesta revisão.
