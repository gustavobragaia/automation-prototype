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

## 4. De onde vem o mapeamento pedido → conta (2026-10-15)

A planilha **não** é a ponte entre Shopee e Shopify: a ponte é o endereço de
entrega (nome + CEP), medido em 97,6% de identificação única contra os 19.975
pedidos reais. A planilha só **estreita a busca**, dizendo em qual das 700
contas procurar.

Por isso não existem duas versões do produto, e sim uma fonte com três níveis:

```
1. banco      — mapeamento que o robô aprendeu sozinho    (preferido)
2. planilha   — enquanto o banco não cobre                 (apoio)
3. varredura  — quando nenhum dos dois sabe                (último recurso)
```

Toda vez que o robô encontra um pedido numa conta, grava a associação. A
cobertura do banco cresce sozinha; quando chegar perto de 100%, a planilha deixa
de ser lida e passa a ser **só saída** — o robô preenche a coluna da conta em
vez de consultá-la.

Uma tela mostra a cobertura ("78% do mapeamento vem do banco") para a troca ser
uma decisão com número, não um palpite.
