// A única página que o lojista vê deste servidor. Precisa funcionar em
// qualquer navegador, sem rede, e nos dois temas.
export function pagina(titulo, texto, extra = "") {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fbfbfc;color:#16161a;
  font:15px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
 .c{max-width:38ch;text-align:center}
 h1{font-size:19px;margin:0 0 10px;letter-spacing:-.02em}
 p{margin:0;color:#63637a;font-size:14px}
 @media(prefers-color-scheme:dark){body{background:#08090a;color:#f1f1f5}p{color:#9797a6}}
</style>
<div class="c"><h1>${titulo}</h1><p>${texto}</p></div>${extra}`;
}

export const escapar = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
