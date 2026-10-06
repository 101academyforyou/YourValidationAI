// 使用 Claude 讀取專案程式碼並產生測試。

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "setup_instructions", "test_files", "test_cases"],
  properties: {
    summary: { type: "string", description: "專案用途、架構與測試策略的繁體中文摘要（3-6 句）" },
    setup_instructions: { type: "string", description: "安裝測試依賴並執行測試的指令" },
    test_files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "target_file", "description", "code"],
        properties: {
          path: { type: "string", description: "測試檔放在專案中的建議路徑" },
          target_file: { type: "string", description: "被測試的原始碼檔案路徑" },
          description: { type: "string", description: "這個測試檔涵蓋什麼（繁體中文）" },
          code: { type: "string", description: "完整、可直接執行的測試程式碼" },
        },
      },
    },
    test_cases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "target", "description"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["unit", "integration", "edge", "error"] },
          target: { type: "string", description: "檔案路徑 › 函式或類別名稱" },
          description: { type: "string", description: "這個測試驗證什麼（繁體中文）" },
        },
      },
    },
  },
};

const SYSTEM = `你是 YourValidationAI，一位資深測試工程師。使用者會提供一個 GitHub 專案的部分原始碼，你要為它撰寫高品質的自動化測試。

原則：
- 只測試程式碼中真的存在的函式、類別與行為；匯入路徑要對應實際檔案位置。
- 優先測試核心商業邏輯與純函式；需要網路、資料庫或檔案系統的部分使用 mock／stub。
- 每個被測目標涵蓋正常情況、邊界情況與錯誤處理，斷言要具體（明確的輸入與預期輸出）。
- 使用指定的測試框架與該語言的慣用寫法，產生的程式碼要能直接執行。
- 若專案已有測試，避免重複並配合既有的風格與目錄結構。
- 說明文字（summary、description、測試名稱）使用繁體中文；程式碼中的識別字維持英文。
- 產生 3 到 8 個測試檔，聚焦在最重要的模組上。`;

export function isAiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function buildPrompt(repo, languageLabel, framework) {
  const parts = [
    `專案：${repo.owner}/${repo.repo}（分支 ${repo.ref}）`,
    repo.description ? `描述：${repo.description}` : "",
    `主要語言：${languageLabel}`,
    `測試框架：${framework}`,
    repo.existingTests.length ? `既有測試檔（${repo.existingTests.length} 個）：\n${repo.existingTests.slice(0, 30).join("\n")}` : "專案目前沒有測試檔。",
    repo.skipped.length ? `因篇幅限制未提供內容的原始碼檔案：\n${repo.skipped.slice(0, 50).join("\n")}` : "",
  ].filter(Boolean);

  const docs = [...repo.manifests, ...repo.files]
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n");

  return `${parts.join("\n\n")}\n\n<repository>\n${docs}\n</repository>\n\n請根據以上程式碼產生測試。`;
}

export class GenerationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function generateAiTests(repo, languageLabel, framework, onProgress = () => {}) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(repo, languageLabel, framework) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  let chars = 0;
  let lastReport = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    if (chars - lastReport > 2000) {
      lastReport = chars;
      onProgress(`AI 正在撰寫測試…（已產生約 ${Math.round(chars / 1000)}k 字元）`);
    }
  });

  let message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new GenerationError("ANTHROPIC_API_KEY 無效。", 500);
    if (err instanceof Anthropic.RateLimitError) throw new GenerationError("AI 服務忙碌中，請稍後再試。", 429);
    if (err instanceof Anthropic.APIError) throw new GenerationError(`AI 服務錯誤：${err.message}`, 502);
    throw err;
  }

  if (message.stop_reason === "refusal") throw new GenerationError("AI 拒絕處理此專案的內容。", 422);
  if (message.stop_reason === "max_tokens") throw new GenerationError("產生的測試內容過長而被截斷，請改用較小的專案或指定分支。", 422);

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new GenerationError("AI 回傳的格式無法解析，請重試。", 502);
  }
}
