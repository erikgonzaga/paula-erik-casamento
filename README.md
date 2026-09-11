# Paula & Erik — Caminhando juntos

Site de casamento construído em etapas. Esta entrega inclui a **Fase 2 — RSVP fechado**, validada localmente e pendente da configuração do Supabase, com as fotografias e os ornamentos reais fornecidos pelo casal. Ainda não é a versão para divulgar e receber confirmações.

## O que está pronto

- Next.js 16.3.4, TypeScript, App Router e Tailwind CSS 4.
- Página inicial com fotografia do ensaio, data, versículo e contagem regressiva até 21/11/2026 às 13h, no horário de Brasília.
- História editorial em cinco capítulos e texto integral expansível.
- Linha orgânica ligando os acontecimentos da caminhada.
- Seção “Eu escolhi você”, pessoas especiais, informações públicas do evento e encerramento.
- Menu para celular, navegação por âncoras, foco visível, textos alternativos e respeito à preferência por movimento reduzido.
- RSVP fechado por código ou link, com integrantes previamente autorizados e respostas editáveis. Presentes ficam para a próxima fase.

O endereço completo, o estacionamento e o valet não estão nos arquivos públicos. Não há chaves reais, contas administrativas ou banco em nuvem conectado nesta entrega. A página está marcada como `noindex` durante o desenvolvimento; isso não é um mecanismo de autenticação.

## Como abrir no seu computador

1. Instale Node.js 22 ou superior usando o instalador oficial disponível em https://nodejs.org. O instalador inclui o npm.
2. Abra esta pasta no terminal. No Windows, abra a pasta no Explorador, clique na barra de endereço, digite `powershell` e pressione Enter.
3. Confira a instalação:

   ```powershell
   node --version
   npm --version
   ```

4. Instale as dependências:

   ```powershell
   npm ci
   ```

5. Inicie o site:

   ```powershell
   npm run dev
   ```

6. Abra o endereço mostrado pelo terminal, normalmente http://localhost:3000. Deixe o terminal aberto enquanto usa a prévia. Para encerrar, pressione Ctrl+C.

Para ativar o RSVP, configure `.env.local` conforme [FASE-2.md](FASE-2.md).

## Conferir a versão de produção

```powershell
npm run lint
npm run build
npm start
```

Pare o servidor de desenvolvimento antes de iniciar a versão de produção na mesma porta. `npm run build` inclui a validação TypeScript. O comando `npm run typecheck` também está disponível após a primeira execução do projeto.

## Fotografias e identidade

Os arquivos nas pastas originais do OneDrive e Downloads não foram modificados. O projeto usa cópias das fotografias. O Next.js pode gerar versões menores para o navegador em seu próprio cache, sem sobrescrever as fotos.

- `public/images/casal`: fotografias selecionadas do ensaio de Raquel Reis.
- `public/images/papelaria`: ornamentos originais fornecidos pelo casal.
- `public/images/decoracao`: reservado para futuras referências de decoração.
- `src/content/story.json`: transcrição integral da história fornecida.
- `src/components`: navegação, contagem regressiva e fotografias reutilizáveis.
- `src/app`: página, estrutura global e estilos.

O PDF do envelope, o convite completo e o save the date serviram de referência, mas não são publicados como imagens no site. Assim, informações desatualizadas ou reservadas desses materiais não são reproduzidas publicamente. O pedido escrito é a fonte para recepção às 13h, cerimônia às 16h e a ordem “Paula & Erik”.

Veja `IDENTIDADE-VISUAL.md` para a análise e a seleção de imagens.

## Próximas fases

1. **Fase 1 — identidade e conteúdo público:** implementada nesta entrega.
2. **Fase 2 — Supabase e RSVP fechado:** implementada e testada localmente; veja [FASE-2.md](FASE-2.md) para ativação.
3. **Fase 3 — presentes:** cadastrar os 40 itens, PIX com validação BR Code, links externos e registro de intenção sem confirmação bancária automática.
4. **Fase 4 — administração:** Supabase Auth, painel protegido, dashboard e formulários de convidados, convites, presentes e RSVP.
5. **Fase 5 — conteúdo:** gerenciamento de fotos, pessoas especiais, música opcional, textos e configurações.
6. **Fase 6 — validação e publicação:** testes completos de segurança e acessibilidade, publicação na Vercel e domínio próprio.

O painel não existe nesta fase. As tarefas comuns passarão a ser feitas por formulários administrativos nas fases 4 e 5. O casal não precisará editar JSON, SQL ou código para administrar o site final.

## Configuração do Supabase

Veja [FASE-2.md](FASE-2.md) para variáveis, migration, convites DEMO, testes e pendências. A publicação na Vercel e o domínio próprio permanecem para a fase de publicação.
