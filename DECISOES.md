# Decisões de arquitetura

Registro curto do que foi decidido e **por quê**, para não re-discutir nem
repetir erro. Uma entrada por decisão; quando uma decisão muda, a entrada é
reescrita com a data.

---

## 1. Migração do banco (2026-10-15)

O app roda na máquina do cliente e se atualiza sozinho. Toda versão nova pode
trazer mudança de schema, e **a atualização chega sem ninguém de plantão**. Se
a migração falhar, o histórico de 700 contas vai junto.

### Regras

**1.1 — Migrações numeradas, só pra frente.**
`migracoes/001-inicial.sql`, `002-contas.sql`, … Nunca editar uma migração já
publicada: a máquina do cliente já rodou aquela versão. Correção vira migração
nova.

**1.2 — A versão mora no banco.**
`PRAGMA user_version` guarda o número da última migração aplicada. No boot o app
compara com o que existe em disco e aplica só o que falta, em ordem.

**1.3 — Backup antes, sempre.**
Antes de aplicar qualquer migração, copiar o arquivo para
`backups/dados-v<N>-<AAAA-MM-DD-HHmm>.sqlite`. É cópia local, instantânea, e é
a única coisa entre um bug e a perda do histórico.

**1.4 — Tudo numa transação; falhou, volta.**
Cada migração roda dentro de `BEGIN`/`COMMIT`. Se lançar, faz `ROLLBACK`,
restaura o backup, **recusa iniciar** e mostra o erro na tela — com o caminho do
backup. Subir com schema pela metade é pior que não subir.

**1.5 — Aditivo numa versão, destrutivo na seguinte.**
Nunca adicionar coluna e remover a antiga na mesma versão. Primeiro a versão que
escreve nos dois lugares; só depois, quando todas as máquinas estiverem
atualizadas, a versão que remove. Vale também para renomear.

> Isto já custou uma produção no projeto AcompanhanteJá: um `DROP` de coluna
> "vazia" derrubou o site porque o código **no ar** ainda a declarava.

**1.6 — Nunca migrar com a fila rodando.**
O boot espera a fila terminar, ou nem começa a rodada se há migração pendente.
Migrar com perfis abertos trunca estado no meio.

**1.7 — Retenção.**
Guardar os 10 backups de migração mais recentes e os 30 diários do Drive. O
resto é podado — senão a pasta cresce sem limite na máquina do operador.

### Fluxo no boot

```
abre o banco
  versão do arquivo == versão do app ?  → segue
  versão do arquivo  > versão do app ?  → recusa (app velho, banco novo)
  versão do arquivo  < versão do app ?  → fila parada?
                                           backup → migra em transação
                                           falhou → restaura, recusa, mostra erro
```

---

## 2. Branches e publicação (2026-10-15)

**Uma branch só: `main`.** Trabalho em branch de feature, volta por PR. Sem
`dev` nem `prod` — com um desenvolvedor elas só criam divergência, e `prod`
duplica o que a tag já faz.

**Publicar é criar tag, não dar push.** Push na `main` roda teste e build; nada
é publicado. Só a tag `v1.2.3` empacota e publica. A tag é o botão de publicar:
deliberado, com data e changelog.

**Dois canais de atualização, não duas branches.**
`v1.3.0-beta.1` vai para o canal `beta` (só a máquina do desenvolvedor);
`v1.3.0` vai para `latest` (cliente). Testar em produção sem arriscar o cliente.

**Instaladores fora do repositório de código.** O repo é privado; o
`electron-updater` só lê release privado com token embutido no app — ou seja,
token vazado. Os `.exe` vão para bucket estático (provider `generic`).

**Certificado de assinatura é requisito, não enfeite.** Sem ele o Windows
avisa e o antivírus corporativo às vezes bloqueia. Emissão demora: começar cedo.

---

## 3. Quando instalar a atualização (2026-10-15)

Nunca no meio de uma rodada: o updater reinicia o app, e perfis abertos ficam
órfãos com estado truncado.

```
baixa em segundo plano      → marca "pronta"
fila terminou E sem pendência E sem rodada nos próximos 15 min
                            → mostra o aviso e o selo na bandeja
operador aceita             → instala e reinicia
operador ignora             → instala no próximo boot do app
```

O operador decide a hora. O app nunca interrompe trabalho por conta própria.

---

## 4. De onde vem o mapeamento pedido → conta (2026-10-15, corrigido)

**Correção de uma premissa minha.** Eu havia dito que a planilha era só um
acelerador e que dava para inverter a fila partindo da Shopify. O cliente
corrigiu, e ele tem razão:

> "você não tem como saber pela Shopify em qual conta da Shopee foi pago
> aquele pedido. Precisa da planilha."

