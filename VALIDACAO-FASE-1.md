# Validação da Fase 1

Verificações realizadas em 7 de setembro de 2026.

- Compilação de produção Next.js e validação TypeScript concluídas.
- ESLint sem erros ou avisos.
- Rota principal respondendo HTTP 200.
- Layout verificado em 375, 390, 430, 768, 1024 e 1440 pixels, sem transbordamento horizontal.
- Ampliação do texto raiz para 200% em 375, 768 e 1440 pixels, sem transbordamento horizontal após correção.
- Menu móvel: abrir, fechar com Escape e fechar após selecionar uma seção.
- Expansão e recolhimento da história integral; presença dos parágrafos fornecidos.
- Contagem regressiva hidratada no navegador, com destino em 21/11/2026 às 13h de Brasília e limite mínimo zero.
- Preferência `prefers-reduced-motion` respeitada na rolagem.
- Nove imagens visíveis na versão desktop decodificadas com sucesso.
- Fotografias e ornamentos revisados visualmente em capturas de desktop e celular.
- Nenhum erro JavaScript de página no teste de navegação.
- Seis fotografias copiadas verificadas por SHA-256: cópias idênticas aos originais.

Testes de navegador realizados com Microsoft Edge via Playwright. As checagens cobrem a interface implementada nesta fase. Não representam auditoria completa WCAG, testes em todos os navegadores ou validação de backend. RSVP, autenticação, banco e pagamentos ainda não estão implementados.
