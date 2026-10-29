<p align="center">
  <img src="marca/esteira-128.png" width="96" alt="Esteira">
</p>

<h1 align="center">Esteira</h1>

<p align="center">
  Lê o código de rastreio dos pedidos nas contas de comprador da Shopee e escreve na Shopify.<br>
  Sem copiar e colar, sem planilha de rastreio.
</p>

<p align="center">
  <img alt="versão" src="https://img.shields.io/badge/vers%C3%A3o-0.1.15-5b4bc4">
  <img alt="plataformas" src="https://img.shields.io/badge/Windows%20%7C%20macOS-Electron-5b4bc4">
  <img alt="testes" src="https://img.shields.io/badge/testes-912%20%2B%20157%20ensaios-2e7d32">
</p>

---

## O que é

A operação compra cada pedido da loja numa conta de comprador da Shopee (são
dezenas de contas, uma por perfil do [AdsPower](https://adspower.com)). Quando a
Shopee despacha, alguém precisava abrir conta por conta, copiar o rastreio e
colar no pedido certo da Shopify.

O Esteira faz esse caminho sozinho, na máquina do operador. Ele roda nos
mesmos perfis, com o mesmo IP e o mesmo fingerprint de sempre, então o
comportamento continua igual ao manual.

**Regra que guia tudo:** rastreio trocado é pior que rastreio ausente. Quando
há dúvida, o Esteira não escreve. Ele pergunta.

## Como funciona — as 4 etapas

```
 1. Planilha  →  2. Coleta na Shopee  →  3. Conferência  →  4. Escrita na Shopify
```

| Etapa | O que acontece |
|---|---|
| **1. Planilha** | O operador escolhe a planilha do dia (modelo em `modelo/planilha-modelo.xlsx`). O Esteira lê pedido, cliente, valor e em que conta Shopee cada um foi comprado. |
| **2. Coleta na Shopee** | Os perfis do AdsPower são abertos em fila. A extensão lê a lista de compras de cada conta e entrega ao coletor local. Se a sessão caiu, ela faz o login sozinha e resolve a verificação por e-mail pela caixa do inboxes.com. Conta com falha passageira volta para o fim da fila (até 3 tentativas). |
| **3. Conferência** | Cada pedido da planilha é cruzado com as compras daquela conta: nome, valor, CEP, pedido em várias compras, vários pedidos do mesmo cliente pareados pelo total. O que não dá para ter certeza vai para **"Precisa de você"**, com os candidatos lado a lado. |
| **4. Escrita na Shopify** | Os rastreios confirmados viram fulfillment na Shopify (`fulfillmentCreateV2`), uma vez por pedido, com o progresso ao vivo. Pedido já atendido ou com nome que não confere é barrado e explicado. |

O que fica pendente vai para a **carteira** e volta na próxima rodada. Avisos
que pedem ação ficam no **sino de alertas**: cota da RapidAPI, conta que
precisa de uma pessoa, contas que falharam (com "Tentar de novo só essas").

## Arquitetura

```
┌──────────────────────── máquina do operador ────────────────────────┐
│                                                                     │
│  Aplicativo (Electron)  ──IPC──  ponte.mjs  ──  src/ (núcleo)       │
│        │                                         │                  │
│        │                     coletor local (127.0.0.1) ◄── extensão │
│        │                                         ▲      (no perfil) │
│        └──── Local API ──►  AdsPower ──abre──► perfis Shopee        │
│                                                                     │
└──────────┬───────────────────────────┬──────────────────────────────┘
           │                           │
   inboxes.com (RapidAPI)       Shopify Admin API  ◄── OAuth via esteira.cloud
   e-mail de verificação        fulfillments          (Cloudflare Worker)
```

- **Nada roda em servidor**, só o retorno do OAuth da Shopify (`servidor/`).
  O worker troca o código pelo token e o entrega por POST ao aplicativo local,
  sem gravar nada.
- O estado (carteira, histórico, alertas, conexão, log diário) fica na pasta
  de dados do usuário do aplicativo. Os segredos (chave do AdsPower, senha das
  contas, chave da RapidAPI) ficam em Ajustes, num arquivo legível só pelo
  usuário da máquina, e nunca saem dela.

## Instalação (operador)

1. Baixe o instalador da última versão em
   [esteira-releases](https://github.com/gustavobragaia/esteira-releases/releases/latest):
   `.exe` no Windows, `.dmg` no macOS.
2. Abra o Esteira e siga o guia de primeiros passos. Ele cobre o AdsPower com
   a Local API ligada, o e-mail e a senha das contas, a chave da RapidAPI e a
   conexão com a loja.
3. Daí em diante as **atualizações são automáticas**. O aplicativo avisa
   quando há versão nova e instala ao reiniciar.

Detalhes em [`aplicativo/COMO-INSTALAR.txt`](aplicativo/COMO-INSTALAR.txt) e
[`INSTALACAO.md`](INSTALACAO.md).

### Ajustes

| Grupo | Campos |
|---|---|
| AdsPower | endereço da Local API e chave |
| Contas Shopee | começo do e-mail, domínio, "outro começo a partir de" (ex.: contas acima de 200 usam outro prefixo) e senha única |
| Caixa de e-mail | chave da RapidAPI (inboxes.com). O app avisa quando a cota está acabando. |
| Shopify | endereço da loja e conexão via OAuth (ou ID e chave secreta do app do cliente) |

## Desenvolvimento

Requisitos: Node 22+ e AdsPower instalado (para rodadas reais).

```bash
npm install && (cd aplicativo && npm install)
```

| Comando | O que faz |
|---|---|
| `npm test` | Todos os testes do núcleo (fila, login, caixa de e-mail, conciliação, pareamento, escrita, diagnóstico…), contra Shopee, Shopify e RapidAPI simuladas |
| `cd aplicativo && npm start` | Abre o aplicativo |
| `cd aplicativo && npm run ensaios` | Ensaios de janela: abrem o app de verdade e clicam pelas telas |
| `node scripts/ao-vivo.mjs <planilha.xlsx> [contas…]` | Rodada real **sem escrever nada**, nas contas pedidas. Gera uma planilha de resultado em `ao-vivo/`. `SO_PLANILHA=1` refaz só o cruzamento. |
| `npm run proof` | Parser de rastreio e casamento contra a base de pedidos, com relatório |
| `cd aplicativo && npm run empacotar` | Gera o `.dmg` do macOS |

Os testes usam situações reais das rodadas, como as mensagens de erro de
verdade e o e-mail da Shopee limpo. Dado de cliente real nunca entra num
fixture.

### Publicar uma versão

1. Suba a versão em `aplicativo/package.json` e em `COMO-INSTALAR.txt` e
   registre o porquê em `DECISOES.md`.
2. `git push`. Depois `gh workflow run windows.yml`, que gera o `.exe`.
   O NSIS às vezes cai com `0xC0000005`; nesse caso, `gh run rerun --failed`.
3. `cd aplicativo && npm run empacotar`, que gera o `.dmg`.
4. `gh release create vX.Y.Z` em `gustavobragaia/esteira-releases` com o
   `.exe`, `.blockmap`, `latest.yml`, `.dmg` e `COMO-INSTALAR.txt`.
5. Confira se o `latest.yml` publicado mostra a versão nova. É dele que a
   atualização automática lê.

## Estrutura

| Caminho | O que tem |
|---|---|
| `aplicativo/` | App Electron: `principal.mjs` (processo principal), `ponte.mjs` (IPC → núcleo), `tela/` (interface), `atualizacao.mjs`, ensaios de janela |
| `extensao/` | Extensão carregada em cada perfil: `login.js`, `coleta.js`, `ivs-escuta.js` (verificação de identidade), `background.js`, `ponte.js` |
| `src/fila.mjs` | Fila de contas: prazo, retry, uma tentativa de login por conta |
| `src/coletor.mjs` | Servidor local que recebe as coletas da extensão |
| `src/otp.mjs` | Caixa do inboxes.com: foto da caixa, espera do e-mail, extração do link ou código |
| `src/conciliar.mjs` | Cruzamento planilha × Shopee: valor, partes, pareamento pelo total, dúvidas |
| `src/escrita.mjs` · `src/shopify*.mjs` | Escrita na Shopify, OAuth e conexão |
| `src/alertas.mjs` · `src/log-diario.mjs` · `src/diagnostico.mjs` | Sino de alertas, log de 14 dias, "Exportar diagnóstico" sem segredos |
| `servidor/` | Cloudflare Worker do retorno do OAuth (`esteira.cloud`) |
| `scripts/` | Testes (`testar-*.mjs`), rodada ao vivo, geradores de ícone e modelo |
| `marca/` | Ícones gerados por `scripts/gerar-icone.py` (veja `marca/LEIA.md`) |
| `migracoes/` | Esquema SQLite do armazenamento |

## Documentos

- [`DECISOES.md`](DECISOES.md): cada decisão e incidente, com data e o porquê.
  É o primeiro lugar a ler antes de mudar comportamento.
- [`FASES.md`](FASES.md): o roteiro, da operação real até "sem planilha".
- [`INSTALACAO.md`](INSTALACAO.md): instalação e operação na máquina do cliente.

## Resultados da prova de conceito (base real, 19.975 pedidos)

Medido antes do aplicativo existir, contra a planilha de controle do cliente
(março a setembro de 2026), com `npm run proof`. A conciliação de hoje usa
mais sinais que isso (CEP, pedido em várias compras, pareamento pelo total).

**Parser de rastreio**

| | |
|---|---|
| Extraído sem ressalva | 92,75% |
| Vários códigos na mesma célula, separados corretamente | 2,00% (399) |
| Vazio na origem | 5,02% |
| Não reconhecido → revisão | 0,07% (13) |

107 células tinham o código dos Correios colado no da Shopee Xpress sem
separador (`BR290000000007JSPXLM10000001`) — todas separadas corretamente.

**Casamento Shopee → Shopify**, simulando dia a dia com janela de 21 dias:

| Critério | Automático | Revisão | Casado errado |
|---|---|---|---|
| Só pelo nome | 89,11% | 10,89% | 0 |
| Nome + valor + produto | **97,57%** | 2,43% | **0** |

Em 10,89% dos pedidos o nome sozinho não identifica o pedido: existe outro
pedido aberto do mesmo nome na janela. Na operação real entra também o
endereço de entrega, que desempata boa parte do resto.

> Os números do fixture sintético **não** reproduzem os acima — ele existe para
> o código rodar em qualquer máquina, não para medir. Só cite números obtidos
> com a planilha real.

## Princípios

- **Nunca escrever sob dúvida.** Empate, total que não bate ou compra sem
  rastreio vão para a conferência.
- **Não deslogar e não insistir.** A sessão vive no perfil do AdsPower. São no
  máximo 2 logins por conta na rodada, porque repetir login é o que faz a Shopee
  pedir captcha.
- **Verificação de identidade é resolvida, não contornada.** O link por e-mail
  é seguido pela caixa do inboxes.com. Captcha de imagem vai para uma pessoa,
  com a janela aberta por 10 min.
- **Falhar dizendo o porquê.** Cada pedido que não foi escrito tem um motivo
  em português, e cada falha de conta diz se repete sozinha ou se precisa de
  você.

## Dados e segredos

Planilhas, coletas e `data/pedidos.json` têm nome, valor e rastreio de
clientes reais e **não são versionados**. Credenciais de desenvolvimento ficam
em `.env` (modelo em `.env.example`). O diagnóstico exportado remove segredos e
dados de clientes.

## Autor

**Gustavo Bragaia**, [GBS Media](https://github.com/gustavobragaia)
· gustavobragaia12@gmail.com

Feito para a operação da Chomps. Software proprietário, todos os direitos
reservados.