O casamento por nome + CEP (97,6% de identificação única em 19.975 pedidos)
prova **identidade** depois que a conta está aberta. Ele não diz **qual** conta
abrir. Essa informação nasce de uma decisão humana — a funcionária escolhe em
qual conta pagar — e hoje só existe na planilha.

### O processo de hoje

```
pedido entra na Shopify
  ↓  (manhã seguinte)
exporta pedidos do dia anterior → prompt de IA → planilha do dia
  ↓
funcionária paga na Shopee e anota na planilha de controle:
  pedido · cliente · produto · qtd · valor · [rastreio vazio] · CONTA
  ↓
outra pessoa vê onde o rastreio para, abre aquela conta, copia o rastreio
  ↓
copia da planilha para a Shopify
```

### v1 — a planilha é entrada, e isso está certo

O robô lê a coluna da conta, abre só os perfis daquele dia e preenche o
rastreio na Shopify. Elimina as etapas 4 e 5 (copiar rastreio, colar na
Shopify) sem pedir mudança nenhuma de hábito.

### v2 — o app substitui a planilha no momento em que o dado nasce

A funcionária já registra o mapeamento; a questão é **onde**. Se ela registra
no app em vez da planilha, o dado nasce no banco:

```
app puxa os pedidos do dia anterior da Shopify   (mata o export + prompt de IA)
  ↓
ela trabalha pela lista do app; a cada pedido pago, escolhe a conta
  ↓
app já sabe pedido ↔ conta, abre os perfis e preenche o rastreio sozinho
```

Mesmo esforço para ela — provavelmente menos, porque a lista vem pronta — e
ninguém mais abre planilha. A planilha continua sendo gerada, como **saída**,
para quem quiser conferir pelo Drive.

**Não são dois produtos.** É a mesma resolução em três níveis; a v2 acontece
quando o nível 1 passa a cobrir tudo:

```
1. banco      — registrado no app pela funcionária, ou aprendido numa coleta
2. planilha   — enquanto o banco não cobre
3. varredura  — último recurso, e cara: 700 contas
```

Uma tela mostra a cobertura ("78% do mapeamento vem do banco") para a troca ser
decisão com número, não palpite.

---

## 5. Plataformas e ambientes (2026-10-15)

**Windows é o alvo principal** — é onde o cliente opera. **macOS também é
suportado**, porque o desenvolvimento acontece no Mac e o AdsPower tem cliente
para as duas plataformas; o mesmo código Node roda nos dois.

Distribuir no macOS exige conta Apple Developer (US$ 99/ano) e notarização,
senão o Gatekeeper bloqueia. Para uso só do desenvolvedor isso pode esperar.

**Beta na máquina do desenvolvedor, estável na do cliente.** Nenhuma versão
chega ao cliente sem ter rodado antes numa máquina real com AdsPower e contas
de verdade.

---

## 6. Formato da planilha de entrada (2026-10-17)

O cliente passa a enviar **só os pedidos pagos do dia**, não a planilha de
controle inteira. São 210 pedidos em 33 contas, contra 19.975 linhas e 91
contas — o recorte que a operação realmente tem para fazer, e muito menos
superfície para erro.

### Hoje: cabeçalho opcional

A planilha diária que o cliente exporta hoje vem **sem cabeçalho**, com os
dados começando na linha 1. O leitor detecta: tenta mapear o cabeçalho e,
não reconhecendo, usa a ordem fixa das colunas — mas só se a linha 1 parecer
dado, para não ler um cabeçalho estranho como se fosse pedido.

Isso é tolerância de transição, não o destino.

### Em produção: cabeçalho obrigatório

Quando houver a tela de upload, **a planilha passa a exigir cabeçalho**, e o
upload recusa o arquivo que não o tiver, dizendo qual coluna falta.

O motivo é que ordem fixa é uma suposição silenciosa: se alguém reordenar as
colunas, o robô lê nome no lugar de produto e conta no lugar de rastreio sem
reclamar. Com cabeçalho, errar a ordem é inofensivo e faltar coluna é um
erro claro, na hora do upload, para a pessoa que pode corrigir.

**A tela precisa:**

- listar as colunas obrigatórias e o que vai em cada uma;
- oferecer **a planilha-modelo para baixar**, com cabeçalho e exemplos
  preenchidos (`modelo/planilha-modelo.xlsx`, gerada por
  `scripts/gerar-modelo-planilha.mjs`);
- validar antes de aceitar, e mostrar o que está errado linha a linha —
  conta não reconhecida, rastreio já preenchido, pedido sem nome;
- mostrar o resumo antes de rodar: quantos pedidos, quantas contas, quantas
  linhas serão ignoradas e por quê.

### Colunas

