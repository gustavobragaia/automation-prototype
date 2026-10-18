# A marca do Esteira

Uma caixa sobre a esteira. Gerado por `scripts/gerar-icone.py` — nunca
editado à mão, para não divergir. Ele escreve os PNGs desta pasta e o
`aplicativo/marca/icon.icns` que vai no instalador.

## Duas versões, de propósito

**No aplicativo** (`esteira.html`, barra lateral) a marca é de **contorno**:
roletes vazados e duas linhas de lona, que ainda animam quando a rodada
roda. Funciona porque ali ela aparece a 18px com traço fino.

**No ícone** a esteira é a mesma pílula com os dois roletes por dentro,
em branco e com traço mais grosso. A versão anterior do ícone era cheia
porque, com traço FINO, a pílula fechava num borrão em 64px. O que resolveu
foi o traço proporcionado (1,3 na grade de 24) e roletes menores que o vão:
eles continuam visíveis até 24px. Comparado lado a lado no tamanho real — a
versão cheia perdia: a esteira virava uma barra com um rasgo.

## A forma do ícone

Segue a grade do macOS: tela de 1024, forma de 824 com 100 de margem, em
**superelipse** (a curva contínua da Apple, não um quadrado de cantos
redondos), com sombra, degradê e brilho no topo. A versão anterior preenchia
a tela inteira sem cantos, e no Dock parecia um espaço reservado ao lado dos
outros ícones.

## Cor

`#5B4BC4`, o mesmo roxo do tema claro do aplicativo — no ícone, em degradê
de `#8079FF` a `#4A3EE6` em volta dele. Não é verde nem âmbar
nem vermelho de propósito: essas três cores significam estado dentro do
produto, e a marca não pode competir com elas.
