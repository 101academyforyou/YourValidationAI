const $ = (sel) => document.querySelector(sel);
const form = $("#form");
const repoInput = $("#repo");
const submitBtn = $("#submit");
const progressBox = $("#progress");
const progressList = $("#progressList");
const errorBox = $("#error");
const results = $("#results");

const TYPE_LABELS = { unit: "單元", integration: "整合", edge: "邊界", error: "錯誤處理" };

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function langClass(path) {
  const ext = path.split(".").pop().toLowerCase();
  const map = { js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", py: "python", go: "go", java: "java", kt: "kotlin", rb: "ruby", php: "php", rs: "rust", cs: "csharp" };
  return map[ext] || "plaintext";
}

// 顯示伺服器目前是 AI 模式還是範本模式
fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    const badge = $("#modeBadge");
    badge.classList.toggle("ai", s.mode === "ai");
    badge.lastElementChild.textContent = s.mode === "ai" ? "AI 模式" : "範本模式";
    badge.title = s.mode === "ai" ? `使用 ${s.model} 產生測試` : "伺服器未設定 ANTHROPIC_API_KEY，將產生測試骨架";
  })
  .catch(() => {});

document.querySelectorAll("[data-repo]").forEach((b) =>
  b.addEventListener("click", () => {
    repoInput.value = `https://github.com/${b.dataset.repo}`;
    repoInput.focus();
  }),
);

function addProgress(message) {
  progressList.querySelectorAll("li.active").forEach((li) => {
    li.classList.remove("active");
    li.classList.add("done");
  });
  // AI 撰寫中的字數更新只替換同一行，避免清單過長
  const last = progressList.lastElementChild;
  if (last && last.dataset.kind === "writing" && message.startsWith("AI 正在撰寫")) {
    last.classList.replace("done", "active");
    last.textContent = message;
    return;
  }
  const li = document.createElement("li");
  li.className = "active";
  li.dataset.kind = message.startsWith("AI 正在撰寫") ? "writing" : "";
  li.textContent = message;
  progressList.appendChild(li);
}

function finishProgress() {
  progressList.querySelectorAll("li.active").forEach((li) => li.classList.replace("active", "done"));
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add("show");
}

async function generate(repo) {
  errorBox.classList.remove("show");
  results.classList.remove("show");
  results.innerHTML = "";
  progressList.innerHTML = "";
  progressBox.classList.add("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "分析中…";

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, language: $("#language").value, framework: $("#framework").value }),
    });
    if (!res.ok && !res.headers.get("content-type")?.includes("ndjson")) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `伺服器錯誤（${res.status}）`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const evt = JSON.parse(line);
        if (evt.type === "progress") addProgress(evt.message);
        else if (evt.type === "error") {
          finishProgress();
          showError(evt.message);
          finished = true;
        } else if (evt.type === "result") {
          finishProgress();
          addProgress("完成！");
          finishProgress();
          renderResults(evt.data);
          finished = true;
        }
      }
    }
    if (!finished) throw new Error("連線中斷，請重試。");
  } catch (err) {
    finishProgress();
    showError(err.message || "發生錯誤，請重試。");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "產生測試";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const repo = repoInput.value.trim();
  if (!repo) return;
  const url = new URL(location.href);
  url.searchParams.set("repo", repo);
  history.replaceState(null, "", url);
  generate(repo);
});

