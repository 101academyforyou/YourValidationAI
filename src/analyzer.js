// 靜態分析：判斷語言與測試框架，並在沒有 AI 金鑰時產生「範本模式」的測試骨架。

const LANGUAGES = {
  javascript: { label: "JavaScript", exts: [".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"] },
  typescript: { label: "TypeScript", exts: [".ts", ".tsx"] },
  python: { label: "Python", exts: [".py"] },
  go: { label: "Go", exts: [".go"] },
  java: { label: "Java", exts: [".java"] },
  kotlin: { label: "Kotlin", exts: [".kt"] },
  ruby: { label: "Ruby", exts: [".rb"] },
  php: { label: "PHP", exts: [".php"] },
  rust: { label: "Rust", exts: [".rs"] },
  csharp: { label: "C#", exts: [".cs"] },
};

function langOf(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return Object.keys(LANGUAGES).find((k) => LANGUAGES[k].exts.includes(ext)) || null;
}

export function detectLanguage(files) {
  const counts = {};
  for (const f of files) {
    const lang = langOf(f.path);
    if (lang) counts[lang] = (counts[lang] || 0) + f.content.length;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : "javascript";
}

export function detectFramework(language, manifests) {
  const find = (name) => manifests.find((m) => m.path === name)?.content || "";
  switch (language) {
    case "javascript":
    case "typescript": {
      const pkg = find("package.json");
      if (/"vitest"/.test(pkg)) return "Vitest";
      if (/"mocha"/.test(pkg)) return "Mocha + Chai";
      return "Jest";
    }
    case "python":
      return /unittest/.test(find("pyproject.toml")) ? "unittest" : "pytest";
    case "go":
      return "Go testing";
    case "java":
    case "kotlin":
      return "JUnit 5";
    case "ruby":
      return /minitest/.test(find("Gemfile")) ? "Minitest" : "RSpec";
    case "php":
      return "PHPUnit";
    case "rust":
      return "cargo test";
    case "csharp":
      return "xUnit";
    default:
      return "Jest";
  }
}

export function languageLabel(language) {
  return LANGUAGES[language]?.label || language;
}

/** 以正規表示式找出檔案中公開的函式／類別名稱。 */
export function extractSymbols(path, content) {
  const lang = langOf(path);
  const names = new Set();
  const add = (re) => {
    for (const m of content.matchAll(re)) if (m[1]) names.add(m[1]);
  };
  switch (lang) {
    case "javascript":
    case "typescript":
      add(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g);
      add(/export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g);
      add(/export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g);
      add(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g);
      if (names.size === 0) add(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm);
      break;
    case "python":
      add(/^def\s+([A-Za-z][\w]*)\s*\(/gm);
      add(/^class\s+([A-Za-z][\w]*)/gm);
      break;
    case "go":
      add(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)\s*\(/gm);
      break;
    case "java":
    case "kotlin":
    case "csharp":
      add(/public\s+(?:static\s+)?(?:final\s+)?[\w<>[\],\s]+?\s+([a-z]\w*)\s*\(/g);
      add(/\bfun\s+([a-z]\w*)\s*\(/g);
      break;
    case "ruby":
      add(/^\s*def\s+(?:self\.)?([a-z_]\w*[?!]?)/gm);
      break;
    case "php":
      add(/public\s+(?:static\s+)?function\s+([a-zA-Z_]\w*)/g);
      add(/^function\s+([a-zA-Z_]\w*)/gm);
      break;
    case "rust":
      add(/^\s*pub\s+(?:async\s+)?fn\s+([a-z_]\w*)/gm);
      break;
  }
  return [...names].filter((n) => !["constructor", "main", "__init__"].includes(n)).slice(0, 12);
}

function baseName(path) {
  const name = path.split("/").pop();
  return name.slice(0, name.lastIndexOf(".")) || name;
}

function relativeImport(fromDir, toPath) {
  const from = fromDir.split("/").filter(Boolean);
  const to = toPath.split("/");
  while (from.length && to.length > 1 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const prefix = from.length ? "../".repeat(from.length) : "./";
  return prefix + to.join("/").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

const TEMPLATES = {
  javascript(file, symbols, framework) {
    const testPath = `tests/${baseName(file.path)}.test.js`;
    const importLine = framework === "Vitest" ? `import { describe, it, expect } from "vitest";\n` : "";
    const body = symbols
      .map(
        (s) => `describe("${s}", () => {
  it("在正常輸入下回傳預期結果", () => {
    // TODO: 依照 ${s} 的實際行為填入輸入與預期值
    expect(mod.${s}).toBeDefined();
  });

  it("能處理邊界情況（空值、極端值）", () => {
    // TODO: 補上邊界輸入，例如空字串、0、null
  });

  it("在錯誤輸入時拋出例外或回傳錯誤", () => {
    // TODO: 確認錯誤處理行為
  });
});`,
      )
      .join("\n\n");
    return {
      path: testPath,
      code: `${importLine}import * as mod from "${relativeImport("tests", file.path)}";\n\n${body}\n`,
    };
  },
  typescript(file, symbols, framework) {
    const t = TEMPLATES.javascript(file, symbols, framework);
    return { ...t, path: t.path.replace(/\.js$/, ".ts") };
  },
  python(file, symbols) {
    const module = file.path.replace(/\.py$/, "").replace(/\//g, ".");
    const body = symbols
      .map(
        (s) => `class Test${s[0].toUpperCase()}${s.slice(1)}:
    def test_${s}_returns_expected_value(self):
        # TODO: 依照 ${s} 的實際行為填入輸入與預期值
        assert hasattr(target, "${s}")

    def test_${s}_handles_edge_cases(self):
        # TODO: 補上邊界輸入，例如空字串、0、None
        pass

    def test_${s}_rejects_invalid_input(self):
        # TODO: 使用 pytest.raises 確認錯誤處理
        pass`,
      )
      .join("\n\n\n");
    return { path: `tests/test_${baseName(file.path)}.py`, code: `import pytest\n\nimport ${module} as target\n\n\n${body}\n` };
  },
  go(file, symbols) {
    const pkg = (file.path.split("/").slice(-2, -1)[0] || "main").replace(/[^\w]/g, "");
    const body = symbols
      .map(
        (s) => `func Test${s}(t *testing.T) {
	tests := []struct {
		name string
		// TODO: 加入輸入與預期輸出欄位
	}{
		{name: "正常輸入"},
		{name: "邊界情況"},
		{name: "錯誤輸入"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// TODO: 呼叫 ${s} 並比對結果
		})
	}
}`,
      )
      .join("\n\n");
    return { path: file.path.replace(/\.go$/, "_test.go"), code: `package ${pkg}\n\nimport "testing"\n\n${body}\n` };
  },
};

function genericTemplate(file, symbols, framework) {
  const lines = symbols.map((s) => `// [${framework}] ${s}: 正常輸入、邊界情況、錯誤輸入 三組測試`).join("\n");
  return { path: `tests/${baseName(file.path)}_test.txt`, code: `// 範本模式尚未支援此語言的完整骨架，以下為建議測試清單\n${lines}\n` };
}

/** 沒有 ANTHROPIC_API_KEY 時使用：根據函式清單產生可補完的測試骨架。 */
export function generateTemplateTests(repo, language, framework) {
  const build = TEMPLATES[language] || genericTemplate;
  const testFiles = [];
  const testCases = [];
  for (const file of repo.files) {
    if (langOf(file.path) !== language) continue;
    const symbols = extractSymbols(file.path, file.content);
    if (symbols.length === 0) continue;
    const t = build(file, symbols, framework);
    testFiles.push({
      path: t.path,
      target_file: file.path,
      description: `針對 ${file.path} 中 ${symbols.length} 個公開函式／類別的測試骨架`,
      code: t.code,
    });
    for (const s of symbols) {
      for (const [type, desc] of [
        ["unit", "正常輸入下回傳預期結果"],
        ["edge", "邊界情況（空值、極端值）"],
        ["error", "錯誤輸入的處理"],
      ]) {
        testCases.push({ name: `${s}：${desc}`, type, target: `${file.path} › ${s}`, description: desc });
      }
    }
    if (testFiles.length >= 10) break;
  }
  return {
    summary: `${repo.owner}/${repo.repo} 主要使用 ${languageLabel(language)}。範本模式以靜態分析找出 ${testCases.length / 3} 個公開函式／類別，並為每一個產生正常、邊界、錯誤三類測試骨架。設定 ANTHROPIC_API_KEY 後可改用 AI 模式，產生具體斷言的完整測試。`,
    setup_instructions: setupFor(language, framework),
    test_files: testFiles,
    test_cases: testCases,
  };
}

function setupFor(language, framework) {
  switch (framework) {
    case "Jest":
      return language === "typescript" ? "npm install -D jest ts-jest @types/jest && npx jest" : "npm install -D jest && npx jest";
    case "Vitest":
      return "npm install -D vitest && npx vitest run";
    case "Mocha + Chai":
      return "npm install -D mocha chai && npx mocha";
    case "pytest":
      return "pip install pytest && pytest";
    case "Go testing":
      return "go test ./...";
    case "JUnit 5":
      return "在 build 設定加入 org.junit.jupiter:junit-jupiter，然後執行 mvn test 或 gradle test";
    case "RSpec":
      return "gem install rspec && rspec";
    case "PHPUnit":
      return "composer require --dev phpunit/phpunit && vendor/bin/phpunit";
    case "cargo test":
      return "cargo test";
    default:
      return `使用 ${framework} 執行測試`;
  }
}
