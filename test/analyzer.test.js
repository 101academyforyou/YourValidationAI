import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, detectFramework, extractSymbols, generateTemplateTests } from "../src/analyzer.js";

test("detectLanguage 依程式碼量判斷主要語言", () => {
  const files = [
    { path: "a.py", content: "x".repeat(500) },
    { path: "b.js", content: "x".repeat(100) },
  ];
  assert.equal(detectLanguage(files), "python");
});

test("detectFramework 讀取 package.json", () => {
  assert.equal(detectFramework("typescript", [{ path: "package.json", content: '{"devDependencies":{"vitest":"1"}}' }]), "Vitest");
  assert.equal(detectFramework("javascript", []), "Jest");
  assert.equal(detectFramework("python", []), "pytest");
});

test("extractSymbols 找出公開函式", () => {
  const js = "export function add(a,b){}\nexport const sub = (a,b) => a-b;\nexport class Cart {}\nfunction hidden(){}";
  assert.deepEqual(extractSymbols("src/math.js", js).sort(), ["Cart", "add", "sub"]);
  assert.deepEqual(extractSymbols("m.py", "def parse(x):\n  pass\nclass Foo:\n  pass\n").sort(), ["Foo", "parse"]);
  assert.deepEqual(extractSymbols("m.go", "func Parse(s string) {}\nfunc private() {}"), ["Parse"]);
});

test("generateTemplateTests 產生骨架與案例", () => {
  const repo = { owner: "o", repo: "r", files: [{ path: "src/math.js", content: "export function add(a,b){return a+b}" }] };
  const out = generateTemplateTests(repo, "javascript", "Jest");
  assert.equal(out.test_files.length, 1);
  assert.equal(out.test_files[0].path, "tests/math.test.js");
  assert.match(out.test_files[0].code, /from "\.\.\/src\/math"/);
  assert.equal(out.test_cases.length, 3);
});
