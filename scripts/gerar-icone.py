"""Gera o ícone do Esteira: uma caixa sobre a esteira.

Por que CHEIO e não contorno, como a marca dentro do aplicativo: a versão de
contorno (roletes vazados, duas linhas de lona) funciona a 18px com traço
fino, mas em 64px os roletes encostam na lona e o conjunto fecha numa
cápsula — vira um borrão. Comparado lado a lado no tamanho real antes de
escolher. Ícone simplificado em relação à marca é o normal.

    python3 scripts/gerar-icone.py
"""
from PIL import Image, ImageDraw
from pathlib import Path

S = 4                        # desenha em 4x e reduz: bordas suaves
LADO = 1200 * S
ROXO = (91, 75, 196)         # #5B4BC4, o roxo do tema claro do app.
BRANCO = (255, 255, 255)     # Não é verde/âmbar/vermelho de propósito:
                             # essas três significam ESTADO no produto.

img = Image.new("RGB", (LADO, LADO), ROXO)
d = ImageDraw.Draw(img)

GLIFO = 720 * S              # 60% do lado, deixa respiro nas bordas
u = GLIFO / 24               # uma unidade do viewBox de 24 do app
off = (LADO - GLIFO) / 2
f = lambda v: off + v * u

# roletes: discos nas pontas. São eles que fazem ler "esteira" em vez de
# "caixa em cima de uma linha".
for cx in (5.0, 19.0):
    r = 2.4 * u
    d.ellipse([f(cx) - r, f(17.6) - r, f(cx) + r, f(17.6) + r], fill=BRANCO)

d.rounded_rectangle([f(5.0), f(16.0), f(19.0), f(19.2)], radius=1.6 * u, fill=BRANCO)
d.rounded_rectangle([f(8.6), f(6.0), f(15.4), f(12.8)], radius=1.3 * u, fill=BRANCO)

saida = Path("marca"); saida.mkdir(exist_ok=True)
final = img.resize((1200, 1200), Image.LANCZOS)
final.save(saida / "esteira-1200.png")
for t in (512, 128, 64, 32):
    final.resize((t, t), Image.LANCZOS).save(saida / f"esteira-{t}.png")
print("marca/: " + ", ".join(sorted(p.name for p in saida.glob("*.png"))))
