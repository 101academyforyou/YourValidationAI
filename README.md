# YourValidationAI

輸入 GitHub 專案網址，YourValidationAI 會分析專案程式碼，自動產生對應的測試內容（測試程式碼 + 測試案例清單），並在網頁上呈現給使用者。

## 功能

- **介紹頁**（`/`）：產品介紹、運作方式、支援語言、常見問題，並可直接貼上網址開始。
- **產生測試**（`/app`）：輸入 `https://github.com/owner/repo`、`owner/repo` 或帶分支的 `.../tree/<branch>` 網址。
  - 即時顯示分析進度
  - 專案摘要與執行測試的指令
  - 每個測試檔的程式碼（語法高亮、複製、下載、一次打包 .zip）
  - 測試案例清單，可依「單元／整合／邊界／錯誤處理」篩選
  - 分析範圍：哪些檔案被分析、哪些因篇幅限制被略過、既有測試檔
- **自動偵測**語言與測試框架（Jest、Vitest、Mocha、pytest、Go testing、JUnit 5、RSpec、PHPUnit、cargo test、xUnit），也可手動指定。

## 兩種模式

| 模式 | 條件 | 產出 |
|---|---|---|
| AI 模式 | 設定 `ANTHROPIC_API_KEY` | 由 Claude 閱讀程式碼，產生含具體斷言、可直接執行的測試 |
| 範本模式 | 未設定金鑰 | 以靜態分析找出公開函式，產生正常／邊界／錯誤三類測試骨架 |

## 快速開始

```bash
npm install
cp .env.example .env     # 填入 ANTHROPIC_API_KEY（選填 GITHUB_TOKEN）
export $(grep -v '^#' .env | xargs)
npm start                # http://localhost:3000
```

需要 Node.js 20 以上。

## 運作流程

1. `src/github.js`：透過 GitHub API 取得檔案樹，排除 `node_modules`、`dist`、測試檔等，依重要性挑選最多 40 個原始碼檔案（約 30 萬字元）與設定檔（`package.json`、`pyproject.toml`…）。
2. `src/analyzer.js`：判斷主要語言與測試框架；範本模式的測試骨架也在這裡產生。
3. `src/generator.js`：將程式碼交給 Claude（預設 `claude-opus-5-5`），以 JSON Schema 結構化輸出取得 `summary`、`setup_instructions`、`test_files`、`test_cases`。
4. `server.js`：`POST /api/generate` 以 NDJSON 串流回傳進度與結果；`GET /api/status` 回報目前模式。

## 測試

```bash
npm test
```

## 注意事項

- 只會讀取公開專案；若要分析私有專案，請自行部署並設定具讀取權限的 `GITHUB_TOKEN`。
- 未設定 `GITHUB_TOKEN` 時，GitHub API 每小時限制 60 次請求。
- 內建每個 IP 每小時 10 次的速率限制（`RATE_LIMIT_PER_HOUR`），避免 AI 費用被濫用。
- AI 產生的測試是很好的起點，執行前仍建議人工審查。
