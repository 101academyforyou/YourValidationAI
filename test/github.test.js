import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoInput, selectFiles } from "../src/github.js";

test("parseRepoInput 支援多種網址格式", () => {
  assert.deepEqual(parseRepoInput("https://github.com/a/b"), { owner: "a", repo: "b", branch: null });
  assert.deepEqual(parseRepoInput("github.com/a/b.git"), { owner: "a", repo: "b", branch: null });
  assert.deepEqual(parseRepoInput("a/b"), { owner: "a", repo: "b", branch: null });
  assert.deepEqual(parseRepoInput("https://github.com/a/b/tree/feature/x"), { owner: "a", repo: "b", branch: "feature/x" });
});

test("parseRepoInput 拒絕不合法的輸入", () => {
  assert.throws(() => parseRepoInput(""));
  assert.throws(() => parseRepoInput("https://gitlab.com/a/b"));
  assert.throws(() => parseRepoInput("just-one-part"));
});

test("selectFiles 排除測試、依賴目錄與過大的檔案", () => {
  const tree = [
    { type: "blob", path: "package.json", size: 300 },
    { type: "blob", path: "src/index.js", size: 2000 },
    { type: "blob", path: "src/index.test.js", size: 900 },
    { type: "blob", path: "node_modules/x/index.js", size: 500 },
    { type: "blob", path: "dist/bundle.min.js", size: 500 },
    { type: "blob", path: "src/huge.js", size: 999_999 },
    { type: "tree", path: "src", size: 0 },
  ];
  const s = selectFiles(tree);
  assert.deepEqual(s.sources.map((f) => f.path), ["src/index.js"]);
  assert.deepEqual(s.existingTests, ["src/index.test.js"]);
  assert.deepEqual(s.manifests.map((f) => f.path), ["package.json"]);
});
