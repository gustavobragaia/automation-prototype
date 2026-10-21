// Coletor: recebe o que a extensão lê dentro do perfil. Pode rodar
// sozinho (coletor.mjs) ou embutido na rodada (start.mjs).

import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tokenValido, credencialDaConta, entregarCredencial, marcarTentativa } from "./credenciais.mjs";
import { obterCodigo, obterLink, fotoDaCaixa } from "./otp.mjs";
import { pedirTrava, soltarTrava, donoAtual } from "./trava-login.mjs";
import { receberToken } from "./shopify-oauth.mjs";
import { emitir } from "./eventos.mjs";
import { alertar, resolver } from "./alertas.mjs";
import { join } from "node:path";
import { DIR_COLETAS, DIR_EVENTOS, DIR_LOGIN, coletaDaConta, loginDaConta } from "./caminhos.mjs";

// A foto da caixa de cada conta, tirada antes de a Shopee mandar o e-mail:
// o que estiver na caixa depois e não estiver nela é o e-mail novo.
const fotos = new Map();

export function iniciarColetor({ porta = 3000, aoLog = () => {} } = {}) {
  for (const d of [DIR_COLETAS, DIR_EVENTOS, DIR_LOGIN])
    mkdirSync(d, { recursive: true });

  const servidor = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");

    // ── rotas sensíveis: nunca respondem a uma página web ─────────────
    // O service worker da extensão não manda Origin de site; uma página
    // manda. É o que separa "nossa extensão" de "qualquer aba aberta".
    if (u.pathname === "/credencial" || u.pathname === "/otp" || u.pathname === "/link" || u.pathname === "/caixa" || u.pathname === "/trava-login") {
      const origem = req.headers.origin ?? "";
      const negar = (motivo) => { res.statusCode = 403; res.end(JSON.stringify({ erro: motivo })); };
      if (/^https?:\/\//i.test(origem)) return negar("origem de site não é aceita aqui");
      if (!tokenValido(u.searchParams.get("token"))) return negar("token inválido");

      res.setHeader("Content-Type", "application/json");
      const conta = u.searchParams.get("conta");
      try {
        // Fila de login da RODADA inteira: a trava do service worker é por
        // perfil e não enxerga os outros navegadores abertos.
        if (u.pathname === "/trava-login") {
          if (u.searchParams.get("acao") === "soltar") {
            const soltou = soltarTrava(conta);
            if (soltou) aoLog(`conta ${conta}: soltou a vez de logar`);
            return res.end(JSON.stringify({ soltou, dono: donoAtual() }));
          }
          const r = pedirTrava(conta);
          if (r.meu && r.roubou) aoLog(`conta ${conta}: assumiu a vez (a anterior passou do tempo)`);
          else if (!r.meu) aoLog(`conta ${conta}: esperando a conta ${r.dono} terminar o login`);
          return res.end(JSON.stringify(r));
        }
        if (u.pathname === "/credencial") {
          try {
            const c = entregarCredencial(conta);
            aoLog(`conta ${conta}: credencial entregue à extensão`);
            return res.end(JSON.stringify(c));
          } catch (e) {
            if (!e.repetida) throw e;
            aoLog(`conta ${conta}: credencial NEGADA — ${e.message}`);
            return res.end(JSON.stringify({ erro: e.message, repetida: true }));
          }
        }
        // A caixa só recebe depois de ATIVADA (inboxes.com: "activate any email
        // address, wait for messages"). Ativar depois de pedir o e-mail perdia a
        // mensagem — na conta 120, em 21/10, a caixa ficou vazia.
        if (u.pathname === "/caixa") {
          const foto = await fotoDaCaixa(credencialDaConta(conta).email);
          fotos.set(String(conta), foto);
          aoLog(`conta ${conta}: caixa de e-mail ativada antes do envio (${foto.size} mensagem(ns) já lá)`);
          return res.end(JSON.stringify({ ok: true }));
        }
        // "Verificar Identidade": o link que a Shopee manda por e-mail.
        if (u.pathname === "/link") {
          const desde = Number(u.searchParams.get("desde") || 0);
          aoLog(`conta ${conta}: buscando o link de verificação no e-mail`);
          try {
            const r = await obterLink(credencialDaConta(conta).email, desde, { antes: fotos.get(String(conta)) ?? null });
            aoLog(`conta ${conta}: link de verificação obtido ("${r.assunto}")`);
            return res.end(JSON.stringify({ link: r.link }));
          } catch (e) {
            if (e.html) writeFileSync(join(DIR_EVENTOS, `${Date.now()}-email-sem-link-${conta}.html`), e.html);
            throw e;
          }
        }
        // OTP: a chave da API de e-mail fica aqui, nunca no navegador.
        const desde = Number(u.searchParams.get("desde") || 0);
        aoLog(`conta ${conta}: buscando código de verificação no e-mail`);
        const r = await obterCodigo(credencialDaConta(conta).email, desde, { antes: fotos.get(String(conta)) ?? null });
        aoLog(`conta ${conta}: código obtido em ${r.tentativas} tentativa(s)`);
        return res.end(JSON.stringify({ codigo: r.codigo }));
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ erro: e.message }));
      }
    }

    // ── retorno do OAuth da Shopify ──────────────────────────────────
    // Chega como POST de formulário, vindo da nossa página em esteira.cloud.
    // A proteção NÃO é a origem (é cross-origin por natureza) e sim o
    // `state`: só vale o retorno da conexão que ESTA máquina começou.
    if (u.pathname === "/shopify/pronto") {
      if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
      let corpo = "";
      req.on("data", (c) => { corpo += c; if (corpo.length > 8192) req.destroy(); });
      req.on("end", () => {
        const campos = Object.fromEntries(new URLSearchParams(corpo));
        const r = receberToken(campos);
        aoLog(r.ok ? `Shopify conectada: ${r.loja}` : `retorno da Shopify recusado: ${r.erro}`);
        res.statusCode = r.ok ? 200 : 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html><meta charset="utf-8"><title>Esteira</title>` +
          `<body style="font:15px/1.6 -apple-system,sans-serif;display:grid;place-items:center;` +
          `height:100vh;margin:0"><p>${r.ok
            ? "Shopify conectada. Pode fechar esta janela."
            : "Não consegui concluir: " + r.erro}</p>`);
      });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();
    if (req.method !== "POST") { res.statusCode = 405; return res.end(); }

    let bruto = "";
    req.on("data", (c) => (bruto += c));
    req.on("end", () => {
      res.end('{"ok":true}');
      let m; try { m = JSON.parse(bruto); } catch { return; }
      // O coletor nunca pode cair: processo morto vira "nenhum pedido
      // novo" silencioso, que é o pior resultado possível.
      try {
        if (m.tipo === "ping") return;
        if (m.tipo === "coleta") {
          const conta = m.conta ?? "sem-conta";
          writeFileSync(coletaDaConta(conta), JSON.stringify(m, null, 2));
          resolver(`conta-humano-${conta}`);   // leu: ninguém mais precisa agir nela
          aoLog(`conta ${conta}: ${(m.pedidos ?? []).length} pedido(s) em ${m.duracaoMs} ms · ${String(m.pagina ?? "").slice(0, 55)}`);
          return;
        }

        // Todo o resto também é registrado. Mensagem de login caindo num ramo
        // mudo foi o que nos deixou adivinhando a causa de uma rodada vazia:
        // "extensão não injetada" e "Shopee bloqueando" davam o mesmo silêncio.
        const conta = m.conta ?? "sem-conta";
        const detalhe = [m.motivo, m.email, m.temToken === false ? "SEM TOKEN" : null]
          .filter(Boolean).join(" · ");
        aoLog(`conta ${conta}: ${m.tipo ?? "(sem tipo)"}${detalhe ? " — " + detalhe : ""}` +
              (m.pagina ? ` · ${String(m.pagina).slice(0, 60)}` : ""));
        writeFileSync(join(DIR_EVENTOS, `${Date.now()}-${m.tipo ?? "sem-tipo"}.json`), JSON.stringify(m, null, 2));

        // A fila lê este arquivo para saber se vale esperar mais: login em
        // andamento merece prazo; login falhado merece desistir na hora.
        if (m.tipo === "login-iniciado") marcarTentativa(conta);
        // "verificacao-*" também: a espera do e-mail pode passar de 3 min, e
        // cada passo dela renova o prazo da fila.
        if (/^(login-|otp-|verificacao-|precisa-humano|nao-autenticado|coleta-falhou|sessao-caida)/.test(m.tipo ?? "")) {
          // "precisa de você" não é sobrescrito por um aviso menor da mesma
          // conta: a fila lê a ÚLTIMA marca, e um "nao-autenticado" logo depois
          // tirava os 10 min de espera — a janela fechava com a pessoa a caminho.
          let anterior = null;
          try { anterior = JSON.parse(readFileSync(loginDaConta(conta), "utf8")); } catch {}
          const segura = anterior?.tipo === "precisa-humano" && Date.now() - anterior.em < 10 * 60_000 &&
            !/^(precisa-humano|login-ok)/.test(m.tipo);
          if (!segura) writeFileSync(loginDaConta(conta),
            JSON.stringify({ tipo: m.tipo, motivo: m.motivo ?? null, em: Date.now() }, null, 2));

          // A tela precisa separar dois casos que no log parecem o mesmo:
          // o robô vai resolver sozinho, ou a rodada parou esperando uma
          // pessoa. O segundo é o único que merece som e notificação.
          if (/^precisa-humano/.test(m.tipo)) {
            emitir("conta:humano", { conta, motivo: m.motivo ?? null });
            alertar({ id: `conta-humano-${conta}`, nivel: "atencao", conta,
              titulo: `A conta ${conta} está esperando você`,
              texto: m.motivo ? `A Shopee parou o robô: ${m.motivo}.` : "A Shopee pediu uma verificação que só uma pessoa resolve.",
              acao: `A janela do AdsPower da conta ${conta} fica aberta por 10 minutos. Resolva lá; quando a página voltar para Minhas Compras, o robô lê sozinho.` });
          }
          if (/^login-falhou/.test(m.tipo) && /senha inv[aá]lida/.test(m.motivo ?? ""))
            alertar({ id: "shopee-senha", nivel: "erro",
              titulo: "A Shopee recusou a senha das contas",
              texto: `Na conta ${conta}, a Shopee respondeu "senha inválida". O robô usa a mesma senha para todas; se ela mudou, nenhuma conta deslogada consegue entrar.`,
              acao: "Confira a senha em Ajustes → Contas da Shopee → 2, e o padrão do e-mail (prefixo e domínio).", ir: "ajustes" });
          // falhas: quem avisa a tela é a fila, ao desistir da conta
          else if (!/^(coleta-falhou|login-falhou|sessao-caida)/.test(m.tipo))
            emitir("conta:logando", { conta });
        }
      } catch (e) {
        aoLog(`erro ao tratar payload: ${e.message}`);
      }
    });
  });

  return new Promise((resolve, reject) => {
    // Sem este `error`, uma porta ocupada vira exceção não tratada: no
    // terminal é um stack trace, no app é um diálogo de erro do Electron e
    // o programa morre antes de abrir a janela.
    servidor.once("error", reject);
    servidor.listen(porta, "127.0.0.1", () => {
      servidor.removeListener("error", reject);
      resolve({ porta, fechar: () => new Promise((r) => servidor.close(r)) });
    });
  });
}
