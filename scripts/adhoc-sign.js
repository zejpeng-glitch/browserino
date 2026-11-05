// Su Mac: firma "ad-hoc" l'app dopo l'impacchettamento (senza non parte sui Mac con chip Apple).
// Su Windows non fa nulla.
const { execFileSync } = require("child_process");
const path = require("path");
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== "darwin" || process.platform !== "darwin") return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
