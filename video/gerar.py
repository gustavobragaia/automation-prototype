# Gera o vídeo do fluxo com as saídas REAIS capturadas:
# log da rodada, JSON extraído da Shopee, fulfillment da Shopify,
# linha da planilha e captura do painel.
import json, math, os, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont
import imageio.v2 as imageio

W, H, FPS = 1440, 810, 24
BASE = os.path.dirname(os.path.abspath(__file__))

G   = (18, 22, 21)       # fundo
S   = (26, 32, 31)       # superfície
L   = (44, 52, 50)       # linha
I   = (232, 236, 231)    # texto
M   = (150, 162, 158)    # texto suave
A   = (87, 184, 170)     # acento
AM  = (226, 160, 92)     # humano
VM  = (225, 133, 101)

def f(path, size, idx=0):
    return ImageFont.truetype(path, size, index=idx)
MONO   = lambda s: f("/System/Library/Fonts/Menlo.ttc", s)
UI     = lambda s: f("/System/Library/Fonts/HelveticaNeue.ttc", s, 0) if os.path.exists("/System/Library/Fonts/HelveticaNeue.ttc") else f("/System/Library/Fonts/Helvetica.ttc", s, 0)
UIB    = lambda s: f("/System/Library/Fonts/Helvetica.ttc", s, 1)

def base_frame():
    im = Image.new("RGB", (W, H), G)
    return im, ImageDraw.Draw(im)

def cabecalho(d, passo, total, titulo, humano=False):
    d.rectangle([0, 0, W, 92], fill=S)
    d.line([(0, 92), (W, 92)], fill=L)
    d.text((48, 26), f"PASSO {passo}/{total}", font=MONO(16), fill=A if not humano else AM)
    d.text((48, 50), titulo, font=UIB(26), fill=I)
    tag = "HUMANO" if humano else "AUTOMATICO"
    cor = AM if humano else A
    fo = MONO(15)
    tw = d.textlength(tag, font=fo)
    x0 = W - 48 - tw - 26
    d.rounded_rectangle([x0, 34, W - 48, 64], 4, outline=cor, width=2)
    d.text((x0 + 13, 41), tag, font=fo, fill=cor)

def rodape(d, texto):
    d.line([(0, H - 62), (W, H - 62)], fill=L)
    d.text((48, H - 44), texto, font=UI(17), fill=M)

def janela(d, x, y, w, h, titulo):
    d.rounded_rectangle([x, y, x + w, y + h], 8, fill=S, outline=L)
    d.rounded_rectangle([x, y, x + w, y + 34], 8, fill=(34, 41, 40), outline=L)
    d.rectangle([x, y + 26, x + w, y + 34], fill=(34, 41, 40))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 16 + i * 20, y + 12, x + 26 + i * 20, y + 22], fill=c)
    d.text((x + 90, y + 10), titulo, font=MONO(14), fill=M)

def termo(d, x, y, w, h, linhas, titulo="terminal", cursor=True):
    janela(d, x, y, w, h, titulo)
    fo = MONO(17)
    ty = y + 50
    for ln in linhas[-18:]:
        cor = I
        if ln.startswith("$"): cor = A
        elif "ALARME" in ln or "FALHOU" in ln or "ERRO" in ln: cor = VM
        elif ln.strip().startswith(("11:", "✓")): cor = M
        d.text((x + 24, ty), ln[:96], font=fo, fill=cor)
        ty += 25
    if cursor and linhas:
        lw = d.textlength(linhas[-1][:96], font=fo)
        d.rectangle([x + 24 + lw + 3, ty - 25, x + 24 + lw + 12, ty - 7], fill=A)

def caixa_json(d, x, y, w, h, titulo, pares, destaque=()):
    janela(d, x, y, w, h, titulo)
    ty = y + 52
    for k, v in pares:
        d.text((x + 24, ty), k, font=MONO(16), fill=M)
        cor = A if k in destaque else I
        d.text((x + 300, ty), str(v)[:60], font=MONO(16), fill=cor)
        ty += 29

def escrever(frames, im, segundos):
    for _ in range(int(FPS * segundos)):
        frames.append(im)

frames = []

# dados reais
log = [l.rstrip() for l in open(f"{BASE}/log-rodada-ok.txt", encoding="utf-8")]
shp = json.load(open(f"{BASE}/shopify.json", encoding="utf-8"))
ped = json.load(open(f"{BASE}/pedido.json", encoding="utf-8"))

