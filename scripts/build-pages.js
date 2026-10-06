// 產生 GitHub Pages 用的靜態介紹頁（輸出到 _site/）。
// Pages 只能放靜態檔案，所以「產生測試」按鈕會連到 APP_URL（已部署的後端），
// 未設定時改連到 GitHub 專案的部署說明。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "_site");
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
const repoUrl = process.env.REPO_URL || "https://github.com/101academyforyou/YourValidationAI";

let html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

html = html
  .replace('href="/styles.css"', 'href="styles.css"')
  .replace('class="brand" href="/"', 'class="brand" href="./"');

if (appUrl) {
  html = html
    .replaceAll('href="/app"', `href="${appUrl}/app"`)
    .replace('action="/app"', `action="${appUrl}/app"`);
} else {
  const deploy = `${repoUrl}#快速開始`;
  html = html
    .replace(
      /<!-- online-option:start -->[\s\S]*?<!-- online-option:end -->/,
      `<div class="access-option">
            <h4>🌐 線上使用</h4>
            <p>線上版本尚未開放。目前請依右側步驟在自己的電腦上架設，或參考 GitHub 上的部署說明。</p>
            <a class="btn btn-ghost" href="${deploy}" target="_blank" rel="noopener">查看部署說明 →</a>
          </div>`,
    )
    .replaceAll('href="/app"', `href="${deploy}" target="_blank" rel="noopener"`)
    .replace(/<form class="quick-form"[\s\S]*?<\/form>/, `<div class="hero-actions" style="margin-bottom:12px"><a class="btn btn-primary" href="${deploy}" target="_blank" rel="noopener">自行部署 →</a></div>`)
    .replace('<a class="btn btn-ghost" href="#how">', `<a class="btn btn-ghost" href="${repoUrl}" target="_blank" rel="noopener">查看原始碼</a>\n        <a class="btn btn-ghost" href="#how">`);
}

if (/(href|src|action)="\/(?!\/)/.test(html)) throw new Error("仍有絕對路徑，GitHub Pages 子路徑下會失效");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), html);
fs.copyFileSync(path.join(root, "public/styles.css"), path.join(out, "styles.css"));
fs.cpSync(path.join(root, "public/images"), path.join(out, "images"), { recursive: true });
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`已輸出 _site/（產生測試連結：${appUrl ? `${appUrl}/app` : "部署說明"}）`);
