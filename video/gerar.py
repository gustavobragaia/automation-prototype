# Vídeo da demonstração: Shopee -> código -> Shopify -> painel.
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio.v2 as imageio

W, H, FPS = 1440, 810, 24
B = os.path.dirname(os.path.abspath(__file__))
G,S,L,I,M,A,AM,VM = (18,22,21),(26,32,31),(44,52,50),(232,236,231),(150,162,158),(87,184,170),(226,160,92),(225,133,101)

MONO = lambda s: ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", s)
UI   = lambda s: ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", s, index=0)
UIB  = lambda s: ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", s, index=1)

def novo():
    im = Image.new("RGB", (W, H), G); return im, ImageDraw.Draw(im)

def cab(d, passo, titulo, humano=False):
    d.rectangle([0,0,W,88], fill=S); d.line([(0,88),(W,88)], fill=L)
    d.text((48,24), f"PASSO {passo}/6", font=MONO(15), fill=AM if humano else A)
    d.text((48,47), titulo, font=UIB(25), fill=I)
    tag = "HUMANO" if humano else "AUTOMATICO"; cor = AM if humano else A
    fo = MONO(14); tw = d.textlength(tag, font=fo); x0 = W-48-tw-24
    d.rounded_rectangle([x0,32,W-48,60], 4, outline=cor, width=2)
    d.text((x0+12,38), tag, font=fo, fill=cor)

def pe(d, t): d.line([(0,H-58),(W,H-58)], fill=L); d.text((48,H-41), t, font=UI(17), fill=M)

def tela(nome, largura):
    im = Image.open(f"{B}/{nome}").convert("RGB")
    return im.resize((largura, int(im.height*largura/im.width)), Image.LANCZOS)

def por(im, foto, y, borda=L):
    x = (W - foto.width)//2
    im.paste(foto, (x, y))
    ImageDraw.Draw(im).rectangle([x,y,x+foto.width,y+foto.height], outline=borda)
    return x, y

def seg(frames, im, s):
    for _ in range(int(FPS*s)): frames.append(im)

frames = []
LARG = 1240
shopee  = tela("shopee.png", LARG)
sf_a    = tela("shopify-antes.png", LARG)
sf_d    = tela("shopify-depois.png", LARG)
painel  = tela("painel.png", LARG)

