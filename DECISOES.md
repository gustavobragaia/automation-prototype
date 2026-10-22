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

---

## 8. Fila de login entre perfis (2026-10-18)

**Um login por vez, na rodada inteira.** Vários navegadores abertos ao mesmo
tempo é seguro; vários *logins* ao mesmo tempo não é.

### De onde veio

A primeira trava nasceu do episódio das 4 abas: o perfil restaura as abas da
sessão anterior, todas caem no `/buyer/login`, e a Shopee respondeu a quatro
logins simultâneos com verificação por imagem — que a gente chegou a atribuir
a bloqueio dela.

Essa trava ficou no service worker da extensão. O que passou despercebido é
que **o service worker é por perfil**: ele impede duas abas do mesmo
navegador, e não sabe que existem outros quatro navegadores abertos pela
fila. Com `CONCORRENCIA=3` e duas contas deslogadas, o problema volta inteiro.

### Como ficou

Duas camadas, e a de baixo é a que importa:

| Camada | Onde | Arbitra |
|---|---|---|
| 1 | `extensao/background.js` | abas do mesmo perfil — barata, sem ida à rede |
| 2 | `src/trava-login.mjs`, via rota do coletor | **perfis entre si** |

A aba que ganha a 1 ainda precisa ganhar a 2. O coletor é o único ponto que
enxerga a rodada inteira, porque roda no mesmo processo da fila.

### Regras

- **Dona que não concluiu em 45 s perde a vez** (`TRAVA_LOGIN_MS`). Sem isso,
  um perfil travado no meio do login paralisaria a rodada toda.
- **Só o dono solta.** Uma recusa que chega atrasada não pode derrubar quem
  já entrou.
- **Pedir de novo sendo dono não derruba ninguém** — o content script pode
  perguntar mais de uma vez durante o mesmo login.
- **Solta em todo desfecho**: `login-ok`, `login-falhou` e `precisa-humano`.
  É o que faz a fila andar; esperar a expiração custaria 45 s por conta.
- **Três redes de segurança**: aba fechada solta (`chrome.tabs.onRemoved`), a
  fila solta no `finally` de cada conta, e a expiração cobre o resto.
- A rota `/trava-login` tem a mesma proteção de `/credencial`: recusa
  requisição com `Origin` de site e exige o token da rodada.

### O que isso destrava

Oferecer 5 ou 10 navegadores na tela deixa de ser uma promessa que o código
não cumpre. O limite real de paralelismo volta a ser a máquina, não o risco
de queimar conta.

---

## 9. Perfil ambíguo bloqueia a conta (2026-10-18)

Entrar no perfil errado é o pior erro que este sistema pode cometer: os
cookies de uma conta sobrescrevem os da outra, o robô entra como quem não
devia e escreve o rastreio no pedido de **outro cliente** — sem nenhum erro
na tela. Nada no resto do sistema pega isso depois.

### São dois casos diferentes

| | O que é | De onde vem |
|---|---|---|
| **A** | duas abas do AdsPower com o mesmo número no nome (`Shopee 225` duas vezes) | acontece de verdade, ao duplicar perfil |
| **B** | duas contas apontando para o mesmo `user_id` | **não** vem do AdsPower (`user_id` é único); vem de lista escrita à mão, `contas.json` |

O painel foi desenhado só com o B em mente. Na prática o A é o que vai
disparar, e era o que estava sem tratamento de verdade.

### A regra

**Na dúvida, não abre nenhum.** Antes, o A resolvia com "primeiro vence" e um
aviso no log: o robô escolhia sozinho, e escolher errado é pior que não
rodar. Agora a conta sai da rodada e vai para a conferência, com os `user_id`
em conflito no aviso para alguém saber qual apagar.

O B é checado nos dois caminhos: depois de resolver pela planilha, e também
em `contas.json`, que não passa pelo `resolverContas`.

### Medido

Contra os 972 perfis reais do cliente: 972 contas mapeadas, 0 duplicadas,
0 sem número no nome. Hoje está limpo — a checagem é para o dia em que
alguém duplicar um perfil, que é quando ninguém está olhando.

---

## 10. Pedido que atravessa o dia (2026-10-18)

### O buraco

O trabalho da rodada vinha **só** da planilha que o cliente sobe, e ele manda
"apenas os pedidos pagos do dia". Logo: o pedido do dia 18 que não recebeu
rastreio **não está** na planilha do dia 19, e sumia.

