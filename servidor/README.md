# Retorno do OAuth da Shopify

Duas rotas em `esteira.cloud`, num Cloudflare Worker. É tudo o que roda fora
da máquina do cliente.

| | |
|---|---|
| `GET /shopify/instalar?loja=&state=` | manda o lojista para a tela de permissões |
| `GET /shopify/callback` | a Shopify volta aqui; troca o `code` pelo token |

## O token não fica aqui

O `callback` troca o código pelo token e entrega **por POST automático** para
`http://127.0.0.1:<porta>/shopify/pronto`, o aplicativo na máquina do cliente.
Nada é gravado neste servidor.

POST, e não redirecionamento com o token na URL, porque URL vai para o
histórico do navegador e para o cabeçalho `Referer`.

A porta de destino viaja dentro do `state` (`porta.nonce`), que também é o
que liga o retorno ao pedido que aquela máquina fez.

## Variáveis

```
BASE_URL=https://esteira.cloud     # já no wrangler.toml
SHOPIFY_CLIENT_ID=                 # público; var normal
SHOPIFY_CLIENT_SECRET=             # SECRET, nunca var: wrangler secret put
```

Subir: `npx wrangler deploy`. O domínio precisa estar na Cloudflare (os
nameservers apontando para lá) para a rota `esteira.cloud/*` funcionar.

## O que é conferido antes de qualquer coisa

1. **HMAC** dos parâmetros, com o client secret, em tempo constante. Sem
   isso, qualquer um que chame a URL recebe um token.
2. **Formato da loja** (`*.myshopify.com`). `shop` entra numa URL que nós
   montamos; sem validar, `shop=evil.com` faria a troca de token acontecer
   no servidor do atacante.
3. **`state`** no formato certo, com porta não privilegiada.
4. **`code`** no formato esperado.

Do lado do aplicativo há mais uma: o `state` recebido precisa ser
exatamente o que aquela máquina gerou, e vale uma vez só.
