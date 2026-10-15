# Fases

Cada fase elimina **um risco específico** e termina com algo que dá para abrir,
rodar e conferir. Fase não fecha por tempo gasto: fecha quando o critério de
aceite é demonstrado.

A ordem é por risco, do mais barato de descobrir ao mais caro de corrigir.

---

## Fase 1 — Funciona na operação real

**Risco que mata:** o fluxo inteiro funciona contra as contas de verdade, na
máquina de verdade, no volume de verdade? Tudo até aqui foi medido com 1 conta
e 1 pedido.

**Entregáveis**

| # | Entregável | Como revisar |
|---|---|---|
| 1.1 | Leitura da planilha de controle: pedidos sem rastreio e a conta de cada um | rodar e ver a lista de contas-alvo impressa |
| 1.2 | Rodada mirada: abre só as contas do dia, não as 700 | log mostra "80 contas" e não "700" |
| 1.3 | Rastreio escrito na Shopify pela API | abrir 3 pedidos no admin e ver o código |
| 1.4 | Planilha de saída no formato atual | abrir o .xlsx gerado |
| 1.5 | Fila de revisão com motivo por pedido | painel em localhost:4000 |
| 1.6 | Relatório da rodada: contas, tempo, captcha, falhas | saída do comando |

**Critério de aceite** — uma rodada real na máquina do cliente, com o plano pago
do AdsPower, produzindo:

- ≥ 90% das contas-alvo coletadas
- **zero** pedidos escritos no cliente errado
- tempo total registrado (esperado ~16 min para 80 contas com 4 em paralelo)
- taxa de captcha medida — hoje é chute
- quantas contas pediram login/verificação

**Não entra:** Electron, banco de dados, Drive, atualização automática, tela
bonita. Armazenamento é JSON.

**Estado:** falta a máquina do cliente. Tudo o mais está escrito e testado.

---

## Fase 2 — Qualquer pessoa opera

**Risco que mata:** alguém que não é desenvolvedor consegue usar isso todo dia,
sem terminal e sem o Gustavo por perto?

**Entregáveis**

| # | Entregável | Como revisar |
|---|---|---|
| 2.1 | Aplicativo instalável (.exe), abre com duplo clique | instalar numa máquina limpa |
| 2.2 | Painel dentro do app, sem navegador | abrir o app |
| 2.3 | Tela de configuração: AdsPower, Shopify, planilha, concorrência | preencher do zero numa máquina nova |
| 2.4 | Agendador visível: horários, próxima rodada, botão de rodar agora | esperar um horário passar |
| 2.5 | Ícone na bandeja com selo quando há pendência | deixar um pedido em revisão |
| 2.6 | Inicia junto com o Windows | reiniciar a máquina |

**Critério de aceite:** a funcionária do cliente opera **um dia inteiro sozinha**,
sem ninguém do nosso lado, e o relatório do dia bate com o que ela fez.

**Não entra:** banco, Drive, atualização automática. Ainda JSON.

---

## Fase 3 — Aguenta o tempo

**Risco que mata:** meses depois, com dezenas de milhares de pedidos e
atualizações chegando sozinhas, os dados continuam íntegros?

**Entregáveis**

| # | Entregável | Como revisar |
|---|---|---|
| 3.1 | `ARMAZENAMENTO=sqlite` com migração do JSON existente | rodar o migrador e comparar as contagens |
| 3.2 | Migração versionada com backup e recusa de boot em falha | `scripts/testar-migracao` com migração quebrada de propósito |
| 3.3 | Backup diário para o Drive | ver o arquivo do dia na pasta |
| 3.4 | Restauração a partir de um backup | apagar o banco, restaurar, conferir o histórico |
| 3.5 | Atualização automática com canal beta e estável | publicar uma tag e ver o app oferecer |
| 3.6 | Atualização só instala com a fila parada | disparar com rodada em andamento |

**Critério de aceite:** uma atualização publicada por tag chega sozinha na
máquina do cliente, migra o banco e **não perde um pedido** — comprovado
comparando as contagens antes e depois.

**Estado:** 3.1 e 3.2 já escritos e testados (contrato idêntico entre json e
sqlite, migração quebrada restaura e recusa iniciar).

---

## Fase 4 — Sem planilha

**Risco que mata:** a funcionária adota o app no lugar da planilha? É risco de
hábito, não de software — por isso vem por último, quando o resto já é confiável.

**Entregáveis**

| # | Entregável | Como revisar |
|---|---|---|
| 4.1 | Tela "pedidos do dia", puxando da Shopify | abrir de manhã e comparar com o export manual |
| 4.2 | A cada pedido pago, ela escolhe a conta no app | usar por um dia |
| 4.3 | Medidor de cobertura do mapeamento | tela mostra "78% vem do banco" |
| 4.4 | Planilha vira saída: o robô preenche a coluna da conta | abrir a planilha e ver preenchido |

**Critério de aceite:** uma semana em que a cobertura fica em ~100% e ninguém
abre a planilha para escrever — só para conferir.

**Ganho extra:** some também o export manual da manhã e o prompt de IA que gera
a planilha do dia.

---

## O que mantém as fases independentes

A aplicação nunca importa `json.mjs` nem `sqlite.mjs` direto: importa
`src/armazenamento/`, e a escolha é `ARMAZENAMENTO=json|sqlite`. Os dois
cumprem o mesmo contrato, provado por `npm run contrato`.

Por isso a fase 3 é uma troca de variável, não uma reescrita — e a fase 1 roda
sem nenhuma dependência nativa instalada.