Não era caso raro. "A Shopee ainda não despachou" é o motivo mais comum e
**sempre** atravessa pelo menos um dia — o pedido é pago hoje e despachado
amanhã. Em produção isso seria perda silenciosa de rastreio todo dia, e o
cliente só descobriria pela reclamação de quem comprou.

A pergunta que revelou isso foi simples: *"cliquei em deixar para amanhã;
como eu vou lembrar?"*. A resposta honesta era que ninguém ia.

### A carteira

Existe uma lista de pendentes que atravessa o dia, e a rodada é a **união**
da planilha de hoje com ela. Se o pedido antigo é de uma conta que não ia ser
aberta hoje, ela passa a ser.

A carteira guarda a linha da planilha junto — nome, valor, produto. A
conciliação precisa deles, e eles não existem em nenhum outro lugar depois
que a planilha do dia sai de cena. Isso foi descoberto rodando: sem o valor,
os acertos do dia 2 caíram de 39 para 35, porque o desempate por valor e a
regra do pedido dividido deixam de funcionar.

### Regras

- **A planilha de hoje vence.** Mesmo pedido nos dois lugares: vale o da
  planilha, que é a correção do cliente.
- **`dias` conta dias distintos, não rodadas.** Rodar três vezes numa
  manhã não pode fazer um pedido parecer velho de três dias.
- **"Deixar para amanhã" é uma data**, não um sumiço: o pedido sai da lista
  de hoje e volta sozinho no dia marcado.
- **Sai da carteira só quando é escrito de verdade** — em dry-run nada é
  baixado.
- **Pendente há 5 dias ou mais é destacado na rodada.** Pedido que pena uma
  semana não vai se resolver sozinho; alguém precisa olhar.

### Medido

Simulação de dois dias com o ciclo real: dia 1 com a planilha de 40 pedidos,
dia 2 com uma planilha de **um** pedido. Os 38 pendentes voltaram sozinhos e
37 foram conciliados de novo. Sem a carteira, os 38 teriam sumido.

---

## 11. Toda pendência precisa de uma saída (2026-10-18)

A pergunta foi: *"ele aparece na tela; e aí, como ele resolve?"*. A resposta
era: não resolvia. O `#165091` tinha "deixar para amanhã" e, quando o robô
achava o cliente em outra conta, "usar esse" — que nos dados reais não
existia. O único caminho era adiar para sempre.

**Item sem saída é vazamento.** A carteira só cresce, o alerta de "pena há 6
dias" vira ruído, e em duas semanas ninguém abre mais a etapa 3.

### Os quatro desfechos

| | Quem decide | O que acontece |
|---|---|---|
| **resolvido** | robô | achou o rastreio e escreveu |
| **manual** | pessoa | tinha o código e colou |
| **conta** | pessoa | era outra conta — volta na próxima, com a certa |
| **encerrado** | pessoa | não vai receber rastreio: cancelado, reembolso, nunca comprado |

`conta` é o único que **não** baixa a pendência, e isso é de propósito: o
pedido ainda precisa ser achado, só que no lugar certo.

### A saída manual

É a mais importante, porque é universal: o robô não resolve tudo, e a pessoa
com o código na mão resolve em cinco segundos. Compra numa conta que ninguém
mapeou, rastreio que o fornecedor mandou no WhatsApp, Shopee fora do ar na
hora da coleta.

As proteções **mudam de dono, não somem**. Não existe lado Shopee para
comparar o nome, então quem confere é a pessoa — e por isso `prepararManual`
devolve o que está na Shopify (pedido, destinatário, CEP) para ela olhar
antes de confirmar. Escrever é um segundo passo, nunca o mesmo clique.

O resto continua valendo: número de pedido ilegível, texto sem código,
pedido que não existe na loja, pedido já despachado e código de simulação
são todos recusados — os três primeiros antes de tocar na rede.

### Medido

Contra a loja de teste: as cinco recusas com mensagem própria, e a escrita
real de `#1007` a partir do texto solto *"peguei no app da shopee:
BR260000000007X"*, confirmada como `FULFILLED` na Shopify.

### Três defeitos achados na auditoria da própria feature (2026-10-18)

Escrita a feature dos quatro desfechos, uma revisão dela encontrou três
problemas — dois deles perdas silenciosas, que é a categoria que mais custa
aqui.