# ── abertura
for k in range(int(FPS*2.4)):
    im, d = novo()
    a = min(1, k/(FPS*0.6))
    d.text((W//2, H//2-66), "Rastreios Shopee → Shopify", font=UIB(50), fill=tuple(int(x*a) for x in I), anchor="mm")
    if k > FPS*0.5:
        b = min(1,(k-FPS*0.5)/(FPS*0.6))
        d.text((W//2, H//2+4), "do código na Shopee ao rastreio na loja, sem ninguém copiando nada",
               font=UI(23), fill=tuple(int(x*b) for x in M), anchor="mm")
    if k > FPS*1.3:
        d.text((W//2, H//2+76), "1 comando · 27 segundos · 1 pessoa em 1 passo", font=MONO(18), fill=A, anchor="mm")
    frames.append(im)

# ── 1 comando
alvo = "$ npm start"
for k in range(int(FPS*2.0)):
    im, d = novo(); cab(d, 1, "Um comando inicia tudo")
    n = min(len(alvo), int(k/(FPS*0.8)*len(alvo))+1)
    d.rounded_rectangle([110,170,W-110,620], 8, fill=S, outline=L)
    d.rounded_rectangle([110,170,W-110,204], 8, fill=(34,41,40), outline=L)
    d.rectangle([110,196,W-110,204], fill=(34,41,40))
    for i,c in enumerate([(255,95,86),(255,189,46),(39,201,63)]):
        d.ellipse([136+i*20,180,146+i*20,190], fill=c)
    d.text((140,224), alvo[:n], font=MONO(21), fill=A)
    if n == len(alvo) and (k//6)%2==0: d.rectangle([140+d.textlength(alvo,font=MONO(21))+4,224,152+d.textlength(alvo,font=MONO(21)),248], fill=A)
    pe(d, "Sobe o coletor, abre os perfis e roda sozinho às 9h, 14h e 18h.")
    frames.append(im)

# ── 2 shopee abre
for k in range(int(FPS*1.0)):
    im, d = novo(); cab(d, 2, "O robô abre a conta na Shopee")
    f = min(1, k/(FPS*0.7))
    h = max(1, int(shopee.height*f)); rec = shopee.crop((0,0,LARG,h))
    por(im, rec, 128)
    pe(ImageDraw.Draw(im), "Perfil do AdsPower · conta shopee 002 · a sessão já está aberta, não precisa logar")
    frames.append(im)
im, d = novo(); cab(d, 2, "O robô abre a conta na Shopee")
por(im, shopee, 128); pe(ImageDraw.Draw(im), "Perfil do AdsPower · conta shopee 002 · a sessão já está aberta, não precisa logar")
seg(frames, im, 2.4)

# ── 3 pega o código (destaque pulsando sobre a caixa de rastreio)
esc = LARG/1360
cx0, cy0, cx1, cy1 = [int(v*esc) for v in (300, 272, 1280, 352)]
px, py = (W-LARG)//2, 128
for k in range(int(FPS*4.4)):
    im, d = novo(); cab(d, 3, "Lê o código de rastreio do pedido")
    por(im, shopee, py)
    d = ImageDraw.Draw(im)
    # escurece tudo menos a caixa
    if k > FPS*0.5:
        a = min(130, int((k-FPS*0.5)/(FPS*0.5)*130))
        veu = Image.new("RGBA",(W,H),(10,12,12,a))
        rec = shopee.crop((cx0,cy0,cx1,cy1))
        im.paste(Image.alpha_composite(im.convert("RGBA"), veu).convert("RGB"),(0,0))
        im.paste(rec,(px+cx0,py+cy0))
        d = ImageDraw.Draw(im)
        pulso = 2 + int(2*abs(((k//3)%6)-3)/3)
        d.rounded_rectangle([px+cx0-5,py+cy0-5,px+cx1+5,py+cy1+5], 6, outline=A, width=pulso)
    if k > FPS*2.0:
        d.text((px, py+shopee.height+30), "BR269999999999S", font=MONO(34), fill=A)
        d.text((px+330, py+shopee.height+40), "→ extraído direto da resposta da Shopee", font=UI(20), fill=M)
    pe(d, "A extensão lê por dentro da página. Nada é digitado, nada é copiado à mão.")
    frames.append(im)

# ── 4 casamento
for k in range(int(FPS*4.4)):
    im, d = novo(); cab(d, 4, "Acha o pedido certo na loja")
    d.rounded_rectangle([110,150,W-110,600], 8, fill=S, outline=L)
    y = 206
    passos = [("nome   Gustavo Bragaia","2 pedidos abertos",VM,0.0),
              ("+ CEP  13424165","1 pedido",A,1.0),
              ("+ valor  R$ 4,31","confere",A,2.0),
              ("= Shopify #1001","identificado",A,3.0)]
    for t,r,c,q in passos:
        if k/FPS >= q:
            d.text((160,y), t, font=MONO(22), fill=I)
            d.text((W-330,y), r, font=MONO(20), fill=c); y += 66
    if k/FPS >= 3.7:
        d.text((160,y+16), "em dúvida, não escreve — manda para revisão", font=UI(19), fill=AM)
    pe(d, "Dois clientes podem ter o mesmo nome. O CEP é o que impede o rastreio de ir para o cliente errado.")
    frames.append(im)

# ── 5 shopify antes -> depois
im, d = novo(); cab(d, 5, "Antes: pedido sem rastreio")
por(im, sf_a, 150); pe(ImageDraw.Draw(im), "Shopify · #1001 · Não processado · Sem informações de rastreamento")
seg(frames, im, 2.6)
for k in range(int(FPS*0.5)):   # transição
    im, d = novo(); cab(d, 5, "O robô escreve o rastreio")
    a = k/(FPS*0.5)
    mix = Image.blend(sf_a, sf_d, a); por(im, mix, 150)
    pe(ImageDraw.Draw(im), "fulfillmentCreateV2 · API oficial da Shopify")
    frames.append(im)
# bbox medido no próprio print: a caixa de rastreamento do pedido
rx0,ry0,rx1,ry1 = [int(v*esc) for v in (248, 268, 1002, 330)]
for k in range(int(FPS*4.0)):
    im, d = novo(); cab(d, 5, "Depois: rastreio preenchido")
    x,y = por(im, sf_d, 150)
    d = ImageDraw.Draw(im)
    if k > FPS*0.4:
        pulso = 2 + int(2*abs(((k//3)%6)-3)/3)
        d.rounded_rectangle([x+rx0,y+ry0,x+rx1,y+ry1], 6, outline=A, width=pulso)
    if k > FPS*1.6:
        d.text((x, y+sf_d.height+28), "Processado · BR269999999999S · Correios", font=MONO(23), fill=A)
    pe(d, "O cliente final passa a ver o rastreio na loja. Nenhuma planilha no meio do caminho.")
    frames.append(im)

# ── 6 painel
im, d = novo(); cab(d, 6, "Como fica no painel", humano=True)
por(im, painel, 128); pe(ImageDraw.Draw(im), "http://127.0.0.1:4000 · 1 pedido escrito · nada pendente de revisão")
seg(frames, im, 4.0)

pontos = [("Pedido em dúvida","homônimo que o CEP não resolveu, ou rastreio estranho"),
          ("Verificação da Shopee","o robô pausa a conta e chama alguém; as outras seguem"),
          ("Resolver e dispensar","um clique no painel e pronto")]
for k in range(int(FPS*4.6)):
    im, d = novo(); cab(d, 6, "O único passo que precisa de gente", humano=True)
    y = 190
    for i,(t,s) in enumerate(pontos):
        if k/FPS >= i*1.0:
            d.rounded_rectangle([120,y,W-120,y+112], 6, fill=S, outline=L)
            d.ellipse([152,y+45,170,y+63], fill=AM)
            d.text((198,y+28), t, font=UIB(24), fill=I)
            d.text((198,y+64), s, font=UI(19), fill=M)
            y += 136
    pe(d, "Verificação da Shopee não é contornada por software. Quando ela aparece, quem resolve é uma pessoa.")
    frames.append(im)

# ── fecho
im, d = novo()
d.text((W//2, H//2-104), "6 passos · 1 pessoa em 1 deles", font=UIB(44), fill=I, anchor="mm")
y = H//2-30
for t,c in [("abre a conta e lê o código de rastreio",A),
            ("acha o pedido certo por nome + CEP + valor",A),
            ("escreve na Shopify e na planilha",A),
            ("revisão e verificação da Shopee",AM)]:
    d.ellipse([W//2-300,y+6,W//2-288,y+18], fill=c)
    d.text((W//2-266,y), t, font=UI(22), fill=I); y += 44
d.text((W//2, H-116), "300 pedidos/dia · 700 contas · 2 a 3 rodadas por dia", font=MONO(19), fill=M, anchor="mm")
seg(frames, im, 4.0)

out = f"{B}/rastreios-shopee-shopify.mp4"
imageio.mimwrite(out, frames, fps=FPS, codec="libx264", quality=8, macro_block_size=1, ffmpeg_log_level="error")
print(f"{len(frames)} quadros · {len(frames)/FPS:.1f}s · {out}")
