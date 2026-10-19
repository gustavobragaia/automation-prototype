# shopee-tracking-bot

Automação de rastreios: lê os códigos de rastreio dos pedidos em contas de
comprador da Shopee e escreve na Shopify, sem passar por planilha.

A operação roda em perfis do [AdsPower](https://adspower.com) (uma conta Shopee
por perfil, cada um com seu fingerprint e proxy), na própria máquina do
operador — não em servidor. Manter o tráfego saindo do mesmo IP de sempre é o
que faz o comportamento continuar idêntico ao manual.

> **Estado:** provas de conceito validadas. O scraper da Shopee ainda não foi
> escrito — depende de rodar na máquina com as contas reais.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `src/tracking.mjs` | Extrai códigos de rastreio de texto sujo; normaliza o rótulo da conta e monta o e-mail de login |
| `src/match.mjs` | Casa o pedido lido na Shopee com o pedido aberto na Shopify |
| `src/adspower.mjs` | Cliente da Local API do AdsPower (listar, abrir, fechar perfil) |
| `src/otp.mjs` | Lê o código de verificação na caixa descartável (inboxes.com via RapidAPI) |
| `src/shopify.mjs` | Monta e envia o `fulfillmentCreateV2` |
| `run-proof.mjs` | Roda parser e matcher contra a base de pedidos e reporta as taxas |
| `run-e2e.mjs` | Encadeia tudo com AdsPower e Shopee simulados |

## Rodando

```bash
npm run fixture   # gera data/pedidos.json sintético
npm run proof     # parser + matcher, com relatório
npm run e2e       # encadeamento ponta a ponta
```

Para rodar contra a planilha real do cliente (requer `python3 -m pip install openpyxl`):

```bash
node scripts/importar-planilha.mjs "~/caminho/PEDIDOS SHOPEE.xlsx"
```

## Resultados medidos (base real, 19.975 pedidos)

Rodado contra a planilha de controle do cliente, março a setembro de 2026.

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

## Decisões de projeto

- **Nunca escrever sob dúvida.** Se a identificação não for única depois de
  nome, valor e produto, o pedido vai para revisão humana. Rastreio trocado é
  pior que rastreio ausente.
- **Não deslogar.** A sessão da Shopee persiste no perfil do AdsPower; deslogar
  força OTP e verificação humana a cada acesso.
- **Credencial derivada, não lida do perfil.** O e-mail segue o padrão
  `Brushopee<NNN>@givmail.com` e a senha é única — o campo do perfil do
  AdsPower nem sempre está preenchido.
- **Só aceitar OTP mais novo que o início do login.** Sem o filtro por
  `created_at_epoch` o robô lê códigos já expirados de forma intermitente.
- **Verificação humana não é contornada.** Quando a Shopee exibe o desafio, o
  robô pausa aquele perfil e chama um operador; os outros seguem rodando.

## Dados e segredos

`data/pedidos.json` contém nome, valor e rastreio de clientes finais reais e
**não é versionado** (veja `.gitignore`). O mesmo vale para a planilha original.

Credenciais ficam em `.env` (modelo em `.env.example`). Em produção a senha das
contas vai em arquivo cifrado na máquina do operador, não em `.env`.