**1. Pedido recusado pela Shopify sumia da carteira.** Quem decidia o que
baixar era `planejado`, a lista do que IA ser escrito. O pedido cuja escrita
falhava entrava na carteira pelo motivo `falha-ao-escrever` e saía na linha
seguinte — some no dia seguinte. É a mesma perda que a carteira existe para
impedir, entrando pela porta dos fundos. Agora `escreverRastreios` devolve
`gravados`, preenchido só depois de o `enviar()` dar certo.

**2. A correção de conta durava um dia.** "A planilha de hoje vence" é certo
para o nome e o valor, mas não para uma conta que o operador corrigiu na mão
— ele corrigiu justamente porque a planilha estava errada. Se o cliente
repetisse a linha, a correção era revertida em silêncio. A pendência passou a
carregar `contaCorrigida`, e só esse campo vence a planilha.

**3. `escreverManual` não baixava a pendência.** Quem chamasse teria que
lembrar de dois passos; o pedido voltaria no dia seguinte já despachado e
tomaria o motivo "já está FULFILLED". Existe agora `resolverManual`, que
prepara, escreve e baixa numa chamada só. O olho humano continua sendo um
passo à parte, por `confirmado: true`.

---

## 12. Conexão com o AdsPower na máquina do cliente (2026-10-18)

O cliente baixa o aplicativo e precisa configurar sozinho. São quatro coisas,
e **duas delas falham com o mesmo sintoma**:

| | Precisa |
|---|---|
| 1 | AdsPower instalado e **aberto** — a API só existe com ele rodando |
| 2 | **API local ligada** em Configurações |
| 3 | A **chave** copiada de lá e colada no nosso app |
| 4 | A **porta**, 50325 por padrão |

1 e 2 dão exatamente a mesma recusa de conexão. Sem separar um do outro, a
tela diz "não conectou" e ele liga para o suporte. Por isso existe
`diagnosticar()`, que devolve a etapa, o título em português e **o que fazer**
— e distingue programa fechado, chave recusada, plano sem listagem e limite
de requisições.

### Três coisas medidas, que mudam o que a tela pode dizer

**A Local API aceita ~1 requisição por segundo.** Duas chamadas seguidas
devolvem "Too many request per second" — o diagnóstico fazia exatamente isso
e reportava "resposta inesperada" sem motivo. Agora espera entre as chamadas
e tenta de novo.

**Esta instalação não valida a chave.** Responde igual com chave boa, chave
falsa e sem chave nenhuma. Então o diagnóstico **não diz** que a chave foi
aceita — ele lista só o que provou. Em instalações que exigem a chave, a
falha aparece como erro de autorização e é tratada.

**A API não devolve o total de perfis** numa página: só `list`, `page` e
`page_size`. Dizer "972 perfis" a partir de uma página de 1 seria inventar.
O número real sai da varredura completa, que a tela de Contas já faz.

### Para o dono da máquina saber

Com a API local ligada sem exigir chave, **qualquer programa naquele
computador pode abrir e dirigir os navegadores com as contas da Shopee**. Ela
só escuta em localhost, então não é exposição para a internet — mas é
informação que o dono merece ter. `apiAbertaSemChave()` detecta e a tela
avisa.

---

## 13. Cenário B: conectar a Shopify em dois cliques (2026-10-18)

Domínio comprado: **esteira.cloud**. O app passa a ser nosso, com custom
distribution, e o lojista conecta clicando — sem copiar chave nenhuma.

### O caminho

1. o aplicativo gera um `state` = `porta.nonce` e abre o navegador em
   `esteira.cloud/shopify/instalar`
2. o lojista vê a tela de permissões da Shopify e aprova
3. a Shopify volta em `esteira.cloud/shopify/callback`
4. o callback confere tudo e troca o `code` pelo token
5. devolve o token **por POST** para `127.0.0.1:<porta>/shopify/pronto`
6. o aplicativo grava na máquina e o servidor esquece

### O token nunca fica no nosso servidor

É a promessa que dá para fazer ao cliente com honestidade: a credencial da
loja dele vive só no computador dele.

Por isso **POST, e não redirecionamento com o token na URL** — URL vai para
o histórico do navegador e para o `Referer`.

### O que impede um link forjado de virar token

