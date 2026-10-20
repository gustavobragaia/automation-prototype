---
name: conectar-shopify-cliente
description: Conecta a Shopify de um cliente NOVO do Esteira — cria o app com distribuição personalizada na organização Partner GBS Media, instala na loja pelo link assinado, registra a loja no servidor esteira.cloud e acompanha o "Conectar Shopify" do cliente. Use quando o Gustavo disser "conectar a Shopify do cliente X", "cliente novo", "a loja não conecta", "link de instalação inválido", ou quando um cliente novo for usar o Esteira.
---

# Conectar a Shopify de um cliente novo

O Esteira escreve rastreios na Shopify do cliente por um **app nosso** (organização
Partner **GBS Media**, conta gustavobragaia12@gmail.com), com **distribuição
personalizada** para a loja dele. O cliente instala o app uma vez e clica em
"Conectar Shopify" no Esteira. O token vai para a máquina dele e nunca fica no
servidor (ver `servidor/README.md`).

Este é o caminho que **funcionou na Esparta em 21/10/2026**, depois de dias de
"link de instalação inválido". Siga na ordem. Não pule passos.

## A regra que mais derruba

**Só o link assinado da página "Distribuição" instala o app.** Ele tem a forma
`admin.shopify.com/store/<loja>/oauth/install_custom_app?client_id=…&signature=…`.

| Por onde se abre | Resultado |
|---|---|
| Link assinado da página Distribuição | ✅ "Este app é exclusivo para sua loja", Instalar habilitado |
| Botão "Instalar app" no Dev Dashboard do app | ❌ "O link de instalação para este app é inválido" |
| "Conectar Shopify" do Esteira **antes** de instalar | ❌ "O link de instalação para este app é inválido" |
| Botão do Dev Dashboard antes de escolher distribuição | ❌ "O desenvolvedor precisa selecionar um método de distribuição" |

O link expira em **7 dias**. Se expirou, gere outro na mesma página.

## O que pedir ao Gustavo antes de começar

1. O **endereço .myshopify.com** da loja. Não serve o domínio público (ex.:
   `espartastore.com`). No admin: Configurações → Domínios, ou o endereço que
   aparece no navegador dentro do admin.
2. Um **NOME** curto para o cliente (A-Z, 0-9, `_`), ex.: `ESPARTA`. Vira
   `SHOPIFY_CLIENT_ID_<NOME>` e `SHOPIFY_CLIENT_SECRET_<NOME>` no servidor.
3. **Quem vai instalar o app:**
   - o **dono** da loja (mais simples), **ou**
   - o Gustavo como **colaborador**: o dono passa o **código de solicitação de
     colaborador** (fica em Configurações → Usuários → Segurança). A solicitação
     sai do Dev Dashboard da GBS Media → Lojas → "Solicitar acesso à loja", e
     pede **só**:
     - Apps e canais de vendas → **Gerenciar e instalar apps e canais de vendas**
     - Pedidos → **Ver** (para conferir a leitura)

     A primeira solicitação pede verificação de identidade (documento + selfie)
     e, depois de aprovada, autenticação em duas etapas. As duas são do Gustavo.

## Passo a passo

Trabalhe no navegador do Gustavo (Claude in Chrome), logado como
gustavobragaia12@gmail.com. Dev Dashboard da GBS Media:
`https://dev.shopify.com/dashboard/241936900`.

### 1. Criar o app
Dev Dashboard → **Apps → Criar app**. Formulário:

| Campo | Valor |
|---|---|
| Nome do app | `Esteira <Cliente>` |
| URL do app | `https://esteira.cloud` |
| Incorporar app ao admin da Shopify | **desmarcado** |
| URL(s) de redirecionamento | `https://esteira.cloud/shopify/callback` |
| Escopos | `read_orders,write_orders,read_fulfillments,write_fulfillments,read_assigned_fulfillment_orders,write_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders` |

Clique **dentro** da caixa de Escopos antes de digitar: o clique fora não foca e
o campo fica vazio sem aviso. Confira com um zoom antes de criar.
**Criar app → Lançar.** Anote o **ID do cliente** (aparece no quadro Credenciais).

### 2. Distribuição personalizada (irreversível)
Na página do app, quadro **Distribuição** (abre no Partners) → **Distribuição
personalizada** → Selecionar → confirmar. Domínio: `<loja>.myshopify.com`.
**Desmarque** "Permitir instalação em várias lojas para uma organização Plus".
**Gerar link → confirmar.** É irreversível: o app passa a servir só essa loja.
Mostre a tela ao Gustavo e confirme antes do clique final.

### 3. Instalar pelo link assinado
Copie o **Link de instalação** (botão Copiar) e abra **esse** link:
- se o Gustavo é colaborador: abra na aba dele e clique em **Instalar**;
- se é o dono quem instala: mande o link para ele abrir **numa janela anônima**,
  logado como dono, e clicar em **Instalar**.

