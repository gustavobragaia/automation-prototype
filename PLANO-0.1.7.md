# Plano da 0.1.7

Feedback do Matheus depois da 0.1.6 (21/10/2026). Nada disto está no `main`.
O rascunho está no branch `rascunho-0.1.7`: passa a suíte atual (0 falhas),
mas tem os furos marcados abaixo, que a suíte não cobre.

Cada item só entra com: teste automático, prova de que o teste falha sem a
correção, ensaio na janela quando for tela, e teste ao vivo quando tocar a
Shopee ou a caixa de e-mail.

---

## Revisão de 21/10: o que foi testado

| Suposição do plano | Como foi conferida | Resultado |
|---|---|---|
| O e-mail estava na caixa e o robô o descartou | Caixa da conta 167, logo depois do aviso dele às 16:04 | **Confirmado.** O link chegou às **16:01:38**, e o robô desistiu às 16:04 dizendo que não chegou |
| A causa é o filtro de horário (relógio do Windows) | Pelo item acima, com a lista de horários | **Muito provável, não provado.** Basta o relógio dele estar uns 15 a 20 s adiantado. O diagnóstico do item 2.4 prova na próxima vez |
| Histórico só atualiza fechando o app | Reproduzido na janela do app (escrita nova com o dia aberto) | **Confirmado, causa achada:** a lista recarrega, mas o **dia aberto** continua com os dados antigos |
| Abrir com `ip_tab: 1` cria a aba "Shopee N" | Ao vivo na conta 124 | **Confirmado** |
| Dá para mostrar o progresso da escrita | Leitura do código da escrita | **Confirmado.** A escrita manda um pedido por vez; basta avisar a tela a cada um |
| O rascunho não quebra nada | Suíte inteira contra o branch | **0 falhas**, mas os furos 2.A e 2.B abaixo não são cobertos pela suíte |

### Furos achados na revisão

- **2.A, também na 0.1.6:** o robô pega o e-mail da Shopee mais novo e, se ele
  não tiver o link, **desiste na hora** ("chegou mas não achei o link"). Só que
  a Shopee manda outros e-mails sem link no meio do processo. Na conta 167
  chegou "Alerta de Segurança: Novo login" às 16:05, e antes, na 120, "falha em
  tentativa de login". **Correção:** olhar todos os e-mails novos da Shopee,
  pular os que não têm o link e continuar esperando.
- **2.B, no rascunho:** a espera nova (10 s + 180 s = 190 s) passa do prazo
  que a fila dá a cada passo do login (180 s). A fila fecharia a janela 10 s
  antes de o e-mail poder chegar, e com o "Reenviar" seria pior. **Correção:**
  o coletor renova o prazo a cada consulta à caixa, em vez de só a cada passo.
- **2.C, no rascunho:** a "foto da caixa" é tirada duas vezes (antes do
  "Entrar" e antes do clique em verificar), e cada uma custa 2 consultas. Um
  login normal passaria de 5 para 7 consultas. **Correção:** uma foto só, antes
  do "Entrar". O e-mail de verificação sempre vem depois dela.
- **5.A, novo:** o detalhe de um dia que só tem escritas mostra
  "**null contas visitadas em null, null já estavam conectadas.**"
- **6.A, novo:** o log da escrita traz o **nome do cliente**
  (`#164902 · José … · BR…`). O log em arquivo e o "Exportar diagnóstico"
  precisam tirar os nomes, e as coletas (com nome, endereço e telefone dos
  clientes) não podem entrar no .zip.

### O que ainda não dá para conferir sem rodar ao vivo

- o botão **"Reenviar"** da página `/verify/email-link`: o texto exato e
  qual elemento é clicável (lição da 120: o clique na `div` de fora não
  funciona);
- o ritmo real da Shopee: quanto tempo o link leva para chegar no pior caso.

---

## 1. Saber qual janela é qual conta

**Problema:** quando aparece "a conta 139 está esperando você", nada na
janela diz qual conta é.

**Plano:**
- abrir o perfil com `ip_tab: 1` e não fechar a aba `start.adspower.net`
  ("Shopee 139");
- pôr "Conta 139 · " no começo do título da aba da Shopee. O título da aba
  ativa vira o nome da janela: aparece na barra de tarefas e no Alt+Tab;
- **acrescentado na revisão:** quando a conta pedir uma pessoa, a extensão
  **traz a janela dela para a frente** e pisca na barra de tarefas
  (`chrome.windows.update` com `focused` e `drawAttention`). Assim ninguém
  precisa procurar;
- **acrescentado na revisão:** o alerta diz "procure a janela **Conta 139**".

**Testes:** automático para o título e para a aba que fica; ao vivo para a
janela vindo para a frente.

---

## 2. E-mail que chegou mas o app disse que não

**Problema:** conta 167, confirmado acima.

**Plano:**
1. **Sem relógio:** uma foto da caixa antes do "Entrar" (furo 2.C) e aceitar
   qualquer e-mail **novo** da Shopee.