| | Onde | Por que existe |
|---|---|---|
| HMAC em tempo constante | servidor | sem ele, quem chamar a URL ganha um token |
| Formato `*.myshopify.com` | servidor | `shop=evil.com` faria a troca acontecer no servidor do atacante |
| `state` no formato certo | servidor | porta privilegiada e lixo são recusados |
| `state` **igual ao que esta máquina gerou** | aplicativo | uma página aberta no navegador consegue montar um POST; o nonce é o que ela não tem |
| `state` de uso único | aplicativo | repetir o retorno não reconecta |
| loja igual à pedida | aplicativo | impede trocar a loja no meio do caminho |

### Uma falha do teste, achada por mutação

Tirar a comparação do `state` no aplicativo **não derrubava a suíte**: o
state forjado do teste era malformado e morria numa checagem anterior. Um
state bem-formado e diferente — que é justamente o que uma página hostil
consegue montar — teria passado. O teste ganhou esse caso, e agora a mutação
é pega.

### Distribuição: pública não listada, não personalizada

A distribuição personalizada é **uma loja por app** — serve para um cliente
só. Como o plano é Matheus e depois mais dois, seriam três apps e três de
tudo. O certo é **pública**, e ela pode ser **não listada**: qualquer loja
instala pelo link direto, sem aparecer na busca da App Store e sem revisão
de vitrine.

O Dev Dashboard novo **não pede** o método na criação do app, nem o oferece
nas configurações. Ou seja: a escolha irreversível ainda não foi gasta. Ela
aparece quando for preciso, e aí já sabemos qual marcar.

### Hospedagem: Cloudflare Workers

A conta da Vercel está suspensa por falta de forma de pagamento, e não faz
sentido pagar por duas funções que rodam uma vez por cliente. O Worker faz
o mesmo de graça.

Isso obrigou a tirar o `node:crypto` do `validar.js` e usar **WebCrypto**,
que existe nos dois mundos. O ganho não é só portabilidade: o mesmo arquivo
roda no Worker e nos testes em Node, sem flag de compatibilidade e sem uma
segunda implementação das validações — que é exatamente o erro que este
projeto já pagou caro.

A troca de host custou a reescrita de um arquivo. Teria custado muito mais
se as validações estivessem espalhadas pelos handlers.

### Ainda falta

Mover os nameservers do domínio para a Cloudflare (a rota `esteira.cloud/*`
exige a zona lá), subir o worker, criar o app com distribuição pública e
exercitar contra a Shopify de verdade.

## Incidente 21/10/2026 — contas 125 e 150: "não achado na conta" que era sessão caída