| Coluna | Obrigatória | Conteúdo |
|---|---|---|
| DATA | não | data do pedido |
| NÚMERO DO PEDIDO | **sim** | exatamente como aparece na Shopify |
| NOME DO CLIENTE | **sim** | nome de quem recebe, igual ao da entrega |
| PRODUTO | não | o nome na Shopee costuma ser outro; não serve para casar |
| UNIDADES | não | — |
| VALOR PAGO | não | desempata cliente com mais de um pedido |
| CÓDIGO DE RASTREIO | **sim** | vazia: é o que o robô preenche |
| ONDE FOI FEITO O PEDIDO | **sim** | a conta Shopee, no formato `shopee 120` |

---

## 7. Como o cliente conecta a Shopify (2026-10-18)

A Shopify encerrou os apps personalizados criados no admin em **01/01/2026**:
não existe mais token estático em tela. Todo app novo nasce no Dev Dashboard,
e aí a escolha é de **método de distribuição** — e o método **não pode ser
trocado depois**.

### O que foi decidido

**Agora, cenário A — o lojista cria o app e nos passa as credenciais.**
Ele cria o app no Dev Dashboard da organização dele, marca os escopos e copia
`client_id` + `client_secret`. Trocamos por um token de 24h via
`client_credentials`, e o robô renova sozinho.

**Depois, cenário B — app nosso com custom distribution.**
O app é nosso, com distribuição restrita à loja do cliente. Ele clica em um
link de instalação, vê a tela de permissões da Shopify e autoriza. Nenhum
token é copiado por ninguém.

O B é melhor para o cliente e é o destino. Está em A hoje porque o B exige um
**domínio com HTTPS** para o retorno do OAuth, que ainda não temos.

### Por que o A não serve em produção

`client_credentials` **só funciona quando o app e a loja estão na mesma
organização**. Isso vale para uma loja de teste criada por nós; na loja do
cliente, o app tem que ser criado por ele. Ou seja: o A funciona, mas empurra
uns dez passos técnicos para o lojista.

### O que o B precisa

| | |
|---|---|
| Conta Partner | nossa, uma só, serve para todos os clientes |
| Domínio HTTPS | para `application_url` e `redirect_urls` — `localhost` não é aceito de forma confiável |
| Endpoint de retorno | recebe `code`, valida `state` e o HMAC-SHA256, troca pelo token |
| Renovação | access token vale 1h, refresh token vale 90 dias |

Fluxo no aplicativo de desktop, que é onde ele vai rodar:

1. o cliente clica em **Conectar Shopify** no painel;
2. abre o navegador na nossa página, que redireciona para a Shopify;
3. ele aprova as permissões;
4. a Shopify chama nosso endpoint com o `code`;
5. o endpoint valida e troca pelo token;
6. o aplicativo busca o token e guarda no keychain da máquina;
7. nosso servidor apaga o token.

O passo 7 é regra, não detalhe: **credencial de cliente não fica no nosso
servidor.**

### Como isso aparece no código

Trocar A por B é trocar o `modo` em `src/shopify-conexao.mjs`. Nada mais no
projeto sabe de onde vem o token:

| Arquivo | Papel |
|---|---|
| `src/shopify-conexao.mjs` | guarda a conexão e entrega um token válido — é o único que conhece os modos |
| `src/shopify.mjs` | lê e escreve na Admin GraphQL; pede o token e não pergunta a origem |
| `scripts/conectar-shopify.mjs` | o "conectar" do painel: valida contra a Shopify de verdade e só salva se a loja responder |

O modo `oauth` (B) já está escrito, incluindo a renovação pelo refresh token,
mas **ainda não foi exercitado** contra a Shopify — depende do app com custom
distribution, que depende do domínio.

### Escopos

```
read_orders                                write_orders
read_fulfillments                          write_fulfillments
read_assigned_fulfillment_orders           write_assigned_fulfillment_orders
read_merchant_managed_fulfillment_orders   write_merchant_managed_fulfillment_orders
```

O `conectar` compara os escopos **concedidos ao token** com essa lista e avisa
o que falta. Vale mais que a configuração do app: é o que diz se a escrita vai
falhar antes de a gente tentar escrever.

### Onde o segredo fica

Hoje em `estado/conexao-shopify.json`, com permissão `0600`, fora do git. Na
fase do aplicativo isso vira keychain do sistema operacional.

### A planilha dá o número do pedido — então não há casamento por nome

A planilha do dia traz o número da Shopify (`Pedido #164891`). O pedido é
buscado **pelo número**, exato. O nome entra só como conferência: se o
destinatário na Shopify não for o mesmo da Shopee, **não escreve**.

O casamento por nome + valor + produto continua existindo em `src/match.mjs`
para o dia em que a entrada não tiver o número — não é o caminho padrão.

### Escrever duas vezes não duplica

`estado/escritas-shopify.json` registra o que já foi escrito, e antes de
escrever o robô também confere se o pedido já está `FULFILLED` na Shopify.
Rodar a mesma rodada de novo não cria um segundo fulfillment.
