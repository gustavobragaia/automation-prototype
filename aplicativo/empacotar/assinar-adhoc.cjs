// Assinatura AD-HOC do app, depois de montado e antes de virar .dmg.
//
// Sem conta de desenvolvedor da Apple, não há assinatura de verdade. Mas
// "nenhuma assinatura" e "assinatura ad-hoc" são coisas diferentes para o
// macOS: num Mac com chip Apple, código sem assinatura NENHUMA nem abre — o
// sistema diz que o app "está danificado e não pode ser aberto", e não há
// botão para liberar. Com a ad-hoc, abre depois que a pessoa autoriza em
// Ajustes do Sistema → Privacidade e Segurança.
//
// O electron-builder 25 não faz a ad-hoc sozinho (com identity "-" ele
// procura uma identidade com esse nome no chaveiro, não acha, e pula). Por
// isso este gancho, e a verificação no fim: se a assinatura não fechar, o
// empacotamento PARA — melhor que entregar um .dmg que não abre.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function (contexto) {
  if (contexto.electronPlatformName !== "darwin") return;
  // O universal é montado juntando um app x64 e um arm64 temporários.
  // Assinar os temporários atrapalharia a junção; só o final importa.
  if (/-temp$/.test(contexto.appOutDir)) return;

  const app = join(contexto.appOutDir, `${contexto.packager.appInfo.productFilename}.app`);

  // Antes de assinar: todo import tem que existir dentro do pacote. Ver
  // conferir-imports.cjs — um módulo faltando faz o app travar sem abrir.
  const { conferir } = require("./conferir-imports.cjs");
  const r = conferir(join(app, "Contents", "Resources", "app.asar"));
  if (r.faltando.length)
    throw new Error("o pacote tem imports que não encontram o arquivo — o app não abriria:\n  " +
                    r.faltando.join("\n  "));
  console.log(`  • ${r.modulos} módulos, todo import encontra o seu arquivo dentro do pacote`);

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log(`  • assinatura ad-hoc aplicada e verificada  ${app}`);
};
