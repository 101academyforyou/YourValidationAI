import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepository, GitHubError } from "./src/github.js";
import { detectLanguage, detectFramework, languageLabel, generateTemplateTests } from "./src/analyzer.js";
import { generateAiTests, isAiEnabled, GenerationError, MODEL } from "./src/generator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(here, "public"), { extensions: ["html"] }));

// 簡單的每 IP 速率限制，避免 AI 費用被濫用。
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

app.get("/api/status", (_req, res) => {
  res.json({ mode: isAiEnabled() ? "ai" : "template", model: isAiEnabled() ? MODEL : null });
});

// 以 NDJSON 串流回報進度：{type:"progress"} … 最後是 {type:"result"} 或 {type:"error"}。
app.post("/api/generate", async (req, res) => {
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: "請求次數過多，請一小時後再試。" });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  const progress = (message) => send({ type: "progress", message });

  try {
    const repo = await loadRepository(req.body?.repo, progress);
    const language = req.body?.language && req.body.language !== "auto" ? req.body.language : detectLanguage(repo.files);
    const framework = req.body?.framework && req.body.framework !== "auto" ? req.body.framework : detectFramework(language, repo.manifests);
    progress(`偵測到 ${languageLabel(language)} 專案，將使用 ${framework} 撰寫測試。`);

    const ai = isAiEnabled();
    let output;
    if (ai) {
      progress(`已將 ${repo.files.length} 個檔案交給 AI 分析，這可能需要一到兩分鐘…`);
      output = await generateAiTests(repo, languageLabel(language), framework, progress);
    } else {
      progress("未設定 ANTHROPIC_API_KEY，改用範本模式產生測試骨架…");
      output = generateTemplateTests(repo, language, framework);
    }

    send({
      type: "result",
      data: {
        mode: ai ? "ai" : "template",
        repo: {
          name: `${repo.owner}/${repo.repo}`,
          url: repo.url,
          ref: repo.ref,
          description: repo.description,
          stars: repo.stars,
        },
        language: languageLabel(language),
        framework,
        analyzed_files: repo.files.map((f) => f.path),
        skipped_files: repo.skipped,
        existing_tests: repo.existingTests,
        total_source_files: repo.totalSourceFiles,
        ...output,
      },
    });
  } catch (err) {
    const known = err instanceof GitHubError || err instanceof GenerationError;
    if (!known) console.error(err);
    send({ type: "error", message: known ? err.message : "發生未預期的錯誤，請稍後再試。" });
  } finally {
    res.end();
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`YourValidationAI 已啟動：http://localhost:${port}（${isAiEnabled() ? `AI 模式，${MODEL}` : "範本模式"}）`);
});
