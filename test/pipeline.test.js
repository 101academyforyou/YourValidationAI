import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { loadRepository } from "../src/github.js";
import { detectLanguage, detectFramework, generateTemplateTests } from "../src/analyzer.js";

const FILES = {
  "package.json": '{"name":"demo","devDependencies":{"vitest":"^1.0.0"}}',
  "src/cart.ts": "export function calculateTotal(items: {price:number, qty:number}[]) { return items.reduce((s, i) => s + i.price * i.qty, 0); }\nexport const isEmpty = (items: unknown[]) => items.length === 0;\n",
  "src/cart.test.ts": "// existing test",
};

function fakeFetch(url) {
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  if (url.endsWith("/repos/acme/shop")) return json({ html_url: "https://github.com/acme/shop", default_branch: "main", description: "demo", language: "TypeScript" });
  if (url.includes("/git/trees/main")) {
    return json({ truncated: false, tree: Object.entries(FILES).map(([path, c]) => ({ type: "blob", path, size: c.length })) });
  }
  const m = url.match(/raw\.githubusercontent\.com\/acme\/shop\/main\/(.+)$/);
  if (m && FILES[decodeURIComponent(m[1])]) return new Response(FILES[decodeURIComponent(m[1])]);
  return new Response("not found", { status: 404 });
}

test("完整流程：讀取專案並產生範本測試", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => fakeFetch(String(url)));
  const steps = [];
  const repo = await loadRepository("https://github.com/acme/shop", (m) => steps.push(m));

  assert.equal(repo.ref, "main");
  assert.deepEqual(repo.files.map((f) => f.path), ["src/cart.ts"]);
  assert.deepEqual(repo.existingTests, ["src/cart.test.ts"]);
  assert.ok(steps.length >= 3);

  const language = detectLanguage(repo.files);
  const framework = detectFramework(language, repo.manifests);
  assert.equal(language, "typescript");
  assert.equal(framework, "Vitest");

  const out = generateTemplateTests(repo, language, framework);
  assert.equal(out.test_files[0].path, "tests/cart.test.ts");
  assert.match(out.test_files[0].code, /import \{ describe, it, expect \} from "vitest"/);
  assert.match(out.test_files[0].code, /describe\("calculateTotal"/);
  assert.equal(out.test_cases.length, 6);
});

test("找不到專案時回傳友善錯誤", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  await assert.rejects(loadRepository("acme/missing"), /找不到這個專案/);
});
