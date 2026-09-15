# Pendências

Este arquivo registra trabalho aberto sem autorizar automaticamente novas fases. Confirme o escopo com o casal antes de implementar pagamentos, administração, mudanças de conteúdo ou operações no banco remoto.

## Prioridade alta

- **Transferência de ambiente:** confirmar que o clone no novo computador aponta para o repositório e branch corretos, instalar dependências e recriar `.env.local` por canal seguro.
- **Estado remoto:** conferir no painel do Supabase quais migrations foram aplicadas e se a Vercel usa as variáveis corretas. A documentação antiga diz que não havia produção, mas a conversa registra testes posteriores no site publicado.
- **Backup:** antes de alterações em dados reais, exportar/confirmar backup do Supabase e nunca executar `db reset` no projeto remoto.
- **Regressão do RSVP:** repetir em produção os testes de código com caixa variada, slug direto, convite inativo, sessão válida, telefone individual, reabertura e edição. Não registrar os códigos usados.
- **Privacidade:** manter teste que garante ausência de local, endereço, cerimônia, estacionamento e valet no HTML público.

## Interface e conteúdo

- Confirmar com o casal se a orientação “chegar com 15 minutos de antecedência” deve aparecer na Home ou apenas no convite privado. Existe estilo `.arrival-note`, mas o texto não está renderizado atualmente.
- Revisar a seção “Pessoas especiais” e confirmar nomes finais antes da divulgação.
- Fazer nova revisão editorial do texto integral e dos textos curtos, preservando o relato sensível sobre o acidente.
- Testar novamente a Home em 375, 390, 430, 768, 1024 e 1440 px, principalmente a sequência completa da história e os rostos nos crops.

## Presentes

- Após confirmar o projeto remoto e o backup, aplicar a migration `202609140001_gifts_catalog.sql` sem executar o seed de desenvolvimento em produção.
- Definir valores e itens finais do catálogo comum.
- Cadastrar o catálogo definitivo no Supabase; o arquivo `supabase/seeds/gifts-development.sql` contém apenas os itens provisórios usados em desenvolvimento.
- Definir PIX real, recebedor, confirmação e eventual link externo parcelado. Nenhum dado financeiro deve ser inventado ou commitado.
- Definir comportamento dos botões “CONTRIBUIR” da seção Insanos.
- Implementar controle contra dupla escolha/compra somente após decidir a regra de negócio.
- Avaliar otimização das imagens das moedas: os arquivos ativos são grandes e usam `unoptimized`. Preservar qualidade, transparência e aparência ao otimizar.
- Remover versões antigas e duplicadas de moedas em `public/images/presentes` depois de confirmar que nenhuma referência externa depende delas.
- Finalizar a validação visual do background Insanos em 390, 430, 768, 820, 1024, 1180, 1280 e 1440 px. A regra intermediária foi ajustada para `cover`, posição `58% center`, overlay gradual e margens menores, mas a rodada completa de capturas exatas ainda deve ser concluída.
- Confirmar que, em todas as larguras, “Gratidão, irmãos!” vem depois do texto introdutório e antes dos cards.

## Administração e conteúdo futuro

- Criar autenticação administrativa separada das sessões de convite.
- Criar painel protegido para grupos, convidados, RSVP, detalhes do evento e presentes.
- Definir perfis e permissões administrativas antes de conceder acesso a usuários autenticados. Hoje `anon` e `authenticated` permanecem sem acesso às tabelas privadas.
- Decidir se fotos, textos e pessoas especiais serão gerenciáveis pelo painel ou continuarão versionados.

## Qualidade, segurança e publicação

- Auditoria final de acessibilidade: teclado, foco, contraste, leitor de tela, zoom e redução de movimento.
- Medir Core Web Vitals e peso de imagens em produção.
- Revisar compatibilidade em Safari/iOS e Chrome/Android.
- Confirmar headers, cookies seguros, `APP_ORIGIN`, rate limiting e logs sem dados pessoais na Vercel.
- Desligar `INVITATION_ACCESS_DEBUG` quando o diagnóstico não for necessário.
- Avaliar política de retenção e exclusão dos dados de RSVP após o evento.
- Definir domínio final, analytics consentidos e política de privacidade, se aplicáveis.

## Dívida de documentação e CSS

- Atualizar ou arquivar `README.md`, `FASE-2.md`, `IDENTIDADE-VISUAL.md`, `AJUSTES-VISUAIS.md` e `VALIDACAO-FASE-1.md` na raiz. Eles descrevem estados anteriores, inclusive ausência de Supabase/produção e uso antigo de `pe-33.jpg` no encerramento.
- Consolidar `src/app/globals.css`: há camadas sucessivas de correções e alguns seletores antigos são sobrescritos mais abaixo. Refatorar somente com comparação visual completa.
- Rever o caráter Unicode da seta final “Voltar ao início” apenas se houver novo pedido; as demais ações usam SVGs.

## Checklist antes de uma nova entrega

- [ ] `git status` contém apenas mudanças intencionais.
- [ ] Nenhum `.env`, token, chave, código ou slug real foi adicionado.
- [ ] `npm test` passou.
- [ ] `npm run lint` passou.
- [ ] `npm run typecheck` passou.
- [ ] `npm run build` passou.
- [ ] Rotas públicas não contêm detalhes privados.
- [ ] Fluxos por código e slug continuam funcionando.
- [ ] Home e presentes foram revisados nos breakpoints afetados.
- [ ] Documentação foi atualizada com decisões novas.