2. **Pular o e-mail errado:** olhar todos os e-mails novos e usar o que tem o
   link ou o código. Os outros ("Novo login", "falha em tentativa") são
   ignorados e a espera continua (furo 2.A).
3. **Espera maior, mesmo custo:** até 3 min, a cada 10 s no 1º minuto e a cada
   20 s depois. São no máximo 13 consultas.
4. **Reenviar:** se nada chegar, clicar uma vez em "Reenviar" e esperar de
   novo. Primeiro, observar o botão ao vivo.
5. **Dizer o porquê:** se falhar, o alerta diz quantos e-mails havia na caixa
   e se o relógio do computador está adiantado, comparando com a hora do
   servidor da caixa.
6. **Prazo da fila:** renovado a cada consulta à caixa (furo 2.B).

**Consumo:** normal 5 consultas por login (igual hoje); pior caso, com
reenvio, cerca de 30.

**Testes:**
- e-mail real da Shopee (cópia limpa, sem tokens) com relógio 2 min adiantado;
  com o código da 0.1.6 tem que falhar, como na 167;
- "Novo login" chegando antes do e-mail certo: pula e acha o certo;
- e-mail chegando aos 150 s;
- e-mail que nunca chega: mensagem de erro e no máximo 13 consultas;
- fila: não fecha a janela durante uma espera de 6 min (com reenvio);
- "Reenviar" no `login.js`;
- ao vivo: numa conta com sessão caída, com o relógio do Mac adiantado de
  propósito em 1 min.

**Depende de:** chave da RapidAPI com cota. A grátis de teste tem 9 consultas,
o que dá um teste ao vivo. Para a rodada inteira, só o plano Pro.

---

## 3. Progresso na coleta (etapa 2)

**Plano:** painel no topo da etapa 2 com barra e contagem ao vivo: "18 de 33
contas lidas · 2 falharam · 1 tentando de novo · 1 esperando você". Clicar
em cada número filtra a tabela. Conta pelo **estado atual** de cada conta: uma
que saiu de "esperando você" e foi lida conta como lida, não nos dois.

**Testes:** ensaio na janela com a sequência real de eventos de uma rodada
(inclui conta que repete e conta que espera uma pessoa e depois é lida).

---

## 4. Etapa 4 (Escrita na Shopify): ver todos e progresso

**Plano:**
- "e mais N pedidos" vira **"Ver todos os N"**, que abre a lista inteira;
- durante a escrita, duas fases na tela: **"Conferindo os pedidos na
  Shopify…"** (a busca dos números) e **"Escrevendo 8 de 40…"** com barra. O
  botão fica travado;
- no fim, o resumo fica na tela, e não só na notificação: escritos,
  recusados pela Shopify e o que foi para a etapa 3.

**Testes:** ensaio na janela com 40 pedidos e escrita simulada, sem tocar a
Shopify de verdade.

---

## 5. Histórico que só atualiza fechando o app

**Causa (confirmada):** ao recarregar, só a lista de dias é redesenhada. O
dia aberto continua apontando para os dados antigos.

**Plano:**
1. ao recarregar, reabrir o dia que estava aberto com os dados novos;
2. recarregar quando a aba Histórico for aberta e depois de toda escrita
   (manual, em lote ou direto na rodada);
3. corrigir o "null contas visitadas…" (5.A): dia sem rodada não mostra essa
   linha.

**Testes:** a reprodução vira ensaio. Ele falha hoje (dia aberto com 1 pedido
quando já são 2) e tem que passar depois.

---

## 6. Avisos que somem e nada para conferir depois

**Plano:**
1. **Resolvidos nos últimos 7 dias** no painel do sino, com o texto
   original, a conta e a hora. Saem do contador, mas não somem;
2. **log em arquivo** por dia, guardando 14 dias, **sem nome de cliente**
   (6.A): o pedido aparece só pelo número;
3. **"Exportar diagnóstico"** em Ajustes: log, alertas e o **resumo** das
   coletas das contas que falharam (status de cada consulta, sem os pedidos).
   Sem senha, sem chave e sem nome, endereço ou telefone de cliente.

**Testes:** alerta resolvido continua em "Resolvidos"; o log sobrevive a
fechar e abrir o app; o .zip não contém a senha, nenhuma das chaves, nem
nenhum nome de cliente das coletas de teste.

---

## Ordem sugerida

1. **Item 2** (é o que trava contas hoje) e o furo 2.A, que já afeta a 0.1.6;
2. **item 5** (causa já achada, rápido);
3. **item 1** (quase pronto);
4. **itens 3 e 4** (tela);
5. **item 6**.

## Antes de publicar

- suíte inteira (`npm test`) e ensaios de janela (`npm run ensaios`);
- teste ao vivo: identificação nas abas e janela vindo para a frente,
  verificação por e-mail numa conta caída (com relógio adiantado), e o retry;
- chave da RapidAPI Pro ativa no app do Matheus;
- versão 0.1.7, CI do Windows, DMG, release e conferir o feed de atualização.