function renderResults(d) {
  const files = d.test_files || [];
  const cases = d.test_cases || [];
  const typeCounts = cases.reduce((acc, c) => ((acc[c.type] = (acc[c.type] || 0) + 1), acc), {});

  results.innerHTML = `
    <div class="card">
      <div class="result-head">
        <div>
          <h2><a href="${escapeHtml(d.repo.url)}" target="_blank" rel="noopener">${escapeHtml(d.repo.name)}</a></h2>
          ${d.repo.description ? `<p style="margin:6px 0 0;color:var(--muted)">${escapeHtml(d.repo.description)}</p>` : ""}
          <div class="meta">
            <span class="chip">分支：${escapeHtml(d.repo.ref)}</span>
            <span class="chip">語言：${escapeHtml(d.language)}</span>
            <span class="chip">框架：${escapeHtml(d.framework)}</span>
            <span class="chip">${d.mode === "ai" ? "AI 模式" : "範本模式"}</span>
          </div>
        </div>
        <button id="downloadAll" class="btn btn-primary" ${files.length ? "" : "disabled"}>下載全部測試（.zip）</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="num">${files.length}</div><div class="lbl">測試檔</div></div>
      <div class="stat"><div class="num">${cases.length}</div><div class="lbl">測試案例</div></div>
      <div class="stat"><div class="num">${d.analyzed_files.length}</div><div class="lbl">已分析檔案（共 ${d.total_source_files} 個）</div></div>
      <div class="stat"><div class="num">${d.existing_tests.length}</div><div class="lbl">既有測試檔</div></div>
    </div>

    <div class="card">
      <div class="tabs" role="tablist">
        <button class="tab active" data-panel="overview">專案摘要</button>
        <button class="tab" data-panel="code">測試程式碼</button>
        <button class="tab" data-panel="cases">測試案例清單</button>
        <button class="tab" data-panel="files">分析範圍</button>
      </div>

      <div class="panel active" id="panel-overview">
        <p style="margin-top:0">${escapeHtml(d.summary)}</p>
        <h3 style="font-size:1rem">執行方式</h3>
        <div class="setup">${escapeHtml(d.setup_instructions)}</div>
        ${d.mode === "template" ? `<p class="notice" style="margin-top:16px">目前為範本模式：產生的是測試骨架，需要自行補上具體輸入與預期值。伺服器設定 ANTHROPIC_API_KEY 後即可產生完整測試。</p>` : ""}
        <h3 style="font-size:1rem">測試類型分布</h3>
        <div class="meta">${Object.entries(typeCounts).map(([t, n]) => `<span class="tag ${t}">${TYPE_LABELS[t] || t} × ${n}</span>`).join("") || "<span>—</span>"}</div>
      </div>

      <div class="panel" id="panel-code">
        <div class="file-list">
          ${files.length ? files.map((f, i) => `
            <div class="file">
              <div class="file-head">
                <div>
                  <div class="path">${escapeHtml(f.path)}</div>
                  <div class="sub">測試對象：<span class="mono">${escapeHtml(f.target_file)}</span> — ${escapeHtml(f.description)}</div>
                </div>
                <div class="file-actions">
                  <button class="btn btn-ghost btn-sm" data-copy="${i}">複製</button>
                  <button class="btn btn-ghost btn-sm" data-download="${i}">下載</button>
                </div>
              </div>
              <pre><code class="language-${langClass(f.path)}">${escapeHtml(f.code)}</code></pre>
            </div>`).join("") : "<p>沒有找到可以產生測試的公開函式。</p>"}
        </div>
      </div>

      <div class="panel" id="panel-cases">
        <div class="filter-bar">
          <button class="btn btn-ghost btn-sm active" data-filter="all">全部（${cases.length}）</button>
          ${Object.entries(typeCounts).map(([t, n]) => `<button class="btn btn-ghost btn-sm" data-filter="${t}">${TYPE_LABELS[t] || t}（${n}）</button>`).join("")}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>類型</th><th>測試名稱</th><th>測試對象</th><th>說明</th></tr></thead>
            <tbody>
              ${cases.map((c) => `
                <tr data-type="${escapeHtml(c.type)}">
                  <td><span class="tag ${escapeHtml(c.type)}">${TYPE_LABELS[c.type] || escapeHtml(c.type)}</span></td>
                  <td>${escapeHtml(c.name)}</td>
                  <td class="mono">${escapeHtml(c.target)}</td>
                  <td>${escapeHtml(c.description)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" id="panel-files">
        <h3 style="font-size:1rem;margin-top:0">已分析的檔案（${d.analyzed_files.length}）</h3>
        <ul class="small-list">${d.analyzed_files.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
        ${d.skipped_files.length ? `
          <h3 style="font-size:1rem">因篇幅限制未納入的檔案（${d.skipped_files.length}）</h3>
          <ul class="small-list">${d.skipped_files.slice(0, 100).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}${d.skipped_files.length > 100 ? "<li>…</li>" : ""}</ul>` : ""}
        ${d.existing_tests.length ? `
          <h3 style="font-size:1rem">專案既有的測試檔（${d.existing_tests.length}）</h3>
          <ul class="small-list">${d.existing_tests.slice(0, 100).map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>`;

  results.classList.add("show");
  if (window.hljs) results.querySelectorAll("pre code").forEach((el) => hljs.highlightElement(el));

  results.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      results.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      results.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab.dataset.panel}`));
    }),
  );

  results.querySelectorAll("[data-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      results.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("active", b === btn));
      results.querySelectorAll("tbody tr").forEach((tr) => {
        tr.style.display = btn.dataset.filter === "all" || tr.dataset.type === btn.dataset.filter ? "" : "none";
      });
    }),
  );

  results.querySelectorAll("[data-copy]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(files[btn.dataset.copy].code);
      btn.textContent = "已複製 ✓";
      setTimeout(() => (btn.textContent = "複製"), 1500);
    }),
  );

  results.querySelectorAll("[data-download]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const f = files[btn.dataset.download];
      saveBlob(new Blob([f.code], { type: "text/plain" }), f.path.split("/").pop());
    }),
  );

  $("#downloadAll")?.addEventListener("click", async () => {
    if (!window.JSZip) return;
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.path.replace(/^\/+/, ""), f.code));
    zip.file("README-tests.md", `# ${d.repo.name} 測試\n\n${d.summary}\n\n## 執行方式\n\n\`\`\`\n${d.setup_instructions}\n\`\`\`\n`);
    saveBlob(await zip.generateAsync({ type: "blob" }), `${d.repo.name.replace("/", "-")}-tests.zip`);
  });

  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 支援從首頁帶入 ?repo=
const initial = new URLSearchParams(location.search).get("repo");
if (initial) {
  repoInput.value = initial;
  generate(initial);
}