**O que se viu:** na primeira rodada real da Esparta, os 12 pedidos das contas
125 e 150 apareceram como "não achado na conta". Os pedidos estavam lá (ex.:
#164902, R$ 20,99, conta 125).

**O que aconteceu de verdade** (pelos arquivos de coleta da máquina do Matheus):
a sessão da Shopee das duas contas tinha caído.
- 125: a página parou em `/verify/traffic/error?is_logged_in=false` ("Login
  Necessário"); toda lista respondeu `error: 90309999`.
- 150: toda lista respondeu **403** com `{ is_login: false, error: 90309999 }`,
  a página parada em `/user/purchase`.

**Três falhas em cadeia:**
1. O coletor só reconhecia "não logado" por `error: 19` ou pela URL de login. As
   formas novas passaram como **coleta com zero pedidos** — e ninguém foi ao
   login (o login automático só age em `/buyer/login`).
2. Coleta sem nenhuma lista respondendo era tratada como "a conta não tem
   pedidos", e a conferência acusou cada pedido de "não achado".
3. Conta **sem** coleta sumia da rodada (nem escrita, nem conferência, nem
   carteira), e a coleta de um dia antigo podia responder pela de hoje.

**O que mudou:** o coletor reconhece as formas novas e vai ao login (uma vez por
aba; se continuar bloqueado, "precisa de você"); "nenhuma lista respondeu" vira
`coleta-falhou`; conta não lida vira o motivo **"conta não foi lida"** para cada
pedido dela; a rodada apaga a coleta anterior das contas que vai abrir; a fila
espera o login e desiste na hora quando a conta já disse que não vai dar. Nome
grudado na planilha ("EduardoMafraCavalcanti") passa a casar.

**Prova:** `scripts/testar-sessao-caida.mjs` usa as respostas REAIS da Shopee
daquela rodada (`scripts/fixtures/coleta-sessao-caida-*.json`) e roda o
`extensao/coleta.js` de verdade. Contra o código antigo, falha exatamente nos
pontos do incidente; contra o novo, 34/34.

## 21/10/2026 — Rodada da Chomps com 24 de 33 contas sem leitura (v0.1.6)

Testado ao vivo, conta a conta, nas 33 contas da planilha do cliente
(`scripts/ao-vivo.mjs`, a partir do Mac do Gustavo, perfis do AdsPower
sincronizados). A leitura de pedidos estava certa: toda conta em que o robô
entrou bateu os rastreios. O que derrubava a rodada era o LOGIN, quando as
sessões caíam em massa:

- **Login em fila**: quem perdia a vez de logar desistia para sempre. Agora
  espera; a vez vale 2 min e é renovada antes de esperar o e-mail.
- **"Verificar Identidade"** (/verify/ivs) era tratado como "entrei" → loop de
  6 logins em 30 s → captcha. Agora o robô passa por ela sozinho (ver a
  memória do projeto e `extensao/login.js`): clica no `<button>` de verdade,
  ativa a caixa do inboxes antes, pega o link "aqui" do SendGrid e abre em
  OUTRA aba; espera a Shopee sair de /authenticate/ivs.
- **"Precisa de você"** fechava a janela em 2 s; agora fica aberta 10 min.
- **Cota da RapidAPI** (100/mês no grátis) acabou no meio: alerta no app.
- **Tentar de novo**: falha passageira volta ao fim da fila (até 3
  tentativas, pausa de 30 s, no máx. 2 logins por conta); falha que precisa de
  pessoa não repete. Alerta final com "Tentar de novo só essas".

Resultado: 14 contas lidas, 93 de 94 pedidos com rastreio (o 94º não está
na conta indicada pela planilha). As outras ficaram para a chave paga.

## 21/10/2026 (tarde) — v0.1.7: feedback do Matheus depois da 0.1.6

Plano e revisão em `PLANO-0.1.7.md`. O que mudou:

- **E-mail na caixa dado como "não chegou"** (conta 167: link às 16:01:38,
  robô desistiu às 16:04). O robô aceitava só e-mail com horário depois do
  pedido, e o horário vinha do relógio do Windows do cliente. Agora: foto da
  caixa antes do "Entrar" e aceita qualquer e-mail novo; pula os da Shopee
  sem link ("Novo login"); espera até 3 min com no máximo 13 consultas; cada
  consulta renova o prazo da fila; "Reenviar" uma vez; o erro diz se o
  relógio está adiantado.
- **Histórico**: o dia aberto não era refeito ao recarregar.
- **Achar a janela da conta**: aba "Shopee N" do AdsPower mantida, título
  "Conta N · …", e a janela vem para a frente em "precisa de você".
- **Progresso** na coleta (etapa 2) e na escrita (etapa 4), "Ver todos".
- **Avisos não somem** (7 dias), log em arquivo (14 dias), "Exportar
  diagnóstico" sem senha, chaves ou dados de cliente.

## 21/10/2026 — v0.1.8: cliente com vários pedidos na mesma conta

EDESIO (conta 162): #165172 R$ 36,56 e #165173 R$ 12,90 na planilha; compras
de R$ 34,80 e R$ 14,66 na Shopee. Nenhum valor bate sozinho, a soma bate. O
robô agora pareia pelo total do cliente quando o melhor pareamento é
claramente melhor (R$ 0,50 de folga); valores iguais ficam para a pessoa. Na
conferência: "Usar este e o outro" e "Usar os dois". Corrigido também o
envio duplicado de pedido em 2 linhas (2 produtos) e, na auditoria, o
segundo pedido escrito mesmo com o primeiro recusado.

## 21/10/2026 — v0.1.9: a conferência não mostra o que já foi resolvido

A conferência mostra a carteira (o que ficou da rodada anterior). Depois da
0.1.8 o EDESIO já era pareado pelo total, mas seguia em "dois candidatos".
Agora o que a conciliação de agora resolve sai da lista com um aviso e vai
para a etapa 4. O que a Shopify barrou continua. As etapas 3 e 4 são
refeitas ao serem abertas (antes, só no fim da rodada).

## 22/10/2026 — Feedback do Matheus depois da rodada de 2 dias juntos

**Conferência com pedido já resolvido.** Um pedido só saía da carteira quando o
robô escrevia ou alguém decidia na conferência. O que foi colado à mão na
Shopify ficava lá para sempre, e a etapa 4 só "pulava". Agora: ao abrir a
etapa 3 (e no botão "Conferir na Shopify e limpar"), a carteira inteira é
consultada na Shopify, só leitura, numa consulta por 20 pedidos. O que está
`FULFILLED` sai, com aviso e "Desfazer". Parcial fica. A etapa 4 também tira o
já atendido. Não há "limpar tudo" às cegas: apagaria pedidos ainda sem rastreio.

**Senha errada numa conta só (232).** O alerta dizia "a Shopee recusou a senha
das contas" e mandava para Ajustes. Agora, se outra conta entrou com a senha na
rodada, o alerta é da conta ("a senha da conta 232 é diferente da padrão"), com
o botão "Tentar de novo a conta 232", que põe a conta no fim da fila **desta**
rodada (`repetirNaRodada`). A pessoa agiu, então a conta ganha um login de novo
(`zerarLogins`). O alerta geral só aparece com 2+ recusas e nenhuma entrada.

**E-mail de verificação que não chega.** As caixas recebem normalmente (231 e
232, hoje, em menos de 1 min). Sem o diagnóstico da rodada não dá para dizer
se a Shopee segurou o envio ou se a caixa não recebeu. Mudou: o robô olha a
caixa em 3 pedaços de 3 min (~10 min, o tempo da janela), não numa espera só,
porque o Chrome mata o service worker aos 5 min. Se não chegar, é falha
passageira com os horários no motivo; a conta volta para o fim da fila depois
de 15 min (`PAUSA_EMAIL_MS`), uma vez só (2 tentativas = os 2 logins da rodada).

Testes: `testar-feedback-22-10.mjs` (provado por mutação: 6 defeitos plantados,
6 pegos) e `ensaio-feedback.mjs` (janela de verdade, ponte, carteira, coletor
e fila de verdade).

**Publicado como v0.1.10.** Mais um cenário fixo: a conta que falhou e foi
lida depois sai da conferência ("conta não foi lida" → resolvido → etapa 4).
`npm test`: 772 verificações; ensaios de janela: 128.

## 22/10/2026 — v0.1.11: o freio dos logins (diagnóstico da rodada de 21/10)

**O que o diagnóstico mostrou.** Não era a caixa nem o robô: era volume. Às
18h30, 23 verificações e todas certas; depois de ~35 numa hora, os e-mails da
Shopee passaram a chegar com 15-30 min de atraso ou nunca (19h30-22h30: 53 de
74 falharam); às 23h, 19 de 19 certas. A 246 recebeu o link às 19:40:48, 6 s
antes de a janela fechar; a 222 nunca recebeu. Das 55 contas que falharam,
45 passaram mais tarde. Se é a Shopee ou o caminho até o givmail que segura,
os dados não dizem — a resposta é a mesma.

**O que mudou** (`src/freio-email.mjs`, conferido na trava de login do
coletor, só quando a conta GANHA a vez):
- ritmo: no máximo 25 logins por hora (`LIMITE_LOGINS_HORA`);
- freio: 2 e-mails seguidos que não chegam pausam os logins 45 min
  (`PAUSA_FREIO_MS`); depois, uma conta de teste decide se volta; alerta
  "Os e-mails da Shopee pararam de chegar", que some sozinho;
- conta barrada pelo freio não loga (o `login.js` nem pede a senha) e volta
  para a fila na hora certa, sem gastar tentativa — "login pausado · volta às";
- contas cuja última tentativa terminou sem entrar vão para o fim da fila:
  as de sessão viva são lidas primeiro, sem depender de e-mail.
O estado do freio fica em arquivo: reabrir o app não solta a pausa.

**Furo antigo achado pelo ensaio:** com "Parar", a conta que esperava a 2ª
tentativa sumia do resultado (e do "Tentar de novo só essas"). Agora toda conta
que já foi aberta e não foi lida aparece como não lida.

Testes: `testar-freio.mjs` (mutação: 9 defeitos plantados; o único não pego
era código redundante, removido) e `ensaio-freio.mjs`. `npm test`: 806;
ensaios: 133.
