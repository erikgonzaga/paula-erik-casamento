# Pendências

Este arquivo registra trabalho aberto sem autorizar automaticamente novas fases. Confirme o escopo com o casal antes de implementar pagamentos, administração, mudanças de conteúdo ou operações no banco remoto.

## Prioridade alta

- **Transferência de ambiente:** confirmar que o clone no novo computador aponta para o repositório e branch corretos, instalar dependências e recriar `.env.local` por canal seguro.
- **Estado remoto:** conferir no painel do Supabase quais migrations foram aplicadas e se a Vercel usa as variáveis corretas. A documentação antiga diz que não havia produção, mas a conversa registra testes posteriores no site publicado.
- **Backup:** antes de alterações em dados reais, exportar/confirmar backup do Supabase e nunca executar `db reset` no projeto remoto.
- **Regressão do RSVP:** repetir em produção os testes de código com caixa variada, slug direto, convite inativo, sessão válida, telefone individual, reabertura e edição. Não registrar os códigos usados.
- **Privacidade:** manter teste que garante ausência de local, endereço, cerimônia, estacionamento e valet no HTML público.

## Interface e conteúdo

- Revisão visual pelo casal da nova página `/nos` e do CTA dentro de “Eu escolhi você” na Home. Curadoria e implementação descritas em [Nós](NOS.md); sem publicação nesta etapa.

- Confirmar com o casal se a orientação “chegar com 15 minutos de antecedência” deve aparecer na Home ou apenas no convite privado. Existe estilo `.arrival-note`, mas o texto não está renderizado atualmente.
- Revisar a seção “Pessoas especiais” e confirmar nomes finais antes da divulgação.
- Fazer nova revisão editorial do texto integral e dos textos curtos, preservando o relato sensível sobre o acidente.
- Testar novamente a Home em 375, 390, 430, 768, 1024 e 1440 px, principalmente a sequência completa da história e os rostos nos crops.

## Presentes

- As migrations `202609140001_gifts_catalog.sql`, `202609150001_gifts_party_category.sql` e `202609170001_gift_funding.sql` foram informadas pelo casal como aplicadas em produção. São históricas e não devem ser editadas.
- Catálogo de 38 registros já cadastrado no Supabase, conforme informado pelo casal; não executar novamente nem usar seed fictício nesta etapa. Progresso real implementado via RPC agregada, com meta alcançada e texto de Gramado no filtro Viagem.
- Imagens definitivas dos 35 presentes regulares recebidas e associadas por slug. Manter a validação visual dos cards e modais em 375, 390, 430, 768, 1024, 1280 e 1440 px. Ver `CATALOGO-DEFINITIVO.md`.
- A integração Pix Mercado Pago via Orders API está em teste local. O casal confirmou no schema remoto os objetos das migrations `202609220001` e `202609220002`, executadas manualmente e ainda ausentes do histórico de migrations. Não reexecutá-las nesta etapa. A criação de Order Pix TEST funcionou; notificações automáticas e o simulador retornam `SignatureMismatch`/401 no webhook. Investigar sem enfraquecer a assinatura antes da homologação.
- Configurar por canal seguro `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_APPLICATION_ID`, `MERCADO_PAGO_USER_ID` e manter `PAYMENTS_ENVIRONMENT=test` durante a homologação. Nunca commitar valores.
- Cadastrar no Mercado Pago a URL HTTPS `/api/payments/mercado-pago/webhook`, selecionar eventos de Orders e validar assinatura, aprovação, expiração, retry e conciliação no ambiente de teste.
- Antes da produção, testar concorrência real para metas e presentes únicos, confirmar a conta recebedora, revisar logs/alertas e definir estorno, chargeback, pagamento tardio e indisponibilidade do provedor. A troca para `PAYMENTS_ENVIRONMENT=production` exige decisão explícita do casal.
- O histórico remoto de migrations foi confirmado pelo casal até `202609170003_fix_gift_contribution_expiry.sql`; as versões posteriores foram executadas manualmente e ainda exigem reconciliação de histórico em etapa separada.
- A migration de pagamentos permite que Pix emitidos antes de a meta ser atingida sejam confirmados integralmente, mesmo acima dela; somente `confirmed` entra no progresso público. A reserva privada permanece para presentes únicos. Ver `PRESENTES-CONTRIBUICOES.md`.
- Avaliar otimização das imagens das moedas: os arquivos ativos são grandes e usam `unoptimized`. Preservar qualidade, transparência e aparência ao otimizar.
- Remover versões antigas e duplicadas de moedas em `public/images/presentes` depois de confirmar que nenhuma referência externa depende delas.
- Finalizar a validação visual do background Insanos em 390, 430, 768, 820, 1024, 1180, 1280 e 1440 px. A regra intermediária foi ajustada para `cover`, posição `58% center`, overlay gradual e margens menores, mas a rodada completa de capturas exatas ainda deve ser concluída.
- Confirmar que, em todas as larguras, “Gratidão, irmãos!” vem depois do texto introdutório e antes dos cards.

## Administração e conteúdo futuro

- Fundação administrativa implementada: Supabase Auth, autorização explícita, sessões revogáveis e dashboard somente leitura. Os objetos de `202609200001_admin_foundation.sql` foram confirmados no schema remoto após execução manual; a versão ainda não consta no histórico de migrations. Ver [Administração](ADMINISTRACAO.md).
- Configurar Auth e criar/vincular o primeiro administrador conforme o guia, se ainda pendente.
- Validar Auth real em Supabase de desenvolvimento antes de publicar. O teste local usa Auth sintético e SQL real em memória.
- CRUD, recuperação de senha, MFA e demais áreas administrativas ficam para uma fase futura autorizada. `anon` e `authenticated` continuam sem acesso às tabelas privadas.
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
