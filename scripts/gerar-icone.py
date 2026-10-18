"""Gera o ícone do Esteira: uma caixa sobre a esteira. Fonte única — nunca
editar PNG à mão; se a marca mudar, muda aqui e roda de novo.

    python3 scripts/gerar-icone.py        (requer Pillow; no Mac, gera o .icns)

Na grade de ícone do macOS:
  · tela de 1024, a forma ocupa 824 com 100 de margem — a versão anterior
    preenchia a tela inteira, e no Dock parecia um espaço reservado ao lado
    dos outros ícones;
  · a forma é uma SUPERELIPSE (n=5), não um quadrado de cantos redondos:
    é a curva "contínua" dos ícones da Apple;
  · sombra embaixo, degradê, e um brilho sutil no topo.

O símbolo é o da marca do app: a caixa, e a esteira em pílula com os dois
roletes por dentro. A versão anterior era cheia porque, com traço FINO, a
pílula fechava num borrão em 64px. Com o traço proporcionado (1,3 da grade
de 24) e roletes menores que o vão, os roletes continuam visíveis até 24px —
comparado lado a lado no tamanho real antes da escolha.

Cor: o roxo da marca (#5B4BC4) em degradê, de #8079FF a #4A3EE6. Não é
verde/âmbar/vermelho de propósito: essas três significam ESTADO no produto.
"""
from pathlib import Path
import math, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
S = 4                                  # desenha em 4x e reduz: bordas suaves
L = 1024 * S

def superelipse(x, y, lado, n=5, pontos=720):
    a = lado / 2; cx = x + a; cy = y + a; ps = []
    for i in range(pontos):
        t = 2 * math.pi * i / pontos; c, s = math.cos(t), math.sin(t)
        ps.append((cx + a * math.copysign(abs(c) ** (2 / n), c),
                   cy + a * math.copysign(abs(s) ** (2 / n), s)))
    return ps

def mascara(poligono):
    m = Image.new("L", (L, L), 0); ImageDraw.Draw(m).polygon(poligono, fill=255); return m

def sombra(alfa, dy, desfoque, opacidade):
    a = alfa.point(lambda v: int(v * opacidade))
    a = a.transform(a.size, Image.AFFINE, (1, 0, 0, 0, 1, -dy * S)).filter(ImageFilter.GaussianBlur(desfoque * S))
    preto = Image.new("RGBA", (L, L), (0, 0, 0, 0)); preto.putalpha(a); return preto

def degrade(topo, base, alto, baixo):
    g = Image.new("RGBA", (L, L))
    d = ImageDraw.Draw(g)
    for y in range(L):
        f = min(1, max(0, (y - alto) / (baixo - alto)))
        d.line([(0, y), (L, y)], fill=tuple(int(topo[i] + (base[i] - topo[i]) * f) for i in range(3)) + (255,))
    return g

hexa = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
forma = superelipse(100 * S, 100 * S, 824 * S)
m = mascara(forma)

icone = Image.new("RGBA", (L, L), (0, 0, 0, 0))
icone.alpha_composite(sombra(m, 12, 14, .30))
fundo = degrade(hexa("#8079FF"), hexa("#4A3EE6"), 100 * S, 924 * S); fundo.putalpha(m)
icone.alpha_composite(fundo)
brilho = Image.new("RGBA", (L, L), (255, 255, 255, 0)); bd = ImageDraw.Draw(brilho)
for y in range(100 * S, int(100 * S + 824 * S * .55)):
    f = 1 - (y - 100 * S) / (824 * S * .55)
    bd.line([(0, y), (L, y)], fill=(255, 255, 255, int(255 * .20 * f)))
brilho.putalpha(Image.composite(brilho.getchannel("A"), Image.new("L", (L, L), 0), m))
icone.alpha_composite(brilho)
borda = Image.new("RGBA", (L, L), (0, 0, 0, 0))
ImageDraw.Draw(borda).line(forma + [forma[0]], fill=(255, 255, 255, 31), width=2 * S)
icone.alpha_composite(borda)

# o símbolo, na grade de 24 do app, ampliado em torno do centro
u = 30 * S; ox = 512 * S - 12 * u; oy = 520 * S - 12.8 * u
X = lambda v: ox + v * u; Y = lambda v: oy + v * u
traco = 1.3 * u
simbolo = Image.new("L", (L, L), 0); sd = ImageDraw.Draw(simbolo)
sd.rounded_rectangle([X(8), Y(5.5), X(16), Y(12.5)], radius=1.6 * u, fill=255)            # a caixa
sd.rounded_rectangle([X(2.9), Y(14.9), X(21.1), Y(20.1)], radius=2.6 * u, fill=255)        # a pílula...
sd.rounded_rectangle([X(2.9) + traco, Y(14.9) + traco, X(21.1) - traco, Y(20.1) - traco],
                     radius=2.6 * u - traco, fill=0)                                        # ...vazada
for cx in (5.5, 18.5):                                                                      # os roletes
    r = 0.72 * u; sd.ellipse([X(cx) - r, Y(17.5) - r, X(cx) + r, Y(17.5) + r], fill=255)
icone.alpha_composite(sombra(simbolo, 8, 9, .22))
branco = Image.new("RGBA", (L, L), (255, 255, 255, 0)); branco.putalpha(simbolo)
icone.alpha_composite(branco)

final = icone.resize((1024, 1024), Image.LANCZOS)

marca = RAIZ / "marca"; app = RAIZ / "aplicativo" / "marca"
app.mkdir(parents=True, exist_ok=True)
for px in (32, 64, 128, 512):
    final.resize((px, px), Image.LANCZOS).save(marca / f"esteira-{px}.png")
icone.resize((1200, 1200), Image.LANCZOS).save(marca / "esteira-1200.png")
final.save(app / "icon.png")

# o .icns, com todos os tamanhos que o macOS pede — cada um reduzido do grande
if sys.platform == "darwin":
    conj = RAIZ / "aplicativo" / "marca" / "Esteira.iconset"
    shutil.rmtree(conj, ignore_errors=True); conj.mkdir()
    for px in (16, 32, 128, 256, 512):
        final.resize((px, px), Image.LANCZOS).save(conj / f"icon_{px}x{px}.png")
        final.resize((px * 2, px * 2), Image.LANCZOS).save(conj / f"icon_{px}x{px}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(conj), "-o", str(app / "icon.icns")], check=True)
    shutil.rmtree(conj)
print("ícone gerado: marca/esteira-*.png, aplicativo/marca/icon.png e icon.icns")
