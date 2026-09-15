<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Paula & Erik — guia para agentes

Este repositório é o site do casamento de Paula e Erik. Antes de alterar código, conteúdo, banco ou assets, leia nesta ordem:

1. [`docs/CONTEXTO-CASAMENTO.md`](docs/CONTEXTO-CASAMENTO.md) — decisões do casal, histórico das fases, privacidade e limites de escopo.
2. [`docs/IDENTIDADE-VISUAL.md`](docs/IDENTIDADE-VISUAL.md) — marca, paleta, tipografia, fotografia, assets e comportamento responsivo aprovado.
3. [`docs/ESTRUTURA-SITE.md`](docs/ESTRUTURA-SITE.md) — rotas, componentes, dados, Supabase, testes e fluxo técnico.
4. [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md) — trabalho ainda aberto, validações necessárias e documentação antiga a reconciliar.

## Regras permanentes

- Trate o código atual e os documentos em `docs/` como fonte principal. `README.md`, `FASE-2.md`, `IDENTIDADE-VISUAL.md`, `AJUSTES-VISUAIS.md` e `VALIDACAO-FASE-1.md` na raiz registram etapas anteriores e contêm trechos desatualizados.
- Preserve a identidade editorial, romântica, botânica e terrosa. Faça mudanças pontuais; não redesenhe páginas aprovadas sem pedido explícito.
- Use o arquivo `public/images/papelaria/Logo.png` como marca oficial por meio de `WeddingLogo`. Não recrie a marca com texto HTML, não recoloque filtros e não corte a imagem.
- Preserve os arquivos originais fornecidos. Enquadramentos devem ser feitos com CSS/`object-position`; não sobrescreva originais fora do repositório.
- O nome do local, endereço, horário privado, estacionamento e valet só podem sair do servidor depois de uma sessão de convite válida. Não os coloque na Home, metadata, JSON-LD, atributos ocultos, bundle público, fixtures expostas ou documentação pública.
- Códigos e slugs de convites são credenciais. Nunca os registre em documentação, logs, issues ou respostas, mesmo quando aparecerem em testes manuais.
- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY`, `INVITATION_SESSION_SECRET` ou qualquer valor de `.env`. A chave `service_role` permanece exclusivamente no servidor.
- Não enfraqueça RLS, a validação do grupo, a sessão assinada, o rate limiting ou o bloqueio de cadastro livre de convidados.
- A migration `202609110001_closed_rsvp.sql` já é histórica e não deve ser editada. Mudanças de banco entram em nova migration versionada.
- Preserve o fluxo por slug quando corrigir o fluxo por código e vice-versa. O código é normalizado na ordem `trim` → `uppercase` → validação → consulta.
- Telefone é individual em `guests`: obrigatório para adultos no RSVP e ausente para crianças. Restrições alimentares e observações continuam no RSVP do grupo.
- Setas de interface usam componentes SVG de `src/components/icons.tsx`. Não use emoji ou caracteres Unicode para novas setas. A seta final “Voltar ao início” foi mantida por decisão anterior e pode ser tratada separadamente apenas se solicitado.
- Na seção “Presentes Insanos”, mantenha uma única estrutura DOM e a ordem semântica: título, introdução, “Gratidão, irmãos!”, cards, símbolo da moto e frase final.
- Presentes continuam sem pagamento real. Não invente PIX, links de pagamento, estoque ou confirmação de compra.

## Fluxo de trabalho

- Confira `git status` antes de começar e não descarte mudanças do usuário.
- Para Next.js 16, consulte a documentação local indicada no bloco gerenciado acima antes de usar APIs que possam ter mudado.
- Execute as verificações proporcionais à alteração. Para mudanças completas: `npm test`, `npm run lint`, `npm run typecheck` e `npm run build`. Para o fluxo HTTP, use a fixture descrita em `docs/ESTRUTURA-SITE.md`.
- Valide visualmente alterações responsivas nos pontos relevantes. A referência recorrente é 375, 390, 430, 768, 820, 1024, 1180, 1280 e 1440 px.
- Atualize estes documentos quando uma decisão for aprovada, um asset ativo mudar, uma fase avançar ou uma pendência for concluída.
- Ao preparar outro computador, clone o Git, rode `npm ci` e recrie `.env.local` por canal seguro. Não copie perfis de navegador, `.next`, `node_modules`, caches ou arquivos temporários.
