# Instalação na máquina do cliente (Windows)

Pré-requisitos: AdsPower instalado e logado, Node.js 20+.

## 1. Configurar

```
copy .env.example .env
```

Preencher no `.env`:

| Chave | Onde pegar |
|---|---|
| `ADSPOWER_API_KEY` | AdsPower → Configurações → API (a chave vai no header, não na URL) |
| `SHOPIFY_LOJA` | `sualoja.myshopify.com` |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Dev Dashboard → o app → credenciais |
| `RAPIDAPI_KEY` | inboxes.com no RapidAPI (só para o login com OTP) |
| `SHOPEE_SENHA` | senha única das contas |
| `CONCORRENCIA` | 3 em 16 GB de RAM, 6 em 32 GB |
| `WEBHOOK_ALERTA` | opcional: URL que recebe o alarme de falha |

## 2. Listar as contas

Com plano pago do AdsPower o robô lê os perfis sozinho pelo `user/list`.
Para fixar uma lista, criar `contas.json`:

```json
[{ "userId": "k1a2b3", "conta": 7 }, { "userId": "k4d5e6", "conta": 196 }]
```

## 3. Rodar

```
npm start
```

Sobe o coletor, o painel em http://127.0.0.1:4000 e a varredura automática
às 9h, 14h e 18h. Outros horários: `--horarios 8,12,16,20`.

Uma rodada avulsa, sem painel: `npm run rodada`.
Sem escrever na Shopify: `npm run dry`.

## 4. Iniciar junto com o Windows

Agendador de Tarefas → Criar Tarefa:

- Disparador: **Ao fazer logon**
- Ação: `node` · argumentos `--env-file=.env start.mjs --painel`
- Iniciar em: a pasta do projeto
- Marcar **Executar apenas quando o usuário estiver conectado** (o AdsPower
  precisa de sessão gráfica)

## Operação do dia a dia

Só o painel. Ele mostra o que precisa de gente:

- **Precisam de revisão** — o robô se recusou a escrever. O motivo está na
  linha. Resolver na Shopify e clicar em *Dispensar*.
- **Rodadas** — histórico. Coluna *Falhas* lista as contas que não
  responderam; elas voltam na rodada seguinte sozinhas.

## Se algo parar

Alarme dispara quando nenhuma conta responde ou mais de 30% falham —
notificação no Windows e, se configurado, no `WEBHOOK_ALERTA`.

Causas comuns, em ordem:

1. AdsPower fechado ou deslogado
2. Extensão não injetada (confirmar que a pasta `extensao/` existe)
3. Shopee pedindo verificação humana na conta — abrir o perfil na mão,
   resolver, e a próxima rodada volta ao normal
4. Credencial da Shopify vencida (o token renova sozinho; se falhar,
   conferir client id/secret)

## Limites conhecidos

- A verificação humana da Shopee **não** é contornada por software: quando
  aparece, o perfil precisa de uma pessoa.
- Pedido ambíguo nunca é escrito por palpite — vai para revisão.
- O PC precisa estar ligado e com o usuário logado na hora da varredura.