# ───────────────────────── abertura
for k in range(int(FPS * 2.4)):
    im, d = base_frame()
    a = min(1, k / (FPS * 0.7))
    c = tuple(int(x * a) for x in I)
    d.text((W // 2, H // 2 - 70), "Rastreios Shopee → Shopify", font=UIB(52), fill=c, anchor="mm")
    if k > FPS * 0.6:
        b = min(1, (k - FPS * 0.6) / (FPS * 0.6))
        d.text((W // 2, H // 2 + 2), "do pedido na Shopee ao rastreio na loja, sem ninguém copiando código",
               font=UI(23), fill=tuple(int(x * b) for x in M), anchor="mm")
    if k > FPS * 1.3:
        d.text((W // 2, H // 2 + 72), "demonstração com dados reais · 14/10/2026", font=MONO(17), fill=A, anchor="mm")
    frames.append(im)

# ───────────────────────── passo 1: um comando
linhas = ["$ npm start"]
for k in range(int(FPS * 2.2)):
    im, d = base_frame()
    cabecalho(d, 1, 7, "Um comando inicia tudo")
    n = min(len(linhas[0]), int(k / (FPS * 0.9) * len(linhas[0])) + 1)
    termo(d, 90, 150, W - 180, 500, [linhas[0][:n]])
    rodape(d, "Antes eram três comandos em dois terminais. O coletor sobe dentro do mesmo processo.")
    frames.append(im)

# ───────────────────────── passo 2: rodada rodando (log real, linha a linha)
acum = ["$ npm start"]
for i, ln in enumerate(log):
    for k in range(int(FPS * 0.55)):
        im, d = base_frame()
        cabecalho(d, 2, 7, "O robô abre o perfil e lê a Shopee")
        termo(d, 90, 150, W - 180, 500, acum + [ln])
        rodape(d, "AdsPower abre o perfil · extensão lê os pedidos por dentro da página · nada de CDP")
        frames.append(im)
    acum.append(ln)
im, d = base_frame(); cabecalho(d, 2, 7, "O robô abre o perfil e lê a Shopee")
termo(d, 90, 150, W - 180, 500, acum)
rodape(d, "27 segundos, do zero ao fim, sem ninguém tocar em nada.")
escrever(frames, im, 1.6)

# ───────────────────────── passo 3: dados extraídos
pares = [("nome", ped["nome"]), ("cep", ped["cep"]), ("endereco", ped["endereco"][:46]),
         ("valor", f'R$ {ped["valor"]}'), ("produto", ped["produto"][:46]),
         ("transportadora", ped["transportadora"]), ("tracking_number", '"" (ainda não despachado)')]
for passo_k in range(int(FPS * 4.2)):
    im, d = base_frame()
    cabecalho(d, 3, 7, "O que foi lido do pedido real")
    vis = pares[: max(1, int(passo_k / (FPS * 0.42)) + 1)]
    caixa_json(d, 90, 150, W - 180, 470, "pedido 245683099198904 · conta shopee 002", vis,
               destaque=("nome", "cep", "valor"))
    rodape(d, "Nome e CEP vêm do endereço de entrega — é o que permite não trocar o rastreio de cliente.")
    frames.append(im)

# ───────────────────────── passo 4: casamento
for k in range(int(FPS * 4.6)):
    im, d = base_frame()
    cabecalho(d, 4, 7, "Casando com o pedido certo na Shopify")
    janela(d, 90, 150, W - 180, 470, "casamento")
    y = 215
    etapas = [
        ("por nome  \"Gustavo Bragaia\"", "2 candidatos", VM, 0.0),
        ("+ CEP  13424165", "1 candidato", A, 1.1),
        ("+ valor  R$ 4,31", "confirma", A, 2.2),
        ("→ Shopify #1001", "identificado", A, 3.3),
    ]
    for txt, res, cor, t in etapas:
        if k / FPS >= t:
            d.text((140, y), txt, font=MONO(21), fill=I)
            d.text((W - 300, y), res, font=MONO(20), fill=cor)
            y += 64
    if k / FPS >= 4.0:
        d.text((140, y + 14), "em dúvida, não escreve: vai para revisão humana", font=UI(19), fill=AM)
    rodape(d, "Na planilha antiga, 2.217 clientes têm nome repetido. Sem CEP, o rastreio vai para o cliente errado.")
    frames.append(im)

# ───────────────────────── passo 5: shopify
fu = shp["fulfillments"][0]
pares2 = [("pedido", shp["name"]), ("status", shp["displayFulfillmentStatus"]),
          ("fulfillment", fu["status"]), ("rastreio", fu["trackingInfo"][0]["number"]),
          ("transportadora", fu["trackingInfo"][0]["company"]), ("criado em", fu["createdAt"])]
for k in range(int(FPS * 4.0)):
    im, d = base_frame()
    cabecalho(d, 5, 7, "Rastreio escrito na Shopify")
    caixa_json(d, 90, 150, W - 180, 430, "consulta à API da loja, agora", pares2[: max(1, int(k / (FPS * 0.45)) + 1)],
               destaque=("status", "rastreio"))
    if k / FPS > 3.0:
        d.text((112, 620), "o pedido consta FULFILLED na loja — escrita real, não simulação",
               font=UI(20), fill=A)
    rodape(d, "Único dado inventado em toda a demonstração: o código, porque o vendedor ainda não despachou.")
    frames.append(im)

# ───────────────────────── passo 6: planilha
im, d = base_frame()
cabecalho(d, 6, 7, "A planilha, no formato de hoje")
janela(d, 60, 150, W - 120, 300, "pedidos-2026-10-14.xlsx")
cols = ["DATA", "PEDIDO", "CLIENTE", "PRODUTO", "UN", "VALOR", "RASTREIO", "CONTA", "CEP"]
vals = ["2026-10-14", "#1001", "Gustavo Bragaia", "10 Pares De Cílios…", "1", "4.31",
        "BR269999999999S", "shopee 002", "13424165"]
xs = [85, 215, 320, 510, 715, 760, 845, 1035, 1180]
d.rectangle([60, 196, W - 60, 232], fill=(34, 41, 40))
for x, c in zip(xs, cols): d.text((x, 206), c, font=MONO(14), fill=M)
for x, v in zip(xs, vals): d.text((x, 252), v, font=MONO(15), fill=I)
rodape(d, "Mesmo formato da planilha que a equipe já usa. Arquivo novo: a planilha mestre nunca é sobrescrita.")
escrever(frames, im, 3.4)

# ───────────────────────── passo 7: painel + humano
painel_orig = Image.open(f"{BASE}/painel.png").convert("RGB")
OW, OH = painel_orig.size
PH = 520                          # altura que sobra entre cabeçalho e legenda
PW = int(OW * PH / OH)
PX, PY = (W - PW) // 2, 116
painel = painel_orig.resize((PW, PH), Image.LANCZOS)
esc_p = PW / OW                   # fator para mapear coordenadas do print

def por_painel(im):
    im.paste(painel, (PX, PY))
    ImageDraw.Draw(im).rectangle([PX, PY, PX + PW, PY + PH], outline=L)

im, d = base_frame()
cabecalho(d, 7, 7, "O painel — e onde entra a pessoa", humano=True)
por_painel(im)
d = ImageDraw.Draw(im)
rodape(d, "http://127.0.0.1:4000 · atualiza sozinho · o humano só olha aqui")
escrever(frames, im, 3.6)

# a faixa vermelha do painel é um alarme de verdade — vale mostrar
ALERTA = (132, 110, 1228, 152)    # bbox medido no próprio print
im, d = base_frame()
cabecalho(d, 7, 7, "A faixa vermelha ali é um alarme real", humano=True)
por_painel(im)
d = ImageDraw.Draw(im)
d.rounded_rectangle(
    [PX + ALERTA[0] * esc_p - 6, PY + ALERTA[1] * esc_p - 6,
     PX + ALERTA[2] * esc_p + 6, PY + ALERTA[3] * esc_p + 6], 6, outline=VM, width=3)
d.text((PX, PY + PH + 34), "Bati no limite diário de aberturas do plano gratuito do AdsPower, depois de", font=UI(21), fill=I)
d.text((PX, PY + PH + 64), "dezenas de testes. O robô avisou — em vez de dizer \u0022nenhum pedido novo\u0022.", font=UI(21), fill=I)
rodape(d, "Falha silenciosa é o pior defeito deste tipo de robô. Por isso ele grita.")
escrever(frames, im, 5.0)

# passo humano explicado
pontos = [
    ("Pedido em dúvida", "homônimo não resolvido, ou rastreio em formato estranho"),
    ("Verificação da Shopee", "quando aparece, o robô pausa a conta e chama alguém"),
    ("Resolver e dispensar", "um clique, e as outras contas seguem rodando sozinhas"),
]
for k in range(int(FPS * 5.0)):
    im, d = base_frame()
    cabecalho(d, 7, 7, "O que exige uma pessoa", humano=True)
    y = 200
    for i, (t, s) in enumerate(pontos):
        if k / FPS >= i * 1.1:
            d.rounded_rectangle([110, y, W - 110, y + 110], 6, fill=S, outline=L)
            d.ellipse([140, y + 44, 158, y + 62], fill=AM)
            d.text((186, y + 28), t, font=UIB(25), fill=I)
            d.text((186, y + 64), s, font=UI(19), fill=M)
            y += 134
    rodape(d, "Nada de contornar verificação por software: quando a Shopee desconfia, quem resolve é gente.")
    frames.append(im)

# ───────────────────────── fecho
im, d = base_frame()
d.text((W // 2, H // 2 - 96), "7 passos · 1 pessoa em 1 deles", font=UIB(44), fill=I, anchor="mm")
y = H // 2 - 26
for t, c in [("perfil aberto, pedidos lidos, rastreio extraído", A),
             ("casado por nome + CEP + valor", A),
             ("escrito na Shopify e na planilha", A),
             ("revisão e verificação da Shopee", AM)]:
    d.ellipse([W // 2 - 300, y + 6, W // 2 - 288, y + 18], fill=c)
    d.text((W // 2 - 268, y), t, font=UI(22), fill=I)
    y += 44
d.text((W // 2, H - 120), "300 pedidos/dia · 700 contas · 2 a 3 rodadas por dia", font=MONO(19), fill=M, anchor="mm")
escrever(frames, im, 4.0)

saida = f"{BASE}/rastreios-shopee-shopify.mp4"
imageio.mimwrite(saida, frames, fps=FPS, codec="libx264", quality=8,
                 macro_block_size=1, ffmpeg_log_level="error")
print(f"{len(frames)} quadros · {len(frames)/FPS:.1f}s · {saida}")
