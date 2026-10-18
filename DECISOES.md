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