**Prova de que instalou:** a Shopify redireciona para
`https://esteira.cloud/?shop=<loja>.myshopify.com` (página "Servidor de conexão
da Esteira"). No log do servidor aparece a rota `/` com essa loja. Sem essa
linha, o app não está instalado e o "Conectar Shopify" vai falhar.

### 4. Registrar a loja no servidor
```bash
cd ~/Documents/shopee-tracking-bot
node scripts/cliente-shopify.mjs registrar <loja>.myshopify.com <NOME> <client_id>
git diff servidor/wrangler.toml
cd servidor && npx wrangler deploy
```

### 5. O segredo (o Gustavo faz)
O segredo nunca passa pelo chat. Fluxo que funcionou:
1. Clique você no botão de copiar da **Chave secreta do cliente** (Dev Dashboard
   → app → Credenciais). O clique do Gustavo às vezes não chega à área de
   transferência quando o Chrome está sem foco.
2. Confira **só o formato**, sem imprimir o valor:
   ```bash
   pbpaste | python3 -c "import sys;v=sys.stdin.read().strip();print('chave ok:', v.startswith('shpss_') and len(v)==38)"
   ```
   Já aconteceu de subir o link de instalação e, na outra vez, um valor vazio.
3. O Gustavo roda:
   ```bash
   cd ~/Documents/shopee-tracking-bot/servidor && pbpaste | npx wrangler secret put SHOPIFY_CLIENT_SECRET_<NOME>
   ```
4. Limpe a área de transferência: `pbcopy < /dev/null`.

Para conferir o que o servidor faz com a loja:
```bash
node scripts/cliente-shopify.mjs conferir <loja>.myshopify.com
```
Isso prova o `client_id`, não o segredo. Só o passo 6 prova o segredo.

### 6. O cliente conecta (de preferência em call)
Ligue o log do servidor antes:
```bash
cd ~/Documents/shopee-tracking-bot/servidor && npx wrangler tail --format json
```
(filtre só rota, loja e status, nunca a URL inteira, que tem o `code`).

No Esteira do cliente: **Ajustes → Shopify** → digite `<loja>.myshopify.com` →
**Conectar Shopify** (o botão roxo, **não** "Ou conecte com a chave do app").
O navegador dele precisa estar logado no admin da loja.

| No log | Significa |
|---|---|
| `/shopify/instalar` 302 | ele clicou em Conectar |
| `/shopify/callback` **200** | a Shopify entregou o acesso; o segredo está certo |
| `/shopify/callback` 400 | assinatura não confere: segredo errado no servidor (volte ao passo 5) |
| `/shopify/callback` 502 | a Shopify não trocou o code: app não instalado na loja (volte ao passo 3) |
| `/shopify/instalar` 503 | a loja não está registrada, ou falta o segredo |
| só `/instalar`, nenhum callback | o navegador parou numa tela: peça print (login, outra conta, "link inválido") |

No Esteira tem que aparecer **"<nome da loja> está conectada"**, com os **8
escopos**. A página do navegador mostra "Shopify conectada. Pode fechar esta janela."

### 7. Conferir sem escrever
Peça ao Gustavo um print do quadro Shopify (nome da loja veio da Shopify, 8
escopos). A primeira **escrita** real acontece na primeira rodada, com "Escrever
sem me perguntar" **desligado**, aprovando um pedido só na etapa 4.

## O que não fazer

- **Não crie pedido de teste na loja de produção.** Lojas de dropshipping têm
  apps que reagem a pedido novo (ex.: DROPAR compra no fornecedor, Reportana
  manda WhatsApp ao comprador). A escrita é provada na primeira rodada real.
- **Não apague pedidos.** Apagar pedido é permanente; quem decide é o Gustavo
  ou o dono.
- **Não peça a role "Desenvolvedor de apps" nem "Desenvolver apps" ao
  colaborador esperando abrir o Dev Dashboard da loja.** Colaborador não vê o
  botão "Desenvolver apps no Dev Dashboard" (testado na Esparta). Não é preciso:
  o app é nosso.
- **Não use o caminho "Ou conecte com a chave do app"** para clientes. Ele só
  funciona com app criado **dentro** da organização da loja (client
  credentials), o que exige o dono criando o app no Dev Dashboard dele. Fica
  como plano B, com o guia em https://claude.ai/artifact/8NCoGgqarAvQGfmaX4ee7V.
- **Não publique o app na App Store.** As regras (1.1.12: não pode depender de
  app desktop; 2.3.1: não pode pedir o endereço da loja) barram o Esteira, e a
  revisão leva semanas.
- **Não deixe token de cliente no Mac do Gustavo.** Se testar o "Conectar" aqui,
  use uma pasta temporária (`ESTADO_DIR`, `SHOPIFY_CONEXAO_ARQUIVO`) e apague
  depois.

## Lojas já conectadas

| Loja | NOME | App | Desde |
|---|---|---|---|
| loja-sparta-store.myshopify.com (Esparta Store) | SPARTA | Esteira Esparta (`25cb4e58…`) | 21/10/2026 |
| testeloja-4ajtpkll.myshopify.com (teste) | app principal | Esteira (`d278ab9b…`), org da loja | 18/10/2026 |

Atualize esta tabela a cada cliente novo.
