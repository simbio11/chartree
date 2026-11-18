/**
 * web/app.js — CLIN-7 진료 프로토콜 뷰 (M0: 증상 목록 화면)
 *
 * 계약:
 * - /tree.json (v1 고정 계약: { generated, 증상: { <CODE>: { name, entry, nodes } } })
 * - M0 범위: 증상 목록 그리드 표시, 검색(증상명·증상코드·노드ID·키워드), 최근 사용 3개 표시.
 * - 외부 API·CDN·트래커·환자 식별정보 저장 금지.
 */

(function () {
  "use strict";

  const RECENT_STORAGE_KEY = "clin7_recent_symptoms_v1";
  let treeData = null;

  const gridEl = document.getElementById("symptom-grid");
  const searchInput = document.getElementById("symptom-search");
  const generatedEl = document.getElementById("generated-time");
  const statsEl = document.getElementById("summary-stats");
  const recentSection = document.getElementById("recent-section");
  const recentList = document.getElementById("recent-list");

  function loadRecentSymptoms() {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch (_) {
      return [];
    }
  }

  function pushRecentSymptom(code) {
    try {
      const current = loadRecentSymptoms().filter((c) => c !== code);
      current.unshift(code);
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(current.slice(0, 3)));
      renderRecentSymptoms();
    } catch (_) {
      // localStorage 비활성 환경 무시
    }
  }

  function renderRecentSymptoms() {
    if (!treeData || !treeData["증상"]) return;
    const recentCodes = loadRecentSymptoms().filter((code) => treeData["증상"][code]);
    if (recentCodes.length === 0) {
      recentSection.hidden = true;
      return;
    }
    recentSection.hidden = false;
    recentList.innerHTML = "";
    recentCodes.forEach((code) => {
      const sym = treeData["증상"][code];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-chip";
      btn.textContent = `${code} · ${sym.name}`;
      btn.addEventListener("click", () => {
        searchInput.value = code;
        renderSymptomGrid(code);
      });
      recentList.appendChild(btn);
    });
  }

  function summarizeSymptom(code, symObj) {
    const nodes = symObj.nodes || {};
    const nodeList = Object.values(nodes);
    const totalCount = nodeList.length;

    let redflagCount = 0;
    let canonicalCount = 0;
    let superviseCount = 0;
    const typeCounts = { ask: 0, test: 0, dx: 0, treat: 0, teach: 0, outcome: 0, skill: 0 };

    nodeList.forEach((node) => {
      if (node["레드플래그"] === true) redflagCount += 1;
      if (node["상태"] === "정본") canonicalCount += 1;
      if (node["유형"] === "treat" && typeof node["내숙련도"] === "number" && node["내숙련도"] <= 2) {
        superviseCount += 1;
      }
      const t = node["유형"];
      if (t && Object.prototype.hasOwnProperty.call(typeCounts, t)) {
        typeCounts[t] += 1;
      }
    });

    return {
      code,
      name: symObj.name || code,
      entry: symObj.entry || "-",
      totalCount,
      redflagCount,
      canonicalCount,
      superviseCount,
      typeCounts,
      nodeList,
    };
  }

  function matchesQuery(summary, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;

    if (summary.code.toLowerCase().includes(q)) return true;
    if (summary.name.toLowerCase().includes(q)) return true;
    if (summary.entry.toLowerCase().includes(q)) return true;

    return summary.nodeList.some((node) => {
      const idStr = String(node.id || "").toLowerCase();
      const titleStr = String(node["제목"] || "").toLowerCase();
      const bodyStr = String(node["본문"] || "").toLowerCase();
      const qStr = String(node["질문"] || "").toLowerCase();
      return idStr.includes(q) || titleStr.includes(q) || bodyStr.includes(q) || qStr.includes(q);
    });
  }

  function renderSymptomGrid(filterText) {
    if (!treeData || !treeData["증상"]) {
      gridEl.innerHTML = '<p class="empty-text">표시할 증상 데이터가 없습니다.</p>';
      return;
    }

    const symptomEntries = Object.entries(treeData["증상"]);
    const summaries = symptomEntries.map(([code, symObj]) => summarizeSymptom(code, symObj));
    const filtered = summaries.filter((s) => matchesQuery(s, filterText));

    const totalNodes = summaries.reduce((acc, s) => acc + s.totalCount, 0);
    statsEl.textContent = `증상 ${filtered.length}/${summaries.length}개 · 총 노드 ${totalNodes}개`;

    if (filtered.length === 0) {
      gridEl.innerHTML = '<p class="empty-text">검색 조건과 일치하는 증상 또는 노드가 없습니다.</p>';
      return;
    }

    gridEl.innerHTML = "";

    filtered.forEach((item) => {
      const card = document.createElement("article");
      card.className = "symptom-card";
      card.setAttribute("role", "listitem");
      card.setAttribute("data-symptom-code", item.code);

      const tc = item.typeCounts;
      card.innerHTML = `
        <div class="card-top">
          <div class="symptom-name-wrap">
            <span class="symptom-code">${escapeHtml(item.code)}</span>
            <h3 class="symptom-name">${escapeHtml(item.name)}</h3>
          </div>
          <span class="entry-badge" title="진입 노드">진입: ${escapeHtml(item.entry)}</span>
        </div>
        <div class="card-metrics">
          <span class="metric-tag">노드 ${item.totalCount}개</span>
          <span class="metric-tag redflag">레드플래그 ${item.redflagCount}개</span>
          <span class="metric-tag canonical">정본 ${item.canonicalCount}개</span>
          ${
            item.superviseCount > 0
              ? `<span class="metric-tag supervise">⚠️ 지도 필요 ${item.superviseCount}개</span>`
              : ""
          }
        </div>
        <div class="layer-summary">
          문진(ask) ${tc.ask} · 검사(test) ${tc.test} · 감별(dx) ${tc.dx} · 치료(treat) ${tc.treat} · 티칭(teach) ${tc.teach} · 결과(outcome) ${tc.outcome}
        </div>
      `;

      card.addEventListener("click", () => {
        pushRecentSymptom(item.code);
      });

      gridEl.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function init() {
    try {
      const res = await fetch("/tree.json", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      treeData = await res.json();

      if (treeData.generated) {
        generatedEl.textContent = `생성: ${treeData.generated}`;
      } else {
        generatedEl.textContent = "tree.json 로드 완료";
      }

      renderRecentSymptoms();
      renderSymptomGrid("");
    } catch (err) {
      generatedEl.textContent = "로드 실패";
      gridEl.innerHTML = `<p class="error-text">tree.json을 불러오지 못했습니다: ${escapeHtml(
        err.message || String(err)
      )}</p>`;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  searchInput.addEventListener("input", (e) => {
    renderSymptomGrid(e.target.value);
  });

  init();
})();
