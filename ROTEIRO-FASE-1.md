# Roteiro da fase 1

Sequência exata para a primeira rodada real, na máquina do cliente. O objetivo
não é "funcionar": é **sair com números medidos** que hoje são chute.

Leva de 40 min a 1h30, dependendo de quanto a Shopee reclamar.

---

## Antes de começar

| Pré-requisito | Como conferir |
|---|---|
| AdsPower **plano pago**, instalado e logado | `curl http://local.adspower.net:50325/api/v1/user/list?page=1\&page_size=1 -H "Authorization: Bearer $CHAVE"` responde lista, não "paid subscriptions" |
| Node 20+ | `node -v` |
| Planilha de controle acessível | caminho completo em mãos |
| App da Shopify criado, com Client ID e Secret | — |
| Perfis logados na Shopee e **sem deslogar** | abrir 3 na mão e ver se caem direto em "Minhas Compras" |

Se o AdsPower for plano free, **pare aqui**. Teto diário de aberturas e
ausência de `user/list` impedem a fase 1.

---

## 1. Instalar

```bash
git clone <repo> shopee-tracking-bot
cd shopee-tracking-bot
npm install --omit=optional     # fase 1 não usa banco; pula o módulo nativo
npm test                        # tem que passar antes de tocar em conta real
```

## 2. Configurar

```bash
cp .env.example .env
```

No `.env`:

```
ADSPOWER_API_KEY=            # AdsPower → Configurações → API
SHOPIFY_LOJA=loja.myshopify.com
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
PLANILHA=C:\caminho\PEDIDOS SHOPEE.xlsx
PLANILHA_ABA=ESPARTA
CONCORRENCIA=3               # 3 em 16 GB de RAM, 6 em 32 GB
ARMAZENAMENTO=json
NOTIFICAR_CLIENTE=0          # 0 na primeira rodada: ninguém recebe e-mail
```

## 3. Ensaio sem tocar em nada

```bash
node -e 'import("./src/planilha.mjs").then(async m=>{
  const r=await m.lerPendentes(process.env.PLANILHA,{aba:process.env.PLANILHA_ABA});
  console.log(r.total,"linhas |",r.pendentes.length,"pendentes |",r.contas.length,"contas |",r.ignorados.length,"ignorados");
})'
```

**Anotar:** linhas, pendentes, contas, ignorados.

> Se "contas" vier muito acima de ~80, a planilha tem pendência velha
> acumulada. Decidir com o cliente se a primeira rodada cobre tudo ou só os
> últimos dias — abrir 300 contas de uma vez é pedir bloqueio.

## 4. Rodada seca — lê a Shopee, **não** escreve na Shopify

```bash
npm run dry 2>&1 | tee rodada-1-seca.log
```

**Medir, do log:**

| Número | Onde | Esperado |
|---|---|---|
| contas-alvo | linha "contas a abrir" | ~80 |
| contas coletadas | linha "fim · X/Y contas" | ≥ 90% |
| tempo total | linha "fim" | ~16 min para 80 contas, 4 em paralelo |
| pedidos lidos | linha "fim · N pedidos" | próximo dos pendentes da planilha |
| contas que falharam | bloco de falhas | — |
| contas que pediram login/verificação | buscar "verificação" e "login" no log | **este é o número que ninguém sabe** |

## 5. Conferir o casamento antes de escrever

```bash
node -e 'import("./src/estado.mjs").then(e=>{
  const p=Object.values(e.carregar());
  console.log("lidos:",p.length,"| despachados:",p.filter(x=>x.despachado).length,
              "| em revisão:",p.filter(x=>x.revisao).length);
  for(const x of p.filter(y=>y.revisao).slice(0,10))
    console.log("  revisão:",x.nome,"|",x.revisao.motivo);
})'
```

**Abrir 5 pedidos na mão** e conferir nome, CEP e rastreio contra a Shopee.
Qualquer divergência: **parar e me chamar**. Não siga para o passo 6.

## 6. Escrever de verdade — começando por 2

Primeiro dois pedidos, conferidos um a um no admin da Shopify:

```bash
node --env-file=.env run-final.mjs --escrever 2>&1 | tee rodada-1-escrita.log
```

Abrir os pedidos no admin. O rastreio tem que ser **o mesmo** que está na tela
da Shopee, no pedido **daquele** cliente.

## 7. Planilha de saída

```bash
npm run planilha
```

Abrir o `.xlsx` em `saida/` e comparar com a planilha de controle.

## 8. Painel

```bash
npm start
```

`http://127.0.0.1:4000` — conferir que a fila de revisão lista o que o passo 5
mostrou, com o mesmo motivo.

---

## O que fecha a fase

- [ ] ≥ 90% das contas-alvo coletadas
- [ ] **zero** pedidos escritos no cliente errado (conferido na mão)
- [ ] tempo por rodada registrado
- [ ] taxa de captcha medida
- [ ] nº de contas que pediram login medido
- [ ] planilha de saída confere com a de controle
- [ ] painel mostra a fila de revisão com motivo

## Quando parar e chamar

- Rastreio no pedido errado — **para tudo**
- Mais de 30% das contas falhando
- Shopee pedindo verificação em mais de 1 conta a cada 5
- Qualquer conta bloqueada

## Dados que saem daqui e mudam o projeto

1. **Taxa de captcha real** — decide se a fila humana é detalhe ou gargalo
2. **Quantas contas pedem login** — dimensiona o módulo de OTP
3. **Tempo por conta** — define concorrência e horários
4. **Pendências sem conta reconhecível** — tamanho do trabalho manual que sobra
