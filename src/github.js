// 讀取公開 GitHub 專案：解析網址、取得檔案樹、挑選要分析的原始碼檔案。

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte",
  ".py", ".go", ".java", ".kt", ".rb", ".php", ".rs", ".cs", ".swift",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".scala", ".dart",
]);

const MANIFEST_FILES = new Set([
  "package.json", "tsconfig.json", "requirements.txt", "pyproject.toml", "setup.py",
  "Pipfile", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
  "Gemfile", "composer.json", "pubspec.yaml", "jest.config.js", "vitest.config.ts",
  "pytest.ini", "README.md",
]);

const IGNORED_DIRS = [
  "node_modules/", "vendor/", "dist/", "build/", "out/", ".next/", "coverage/",
  "target/", "__pycache__/", ".venv/", "venv/", ".git/", "third_party/", "examples/",
  "docs/", ".github/", "migrations/", "public/",
];

const TEST_PATTERN = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)\.[a-z]+$|_test\.go$|^test_.*\.py$|\/test_[^/]*\.py$/i;

export const LIMITS = {
  maxFiles: 40,
  maxFileBytes: 60_000,
  maxTotalChars: 300_000,
};

export class GitHubError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 解析使用者輸入：支援完整網址、owner/repo、帶 /tree/<branch> 的網址。 */
export function parseRepoInput(input) {
  const text = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!text) throw new GitHubError("請輸入 GitHub 專案網址。");

  let path = text;
  const urlMatch = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (urlMatch) path = urlMatch[1];
  else if (/^https?:\/\//i.test(text)) throw new GitHubError("目前只支援 github.com 上的專案。");

  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) throw new GitHubError("網址格式不正確，請使用 https://github.com/owner/repo。");

  const [owner, repo] = parts;
  const valid = /^[A-Za-z0-9_.-]+$/;
  if (!valid.test(owner) || !valid.test(repo)) throw new GitHubError("專案名稱包含不合法的字元。");

  const branch = parts[2] === "tree" && parts[3] ? parts.slice(3).join("/") : null;
  return { owner, repo, branch };
}

function headers() {
  const h = { Accept: "application/vnd.github+json", "User-Agent": "YourValidationAI" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function getJson(url) {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) throw new GitHubError("找不到這個專案，請確認網址正確且為公開專案。", 404);
  if (res.status === 403 || res.status === 429) {
    throw new GitHubError("GitHub API 已達到速率限制，請稍後再試，或在伺服器設定 GITHUB_TOKEN。", 429);
  }
  if (!res.ok) throw new GitHubError(`GitHub API 錯誤（${res.status}）。`, 502);
  return res.json();
}

function extname(path) {
  const name = path.split("/").pop();
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

function isIgnored(path) {
  const p = `${path}/`;
  return IGNORED_DIRS.some((d) => p.startsWith(d) || p.includes(`/${d}`)) || /\.min\.js$|\.d\.ts$/.test(path);
}

/** 依重要性排序：入口與核心目錄優先、淺層優先、中等大小優先。 */
function scoreFile(file) {
  const depth = file.path.split("/").length;
  let score = 100 - depth * 8;
  if (/^(src|lib|app|pkg|internal|core)\//.test(file.path)) score += 25;
  if (/(index|main|app|server|core|utils?|service|api|handler|model)s?\.[a-z]+$/i.test(file.path)) score += 15;
  if (/(config|setup|constants?)\.[a-z]+$/i.test(file.path)) score -= 15;
  if (file.size < 200) score -= 30;
  if (file.size > 30_000) score -= 15;
  return score;
}

export function selectFiles(tree) {
  const blobs = tree.filter((n) => n.type === "blob");
  const manifests = blobs.filter((n) => MANIFEST_FILES.has(n.path) && n.size <= LIMITS.maxFileBytes);
  const sources = blobs.filter(
    (n) => SOURCE_EXTENSIONS.has(extname(n.path)) && !isIgnored(n.path) && n.size <= LIMITS.maxFileBytes,
  );
  const existingTests = sources.filter((n) => TEST_PATTERN.test(n.path));
  const candidates = sources
    .filter((n) => !TEST_PATTERN.test(n.path))
    .sort((a, b) => scoreFile(b) - scoreFile(a));

  const chosen = [];
  let total = 0;
  const skipped = [];
  for (const file of candidates) {
    if (chosen.length < LIMITS.maxFiles && total + file.size <= LIMITS.maxTotalChars) {
      chosen.push(file);
      total += file.size;
    } else {
      skipped.push(file.path);
    }
  }
  return { manifests, sources: chosen, skipped, existingTests: existingTests.map((n) => n.path), totalSourceFiles: candidates.length };
}

async function fetchRaw(owner, repo, ref, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${encoded}`, {
    headers: { "User-Agent": "YourValidationAI" },
  });
  if (!res.ok) return null;
  return res.text();
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 下載專案資訊與挑選後的檔案內容。onProgress 用來回報進度給前端。 */
export async function loadRepository(input, onProgress = () => {}) {
  const { owner, repo, branch } = parseRepoInput(input);
  onProgress(`正在讀取 ${owner}/${repo} 的專案資訊…`);
  const meta = await getJson(`${API}/repos/${owner}/${repo}`);
  const ref = branch || meta.default_branch;

  onProgress(`正在取得 ${ref} 分支的檔案結構…`);
  const treeData = await getJson(`${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const selection = selectFiles(treeData.tree || []);
  if (selection.sources.length === 0) {
    throw new GitHubError("這個專案裡找不到可分析的原始碼檔案。", 422);
  }

  onProgress(`找到 ${selection.totalSourceFiles} 個原始碼檔案，正在下載其中 ${selection.sources.length} 個…`);
  const download = (n) => fetchRaw(owner, repo, ref, n.path).then((content) => ({ path: n.path, content }));
  const [manifests, sources] = await Promise.all([
    mapLimit(selection.manifests, 6, download),
    mapLimit(selection.sources, 6, download),
  ]);

  return {
    owner,
    repo,
    ref,
    url: meta.html_url,
    description: meta.description || "",
    stars: meta.stargazers_count,
    primaryLanguage: meta.language || "",
    truncatedTree: Boolean(treeData.truncated),
    manifests: manifests.filter((f) => f.content != null),
    files: sources.filter((f) => f.content != null),
    skipped: selection.skipped,
    existingTests: selection.existingTests,
    totalSourceFiles: selection.totalSourceFiles,
  };
}
