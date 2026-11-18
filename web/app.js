/**
 * web/app.js — CLIN-7 진료 프로토콜 뷰 & 진화형 임상 워크벤치 (M0~M3 통합)
 *
 * 핵심 기능:
 * 1. 홈 화면: 증상 그리드 · 통합 검색(증상명·코드·노드ID·키워드) · 최근 사용 3개 · 개별 노드 즉시 점프
 * 2. 진료 트리 (L0~L5 가로 열):
 *    - ask: 질문 크게 + 왜 묻는가 작게 + 예/아니오 분기 버튼 2개
 *    - treat: 술기세트 요약 + 자침점·용량·빈도 원클릭 복사 + 숙련도 0~2 "⚠️ 지도 필요" / "⛔ 시행 금지" 배지
 *    - teach: "환자에게 보여주기" → 24px+ 큰 글씨 전체화면 교육 모달 (뒤로만 가능)
 *    - 레드플래그 노드: 빨간 테두리 + "전원" 고정 문구
 *    - 경로 바: 지나온 노드 칩 목록 + 한 단계 되돌리기 + 케이스 기록 연동
 * 3. 내 스킬 레지스트리 & 숙련도(0~5):
 *    - 본인이 할 수 있는 치료·검사 스킬 등록, 숙련도(Lv.0~5) 및 시행 횟수 실시간 기록 (IndexedDB)
 *    - 연결된 치료 노드의 내숙련도에 즉시 연동
 * 4. 케이스 기록(IndexedDB) & 진화 엔진:
 *    - 비식별 검사(전화번호·주민번호 차단), 경로 자동 채움, NRS 전/후·최종진단·메모 저장
 *    - 노드별 누적 케이스 수(n)와 반응률(%) 계산 → 70%↑(n≥5) 1차 선택 승격 / 40%↓ 대안 분기 강등·개정 제안
 * 5. 프로토콜 가지치기 편집기 & AI(LLM Wiki) 협업 브리프:
 *    - 앱 내에서 새 분기 노드를 가지치기하거나 기존 노드를 수정해 IndexedDB 오버레이로 즉시 반영
 *    - 볼트 규격(`00_스키마.md`) 마크다운 패치 및 AI 3줄 점검/진화 설계 프롬프트 원클릭 복사
 */

(function () {
  "use strict";

  const RECENT_STORAGE_KEY = "clin7_recent_symptoms_v1";
  const DB_NAME = "clin7_protocol_evolution_db";
  const DB_VERSION = 1;

  // 비식별 검사 정규식 (전화번호, 주민등록번호)
  const PHONE_REGEX = /\b01[016789]-\d{3,4}-\d{4}\b/;
  const RRN_REGEX = /\b\d{6}-[1-4]\d{6}\b/;

  const LAYER_META = [
    { key: "L0", title: "L0 · 증상 진입" },
    { key: "L1", title: "L1 · 분기 문진 (Ask)" },
    { key: "L2", title: "L2 · 이학적 검사 (Test)" },
    { key: "L3", title: "L3 · 감별 진단 (Dx)" },
    { key: "L4", title: "L4 · 치료·티칭 (Treat/Teach)" },
    { key: "L5", title: "L5 · 결과·전원 (Outcome)" },
  ];

  const DEFAULT_SKILLS = [
    {
      id: "SK-001",
      category: "침·전침",
      name: "두경부·견항부 표준 경혈 자침 (풍지·백회·태양·합곡·태충)",
      level: 4,
      count: 42,
      linkedNodes: ["HA-L4-01", "DZ-L4-01"],
      notes: "0.25×30mm 직자/사자 10~15mm, 15분 유침. 항응고제 복용자 지혈 확인.",
      updated: "2026-11-18",
    },
    {
      id: "SK-002",
      category: "약침·봉침",
      name: "상부 경추(풍지·천주·후두하근) 심부 약침술",
      level: 2,
      count: 6,
      linkedNodes: ["HA-L4-02"],
      notes: "추골동맥 주행 주의. 30G×25mm 바늘로 후두골 하연 지표 확인 후 포인트당 0.1~0.2cc 주입.",
      updated: "2026-11-18",
    },
    {
      id: "SK-003",
      category: "추나·수기",
      name: "상부 경추 굴곡-회전 검사(CFRT) 및 경추 가동 추나",
      level: 4,
      count: 28,
      linkedNodes: ["HA-L2-01", "HA-L4-02"],
      notes: "최대 굴곡 상태에서 C1-C2 회전 각도 비교(정상 44도 이상). 추골동맥 부전이나 불안정성 금기.",
      updated: "2026-11-18",
    },
    {
      id: "SK-004",
      category: "약침·봉침",
      name: "견관절 전·후방 관절낭 약침 및 관절가동 추나",
      level: 2,
      count: 8,
      linkedNodes: ["SH-L4-02"],
      notes: "견우·견료·결절간구 무균 소독 철저. 급성 염증기에는 과도한 Grade III 가동 추나 지양.",
      updated: "2026-11-18",
    },
    {
      id: "SK-005",
      category: "이학적검사",
      name: "두위충격검사(Head Impulse Test) 및 HINTS 안진 판독",
      level: 3,
      count: 14,
      linkedNodes: ["DZ-L2-01"],
      notes: "지속성 현훈에서 HIT 정상이거나 방향전환 안진·수직사시 출현 시 즉시 뇌졸중 전원.",
      updated: "2026-11-18",
    },
  ];

  // 전역 상태
  let baseTreeData = null; // 서버 /tree.json 원본
  let mergedTreeData = null; // 원본 + IndexedDB 커스텀 노드 + 숙련도 오버레이 병합본
  let customNodesList = []; // IndexedDB 저장 커스텀 노드 배열
  let skillsList = []; // IndexedDB 저장 내 스킬 레지스트리
  let casesList = []; // IndexedDB 저장 케이스 로그

  let currentView = "home";
  let activeSymptomCode = "HA";
  let activeNodeId = "HA-L0-01";
  let currentPath = ["HA-L0-01"];

  // DOM 참조
  const gridEl = document.getElementById("symptom-grid");
  const searchInput = document.getElementById("symptom-search");
  const generatedEl = document.getElementById("generated-time");
  const statsEl = document.getElementById("summary-stats");
  const recentSection = document.getElementById("recent-section");
  const recentList = document.getElementById("recent-list");
  const nodeSearchSection = document.getElementById("node-search-results-section");
  const nodeSearchGrid = document.getElementById("node-search-results");

  const pathwayBar = document.getElementById("pathway-bar");
  const pathwayChips = document.getElementById("pathway-chips");
  const treeSymptomSelect = document.getElementById("tree-symptom-select");
  const treeColumnsEl = document.getElementById("tree-columns");
  const nodeDetailPanel = document.getElementById("node-detail-panel");
  const nodeDetailContent = document.getElementById("node-detail-content");

  const teachModal = document.getElementById("patient-teach-modal");
  const teachModalTitle = document.getElementById("teach-modal-title");
  const teachModalBody = document.getElementById("teach-modal-body");
  const toastEl = document.getElementById("app-toast");

  /* ==================== 유틸리티 ==================== */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3200);
  }

  async function copyToClipboard(text, label) {
    const previewEl = document.getElementById("export-preview-textarea");
    if (previewEl) {
      previewEl.value = text;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(`📋 클립보드 복사 완료: ${label}`);
        return;
      }
    } catch (_) {
      // fallback
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast(`📋 클립보드 복사 완료: ${label}`);
    } catch (_) {
      showToast(`미리보기 창에 생성되었습니다: ${label}`);
    }
    document.body.removeChild(ta);
  }

  /* ==================== IndexedDB 로컬 저장소 ==================== */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("cases")) {
          db.createObjectStore("cases", { keyPath: "caseId" });
        }
        if (!db.objectStoreNames.contains("skills")) {
          db.createObjectStore("skills", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("custom_nodes")) {
          db.createObjectStore("custom_nodes", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(storeName) {
    try {
      const db = await openDatabase();
      if (!db) return [];
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      return [];
    }
  }

  async function dbPut(storeName, item) {
    try {
      const db = await openDatabase();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      // fallback ignore
    }
  }

  async function dbClear(storeName) {
    try {
      const db = await openDatabase();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (_) {}
  }

  /* ==================== 데이터 병합 (원본 tree.json + 커스텀 노드 + 내 스킬 숙련도) ==================== */
  function rebuildMergedTree() {
    if (!baseTreeData) return;
    mergedTreeData = JSON.parse(JSON.stringify(baseTreeData));
    if (!mergedTreeData["증상"]) {
      mergedTreeData["증상"] = {};
    }

    // 1. 커스텀 노드 병합
    customNodesList.forEach((item) => {
      const symCode = item.symCode;
      const symName = item.symName || symCode;
      const nodeObj = JSON.parse(JSON.stringify(item.node));

      if (!mergedTreeData["증상"][symCode]) {
        mergedTreeData["증상"][symCode] = {
          name: symName,
          entry: nodeObj.id,
          nodes: {},
        };
      }
      const sym = mergedTreeData["증상"][symCode];
      sym.nodes[nodeObj.id] = nodeObj;

      // 부모 노드에 분기 자동 연결
      if (nodeObj["상위"] && sym.nodes[nodeObj["상위"]]) {
        const parent = sym.nodes[nodeObj["상위"]];
        const branchLabel = item.parentBranch || "추가분기";
        if (!parent["다음"]) {
          parent["다음"] = [nodeObj.id];
        } else if (Array.isArray(parent["다음"])) {
          if (!parent["다음"].includes(nodeObj.id)) {
            parent["다음"].push(nodeObj.id);
          }
        } else if (typeof parent["다음"] === "object") {
          if (!parent["다음"][branchLabel]) {
            parent["다음"][branchLabel] = [nodeObj.id];
          } else if (
            Array.isArray(parent["다음"][branchLabel]) &&
            !parent["다음"][branchLabel].includes(nodeObj.id)
          ) {
            parent["다음"][branchLabel].push(nodeObj.id);
          }
        }
      }
    });

    // 2. 스킬 레지스트리 숙련도와 노드 내숙련도 동기화
    skillsList.forEach((sk) => {
      (sk.linkedNodes || []).forEach((nid) => {
        Object.values(mergedTreeData["증상"]).forEach((sym) => {
          if (sym.nodes && sym.nodes[nid]) {
            sym.nodes[nid]["내숙련도"] = Number(sk.level);
            sym.nodes[nid]["_연결스킬"] = `${sk.id} ${sk.name}`;
          }
        });
      });
    });

    updateNavCounters();
  }

  function updateNavCounters() {
    const skEl = document.getElementById("nav-skill-count");
    const csEl = document.getElementById("nav-case-count");
    const cuEl = document.getElementById("nav-custom-count");
    const badgeCu = document.getElementById("custom-node-badge-count");

    if (skEl) skEl.textContent = String(skillsList.length);
    if (csEl) csEl.textContent = String(casesList.length);
    if (cuEl) cuEl.textContent = String(customNodesList.length);
    if (badgeCu) badgeCu.textContent = String(customNodesList.length);
  }

  /* ==================== 케이스 기반 노드별 진화 통계 계산 ==================== */
  function computeNodeEvolutionStats() {
    const stats = {}; // { nodeId: { total: 0, responders: 0, rate: 0, memos: [], signal: null } }
    casesList.forEach((c) => {
      const before = Number(c.nrsBefore);
      const after = Number(c.nrsAfter);
      const isResponder = before > 0 ? (before - after) / before >= 0.5 || before - after >= 3 : after === 0;

      (c.path || []).forEach((nid) => {
        if (!stats[nid]) {
          stats[nid] = { total: 0, responders: 0, rate: 0, memos: [], signal: null };
        }
        stats[nid].total += 1;
        if (isResponder) stats[nid].responders += 1;
        if (c.memo && c.memo.trim()) {
          stats[nid].memos.push(c.memo.trim());
        }
      });
    });

    Object.keys(stats).forEach((nid) => {
      const st = stats[nid];
      st.rate = st.total > 0 ? Math.round((st.responders / st.total) * 100) : 0;
      if (st.total >= 5 && st.rate >= 70) {
        st.signal = "promote"; // 🌟 1차 선택 승격
      } else if (st.total >= 5 && st.rate < 40) {
        st.signal = "demote"; // 🔧 대안 분기 추가 / 강등 후보
      } else if (st.memos.length > 0) {
        st.signal = "memo";
      }
    });

    return stats;
  }

  /* ==================== 화면(탭) 전환 ==================== */
  function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
    });

    const views = ["home", "tree", "skills", "cases", "evolve"];
    views.forEach((v) => {
      const sec = document.getElementById(`view-${v}`);
      if (sec) sec.hidden = v !== viewName;
    });

    pathwayBar.hidden = viewName !== "tree";

    if (viewName === "home") {
      renderRecentSymptoms();
      renderSymptomGrid(searchInput.value);
    } else if (viewName === "tree") {
      populateSymptomSelects();
      renderTreeWorkspace();
    } else if (viewName === "skills") {
      renderSkillRegistry();
    } else if (viewName === "cases") {
      populateSymptomSelects();
      syncCaseFormWithCurrentPath();
      renderCasesAndEvolution();
    } else if (viewName === "evolve") {
      renderEvolveWorkbench();
    }
  }

  /* ==================== VIEW 1: 홈 · 증상 목록 & 통합 검색 ==================== */
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
    } catch (_) {}
  }

  function renderRecentSymptoms() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const recentCodes = loadRecentSymptoms().filter((code) => mergedTreeData["증상"][code]);
    if (recentCodes.length === 0) {
      recentSection.hidden = true;
      return;
    }
    recentSection.hidden = false;
    recentList.innerHTML = "";
    recentCodes.forEach((code) => {
      const sym = mergedTreeData["증상"][code];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-chip";
      btn.textContent = `${code} · ${sym.name} 바로 열기 →`;
      btn.addEventListener("click", () => {
        openSymptomInTree(code);
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

  function nodeMatchesText(node, q) {
    const fields = [
      node.id,
      node["제목"],
      node["질문"],
      node["왜"],
      node["검사명"],
      node["술기세트"],
      node["자침점용량"],
      node["환자설명"],
      node["본문"],
      Array.isArray(node["후보"]) ? node["후보"].join(" ") : "",
    ];
    return fields.some((f) => String(f || "").toLowerCase().includes(q));
  }

  function matchesQuery(summary, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (summary.code.toLowerCase().includes(q)) return true;
    if (summary.name.toLowerCase().includes(q)) return true;
    if (summary.entry.toLowerCase().includes(q)) return true;
    return summary.nodeList.some((node) => nodeMatchesText(node, q));
  }

  function renderSymptomGrid(filterText) {
    if (!mergedTreeData || !mergedTreeData["증상"]) {
      gridEl.innerHTML = '<p class="empty-text">표시할 증상 데이터가 없습니다.</p>';
      return;
    }

    const symptomEntries = Object.entries(mergedTreeData["증상"]);
    const summaries = symptomEntries.map(([code, symObj]) => summarizeSymptom(code, symObj));
    const filtered = summaries.filter((s) => matchesQuery(s, filterText));

    const totalNodes = summaries.reduce((acc, s) => acc + s.totalCount, 0);
    statsEl.textContent = `증상 ${filtered.length}/${summaries.length}개 · 총 노드 ${totalNodes}개`;

    if (filtered.length === 0) {
      gridEl.innerHTML = '<p class="empty-text">검색어와 일치하는 증상 또는 노드가 없습니다.</p>';
    } else {
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
            <span class="entry-badge">진입: ${escapeHtml(item.entry)}</span>
          </div>
          <div class="card-metrics">
            <span class="metric-tag">총 노드 ${item.totalCount}개</span>
            <span class="metric-tag redflag">🚨 레드플래그 ${item.redflagCount}개</span>
            <span class="metric-tag canonical">✅ 정본 ${item.canonicalCount}개</span>
            ${
              item.superviseCount > 0
                ? `<span class="metric-tag supervise">⚠️ 지도 필요 ${item.superviseCount}개</span>`
                : ""
            }
          </div>
          <div class="layer-summary">
            <span>문진 ${tc.ask} · 검사 ${tc.test} · 감별 ${tc.dx} · 치료 ${tc.treat} · 티칭 ${tc.teach}</span>
            <strong style="color: var(--primary);">트리 열기 →</strong>
          </div>
        `;

        card.addEventListener("click", () => {
          openSymptomInTree(item.code);
        });
        gridEl.appendChild(card);
      });
    }

    // 검색어가 있을 때 개별 노드 직접 점프 카드도 하단에 표시
    const q = (filterText || "").trim().toLowerCase();
    if (!q) {
      nodeSearchSection.hidden = true;
      return;
    }

    const matchedNodes = [];
    summaries.forEach((s) => {
      s.nodeList.forEach((node) => {
        if (nodeMatchesText(node, q)) {
          matchedNodes.push({ symCode: s.code, symName: s.name, node });
        }
      });
    });

    if (matchedNodes.length === 0) {
      nodeSearchSection.hidden = true;
      return;
    }

    nodeSearchSection.hidden = false;
    nodeSearchGrid.innerHTML = "";
    matchedNodes.slice(0, 12).forEach(({ symCode, symName, node }) => {
      const div = document.createElement("div");
      div.className = `tree-node-card ${node["레드플래그"] ? "redflag-node" : ""}`;
      div.innerHTML = `
        <div class="node-card-top">
          <span class="node-id-badge">${escapeHtml(symName)} · ${escapeHtml(node.id)}</span>
          <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(node["유형"])}</span>
        </div>
        <div class="node-card-title">${escapeHtml(node["제목"])}</div>
        <div class="node-card-preview">${escapeHtml(
          node["질문"] || node["술기세트"] || node["환자설명"] || node["검사명"] || ""
        )}</div>
      `;
      div.addEventListener("click", () => {
        openSymptomInTree(symCode, node.id);
      });
      nodeSearchGrid.appendChild(div);
    });
  }

  function openSymptomInTree(symCode, targetNodeId) {
    if (!mergedTreeData || !mergedTreeData["증상"] || !mergedTreeData["증상"][symCode]) return;
    pushRecentSymptom(symCode);
    activeSymptomCode = symCode;
    const sym = mergedTreeData["증상"][symCode];
    const entryId = sym.entry || Object.keys(sym.nodes)[0];

    if (targetNodeId && sym.nodes[targetNodeId]) {
      activeNodeId = targetNodeId;
      currentPath = buildPathToNode(sym.nodes, entryId, targetNodeId);
    } else {
      activeNodeId = entryId;
      currentPath = [entryId];
    }

    switchView("tree");
  }

  function buildPathToNode(nodesMap, entryId, targetId) {
    const chain = [];
    let cur = targetId;
    const visited = new Set();
    while (cur && nodesMap[cur] && !visited.has(cur)) {
      visited.add(cur);
      chain.unshift(cur);
      if (cur === entryId) break;
      cur = nodesMap[cur]["상위"];
    }
    if (chain[0] !== entryId && nodesMap[entryId]) {
      chain.unshift(entryId);
    }
    return chain;
  }

  /* ==================== VIEW 2: 진료 트리 (L0~L5 가로 열 + 상세 패널) ==================== */
  function populateSymptomSelects() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const entries = Object.entries(mergedTreeData["증상"]);
    const html = entries
      .map(
        ([code, obj]) =>
          `<option value="${escapeHtml(code)}" ${code === activeSymptomCode ? "selected" : ""}>${escapeHtml(
            code
          )} — ${escapeHtml(obj.name)} (${Object.keys(obj.nodes || {}).length}노드)</option>`
      )
      .join("");

    if (treeSymptomSelect) treeSymptomSelect.innerHTML = html;
    const caseSymSel = document.getElementById("case-symptom-input");
    if (caseSymSel) caseSymSel.innerHTML = html;
  }

  function getLayerFromNodeId(nid) {
    const m = String(nid).match(/^[A-Z]{2,4}-(L[0-5]|S)-/);
    return m ? m[1] : "L1";
  }

  function getNextIdsFromNode(node) {
    if (!node || !node["다음"]) return [];
    const nxt = node["다음"];
    if (Array.isArray(nxt)) return nxt.map(String);
    if (typeof nxt === "object") {
      const out = [];
      Object.values(nxt).forEach((arr) => {
        if (Array.isArray(arr)) out.push(...arr.map(String));
        else if (typeof arr === "string") out.push(arr);
      });
      return out;
    }
    return [];
  }

  function renderPathwayBar() {
    if (!mergedTreeData || !mergedTreeData["증상"][activeSymptomCode]) return;
    const nodesMap = mergedTreeData["증상"][activeSymptomCode].nodes || {};
    pathwayChips.innerHTML = "";

    currentPath.forEach((nid, idx) => {
      const node = nodesMap[nid];
      if (!node) return;
      if (idx > 0) {
        const arrow = document.createElement("span");
        arrow.className = "path-arrow";
        arrow.textContent = "→";
        pathwayChips.appendChild(arrow);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      const isRF = node["레드플래그"] === true;
      btn.className = `path-chip ${nid === activeNodeId ? "active" : ""} ${isRF ? "redflag" : ""}`;
      btn.textContent = `${nid} ${node["제목"]}`;
      btn.addEventListener("click", () => {
        activeNodeId = nid;
        currentPath = currentPath.slice(0, idx + 1);
        renderTreeWorkspace();
      });
      pathwayChips.appendChild(btn);
    });
  }

  function selectTreeNode(nid, appendToPath) {
    const sym = mergedTreeData["증상"][activeSymptomCode];
    if (!sym || !sym.nodes[nid]) return;

    activeNodeId = nid;
    const existingIdx = currentPath.indexOf(nid);
    if (existingIdx !== -1) {
      currentPath = currentPath.slice(0, existingIdx + 1);
    } else if (appendToPath) {
      currentPath.push(nid);
    } else {
      currentPath = buildPathToNode(sym.nodes, sym.entry, nid);
    }
    renderTreeWorkspace();
  }

  function renderTreeWorkspace() {
    if (!mergedTreeData || !mergedTreeData["증상"][activeSymptomCode]) return;
    const sym = mergedTreeData["증상"][activeSymptomCode];
    const nodesMap = sym.nodes || {};
    if (!nodesMap[activeNodeId]) {
      activeNodeId = sym.entry || Object.keys(nodesMap)[0];
      currentPath = activeNodeId ? [activeNodeId] : [];
    }

    renderPathwayBar();

    const activeNode = nodesMap[activeNodeId];
    const recommendedNextIds = new Set(getNextIdsFromNode(activeNode));
    const pathSet = new Set(currentPath);
    const evoStats = computeNodeEvolutionStats();

    // L0~L5 그룹핑
    const grouped = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [] };
    Object.values(nodesMap)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach((node) => {
        const layer = getLayerFromNodeId(node.id);
        if (grouped[layer]) grouped[layer].push(node);
        else grouped.L4.push(node);
      });

    treeColumnsEl.innerHTML = "";
    LAYER_META.forEach(({ key, title }) => {
      const colNodes = grouped[key] || [];
      const colEl = document.createElement("div");
      colEl.className = "layer-column";
      colEl.innerHTML = `
        <div class="layer-header">
          <span class="layer-title">${escapeHtml(title)}</span>
          <span class="layer-count">${colNodes.length}</span>
        </div>
      `;

      colNodes.forEach((node) => {
        const isSelected = node.id === activeNodeId;
        const isInPath = pathSet.has(node.id);
        const isNext = recommendedNextIds.has(node.id);
        const isRedflag = node["레드플래그"] === true;
        const prof = typeof node["내숙련도"] === "number" ? node["내숙련도"] : null;
        const nStats = evoStats[node.id];

        const card = document.createElement("article");
        card.className = [
          "tree-node-card",
          isSelected ? "selected" : "",
          isInPath ? "in-path" : "",
          isNext ? "recommended-next" : "",
          isRedflag ? "redflag-node" : "",
        ]
          .filter(Boolean)
          .join(" ");

        let badgesHtml = "";
        if (isRedflag) {
          badgesHtml += `<span class="redflag-banner-tag">🚨 레드플래그 · 즉시 전원</span>`;
        }
        if (node["유형"] === "treat" && prof !== null) {
          if (prof === 0) {
            badgesHtml += `<span class="mini-badge badge-forbid">⛔ Lv.0 시행 금지(위임/전원)</span>`;
          } else if (prof <= 2) {
            badgesHtml += `<span class="mini-badge badge-supervise">⚠️ 지도 필요 (Lv.${prof})</span>`;
          } else {
            badgesHtml += `<span class="mini-badge badge-first-choice">✅ 숙련 Lv.${prof}</span>`;
          }
        }
        if (nStats && nStats.total > 0) {
          if (nStats.signal === "promote") {
            badgesHtml += `<span class="mini-badge badge-first-choice">🌟 1차 선택 (${nStats.rate}%, n=${nStats.total})</span>`;
          } else if (nStats.signal === "demote") {
            badgesHtml += `<span class="mini-badge badge-revise-candidate">🔧 개정 후보 (${nStats.rate}%, n=${nStats.total})</span>`;
          } else {
            badgesHtml += `<span class="mini-badge" style="background:#e2e8f0;">반응 ${nStats.rate}% (n=${nStats.total})</span>`;
          }
        }

        const previewText =
          node["질문"] ||
          node["술기세트"] ||
          node["검사명"] ||
          node["환자설명"] ||
          (Array.isArray(node["후보"]) ? node["후보"].join(", ") : "") ||
          node["측정지표"] ||
          "";

        card.innerHTML = `
          <div class="node-card-top">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(node["유형"])}</span>
          </div>
          <div class="node-card-title">${escapeHtml(node["제목"])}</div>
          ${previewText ? `<div class="node-card-preview">${escapeHtml(previewText)}</div>` : ""}
          ${badgesHtml ? `<div class="node-card-badges">${badgesHtml}</div>` : ""}
        `;

        card.addEventListener("click", () => {
          selectTreeNode(node.id, isNext);
        });
        colEl.appendChild(card);
      });

      treeColumnsEl.appendChild(colEl);
    });

    renderNodeDetailPanel(activeNode, nodesMap, evoStats[activeNodeId]);
  }

  function renderNodeDetailPanel(node, nodesMap, nodeEvoStat) {
    if (!node) {
      nodeDetailContent.innerHTML = '<p class="empty-text">노드를 선택해 주세요.</p>';
      return;
    }

    const isRedflag = node["레드플래그"] === true;
    nodeDetailPanel.classList.toggle("redflag-panel", isRedflag);

    const ntype = node["유형"];
    const prof = typeof node["내숙련도"] === "number" ? node["내숙련도"] : 3;

    // 1. 헤더 & 레드플래그 고정 전원 배너
    let html = `
      <div class="detail-header">
        <div class="node-card-top">
          <span class="node-id-badge">${escapeHtml(node.id)} · ${escapeHtml(node["파일"] || "")}</span>
          <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(ntype)}</span>
        </div>
        <h3 class="detail-title">${escapeHtml(node["제목"])}</h3>
        <div class="card-metrics">
          <span class="metric-tag ${node["상태"] === "정본" ? "canonical" : ""}">상태: ${escapeHtml(
            node["상태"] || "초안"
          )}</span>
          <span class="metric-tag">신뢰도: ${escapeHtml(node["신뢰도"] || "상")}</span>
          ${
            ntype === "treat" && prof <= 2
              ? `<span class="metric-tag supervise">${
                  prof === 0 ? "⛔ Lv.0 시행 금지 · 위임/전원" : `⚠️ 지도 필요 (내 숙련도 Lv.${prof})`
                }</span>`
              : `<span class="metric-tag">내 숙련도: Lv.${prof}</span>`
          }
        </div>
        ${
          isRedflag
            ? `<div class="redflag-alert-box">
                🚨 [레드플래그 경고 — 전원] 양성 소견 시 원내 모든 시술을 보류하고 즉시 상급병원(응급실/신경과/정형외과)으로 전원하십시오.<br>
                • 전원 기준: ${escapeHtml(node["전원기준"] || "양성 시 지체 없이 응급 전원")}
               </div>`
            : ""
        }
      </div>
    `;

    // 2. 유형별 전용 인터랙션 블록
    if (ntype === "ask") {
      html += `
        <div class="ask-question-box">
          <div class="ask-question-large">Q. ${escapeHtml(node["질문"] || node["제목"])}</div>
          <div class="ask-why-small"><strong>💡 왜 묻는가:</strong> ${escapeHtml(
            node["왜"] || "임상 분기 판정"
          )}</div>
        </div>
      `;
    } else if (ntype === "treat") {
      const copyPayload = [
        `[치료 세트] ${node.id} ${node["제목"]}`,
        `• 술기 세트: ${node["술기세트"] || "-"}`,
        `• 자침점·용량: ${node["자침점용량"] || "-"}`,
        `• 빈도·기간: ${node["빈도"] || "-"} / ${node["기간"] || "-"}`,
        `• 금기/주의: ${node["금기"] || "-"}`,
        `• 재평가 시점: ${node["재평가시점"] || "-"}`,
        `• 전원 기준: ${node["전원기준"] || "-"}`,
      ].join("\n");

      html += `
        <div class="treat-summary-box">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
            <strong style="color:#166534;">💊 치료 세트 요약 (차트 기록용)</strong>
            <button type="button" id="btn-copy-treat-set" class="btn btn-sm btn-primary">
              📋 자침점·용량·빈도 그대로 복사
            </button>
          </div>
          <pre id="treat-copy-text" class="treat-copy-pre">${escapeHtml(copyPayload)}</pre>
          ${
            node["환자설명"]
              ? `<button type="button" class="btn btn-outline btn-open-patient-teach">
                   🖥️ 환자에게 보여주기 (24px+ 큰 글씨 교육 화면)
                 </button>`
              : ""
          }
        </div>
      `;
    } else if (ntype === "teach") {
      html += `
        <div class="treat-summary-box" style="background:#fdf2f8; border-color:#fbcfe8;">
          <strong style="color:#9d174d;">🗣️ 환자 설명 3문장 & 생활 지도</strong>
          <p style="font-size:0.95rem; font-weight:600; color:#1e293b;">${escapeHtml(
            node["환자설명"] || ""
          )}</p>
          <button type="button" class="btn btn-lg btn-primary btn-open-patient-teach">
            🖥️ 환자에게 보여주기 (큰 글씨 24px+ 교육 화면 열기)
          </button>
        </div>
      `;
    }

    // 3. 다음 분기 버튼 (예/아니오, 양성/음성, 또는 다음 단계 리스트)
    const nextField = node["다음"];
    let branchButtonsHtml = "";
    if (nextField && typeof nextField === "object" && !Array.isArray(nextField)) {
      Object.entries(nextField).forEach(([branchLabel, targetArr]) => {
        const targets = Array.isArray(targetArr) ? targetArr : [targetArr];
        targets.forEach((tid) => {
          const tNode = nodesMap[tid];
          const tTitle = tNode ? tNode["제목"] : tid;
          const isYes = branchLabel.includes("예") || branchLabel.includes("양성");
          const btnClass =
            isRedflag && isYes ? "btn-redflag-branch" : isYes ? "btn-yes" : "btn-no";
          branchButtonsHtml += `
            <button type="button" class="btn ${btnClass} btn-branch-jump" data-target="${escapeHtml(tid)}">
              [${escapeHtml(branchLabel)}] → ${escapeHtml(tid)} (${escapeHtml(tTitle)})
            </button>
          `;
        });
      });
    } else if (Array.isArray(nextField) && nextField.length > 0) {
      nextField.forEach((tid) => {
        const tNode = nodesMap[tid];
        const tTitle = tNode ? tNode["제목"] : tid;
        branchButtonsHtml += `
          <button type="button" class="btn btn-primary btn-branch-jump" style="flex:1;" data-target="${escapeHtml(
            tid
          )}">
            다음: ${escapeHtml(tid)} ${escapeHtml(tTitle)} →
          </button>
        `;
      });
    }

    if (branchButtonsHtml) {
      html += `
        <div>
          <div style="font-size:0.8rem; font-weight:800; color:var(--text-muted); margin-bottom:0.35rem;">
            ⚡ 분기 선택 (클릭 시 다음 노드로 즉시 이동 · 3클릭 내 치료 도달)
          </div>
          <div class="branch-btn-group">${branchButtonsHtml}</div>
        </div>
      `;
    }

    // 4. 내 숙련도 즉시 조정 바 (의사와 함께 진화하는 스킬 연동)
    html += `
      <div class="proficiency-control-bar">
        <span style="font-size:0.82rem; font-weight:800;">🎯 이 노드 내 숙련도(0~5) 기록:</span>
        <select id="detail-prof-select" class="select-input" style="font-size:0.82rem; padding:0.25rem 0.5rem;">
          <option value="0" ${prof === 0 ? "selected" : ""}>Lv.0 미경험 (⛔시행금지)</option>
          <option value="1" ${prof === 1 ? "selected" : ""}>Lv.1 관찰·보조 (⚠️지도필요)</option>
          <option value="2" ${prof === 2 ? "selected" : ""}>Lv.2 지도하 부분 (⚠️지도필요)</option>
          <option value="3" ${prof === 3 ? "selected" : ""}>Lv.3 지도하 완수 (🔶가능)</option>
          <option value="4" ${prof === 4 ? "selected" : ""}>Lv.4 단독 시행 (✅숙련)</option>
          <option value="5" ${prof === 5 ? "selected" : ""}>Lv.5 교육 가능 (🌟마스터)</option>
        </select>
      </div>
    `;

    // 5. 세부 임상 메타데이터 표시
    const kvPairs = [
      ["검사명", node["검사명"]],
      ["배제 대상", node["배제대상"]],
      [
        "민감도 / 특이도 / LR+",
        node["민감도"] ? `민감도 ${node["민감도"]} · 특이도 ${node["특이도"] || "-"} · LR+ ${node["LR+"] || "-"}` : null,
      ],
      ["감별 후보", Array.isArray(node["후보"]) ? node["후보"].join(" / ") : null],
      ["확률 ↑ 소견", node["올리는소견"]],
      ["확률 ↓ 소견", node["내리는소견"]],
      ["🚨 놓치면 위험한 감별", node["위험감별"]],
      ["볼트 질환 노트", Array.isArray(node["질환링크"]) ? node["질환링크"].join(", ") : null],
      ["생활 지도", node["생활지도"]],
      ["흔한 오해", node["흔한오해"]],
      ["하지 말아야 할 것", node["하지말아야할것"]],
      ["측정 지표 / 시점", node["측정지표"] ? `${node["측정지표"]} (${node["측정시점"] || "-"})` : null],
      ["판정 기준", node["판정기준"]],
      ["전원 기준", node["전원기준"]],
      ["학술 근거", node["근거"]],
    ];

    let kvHtml = "";
    kvPairs.forEach(([label, val]) => {
      if (val) {
        kvHtml += `
          <div class="detail-kv-item">
            <span class="detail-kv-label">${escapeHtml(label)}:</span>
            <span>${escapeHtml(val)}</span>
          </div>
        `;
      }
    });

    if (nodeEvoStat && nodeEvoStat.total > 0) {
      kvHtml += `
        <div class="detail-kv-item" style="background:#f0fdf4; border-color:#86efac;">
          <span class="detail-kv-label">🧬 내 임상 누적 반응률:</span>
          <span><strong>${nodeEvoStat.rate}%</strong> (${nodeEvoStat.responders}/${
        nodeEvoStat.total
      }건 호전)</span>
        </div>
      `;
    }

    html += `<div class="detail-kv-list">${kvHtml}</div>`;

    // 6. 하단 편집/케이스 액션 버튼
    html += `
      <div class="form-actions-spread" style="border-top:1px solid var(--border-light); padding-top:0.75rem;">
        <button type="button" id="btn-detail-edit-node" class="btn btn-sm btn-secondary">
          ✏️ 이 노드 수정
        </button>
        <button type="button" id="btn-detail-branch-node" class="btn btn-sm btn-outline">
          🌿 하위 분기 가지치기
        </button>
        <button type="button" id="btn-detail-record-case" class="btn btn-sm btn-primary">
          📝 케이스 결과 기록
        </button>
      </div>
    `;

    nodeDetailContent.innerHTML = html;

    // 이벤트 바인딩
    nodeDetailContent.querySelectorAll(".btn-branch-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        selectTreeNode(targetId, true);
      });
    });

    const copyTreatBtn = document.getElementById("btn-copy-treat-set");
    if (copyTreatBtn) {
      copyTreatBtn.addEventListener("click", () => {
        const pre = document.getElementById("treat-copy-text");
        if (pre) copyToClipboard(pre.textContent, `${node.id} 치료 세트`);
      });
    }

    nodeDetailContent.querySelectorAll(".btn-open-patient-teach").forEach((btn) => {
      btn.addEventListener("click", () => {
        openPatientTeachModal(node);
      });
    });

    const profSelect = document.getElementById("detail-prof-select");
    if (profSelect) {
      profSelect.addEventListener("change", async (e) => {
        const newLevel = Number(e.target.value);
        await updateNodeProficiency(node, newLevel);
      });
    }

    const editBtn = document.getElementById("btn-detail-edit-node");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        loadNodeIntoEditor(activeSymptomCode, node, false);
        switchView("evolve");
      });
    }

    const branchBtn = document.getElementById("btn-detail-branch-node");
    if (branchBtn) {
      branchBtn.addEventListener("click", () => {
        loadNodeIntoEditor(activeSymptomCode, node, true);
        switchView("evolve");
      });
    }

    const recCaseBtn = document.getElementById("btn-detail-record-case");
    if (recCaseBtn) {
      recCaseBtn.addEventListener("click", () => {
        switchView("cases");
      });
    }
  }

  /* ==================== 환자 교육용 24px+ 큰 글씨 전체화면 모달 ==================== */
  function openPatientTeachModal(node) {
    teachModalTitle.textContent = `${node["제목"]}`;
    const blocks = [];

    if (node["환자설명"]) {
      blocks.push(`
        <div class="teach-card-block">
          <div class="teach-block-label">🩺 현재 상태와 치료 안내</div>
          <div>${escapeHtml(node["환자설명"])}</div>
        </div>
      `);
    }
    if (node["생활지도"]) {
      blocks.push(`
        <div class="teach-card-block">
          <div class="teach-block-label">✅ 일상에서 꼭 실천해 주세요</div>
          <div>${escapeHtml(node["생활지도"])}</div>
        </div>
      `);
    }
    if (node["흔한오해"]) {
      blocks.push(`
        <div class="teach-card-block warn">
          <div class="teach-block-label">💡 자주 하시는 오해</div>
          <div>${escapeHtml(node["흔한오해"])}</div>
        </div>
      `);
    }
    if (node["하지말아야할것"]) {
      blocks.push(`
        <div class="teach-card-block danger">
          <div class="teach-block-label">🚫 피하셔야 할 행동</div>
          <div>${escapeHtml(node["하지말아야할것"])}</div>
        </div>
      `);
    }
    if (node["전원기준"]) {
      blocks.push(`
        <div class="teach-card-block danger">
          <div class="teach-block-label">🚨 이럴 때는 즉시 큰 병원(응급실)으로 가셔야 합니다</div>
          <div>${escapeHtml(node["전원기준"])}</div>
        </div>
      `);
    }

    teachModalBody.innerHTML = blocks.join("");
    teachModal.hidden = false;
  }

  /* ==================== VIEW 3: 내 스킬 레지스트리 & 숙련도(0~5) ==================== */
  async function updateNodeProficiency(node, newLevel) {
    node["내숙련도"] = newLevel;

    // 커스텀 노드 오버레이에도 저장
    const sym = mergedTreeData["증상"][activeSymptomCode];
    const entryItem = {
      id: node.id,
      symCode: activeSymptomCode,
      symName: sym ? sym.name : activeSymptomCode,
      parentBranch: "",
      node: JSON.parse(JSON.stringify(node)),
    };
    const idx = customNodesList.findIndex((x) => x.id === node.id);
    if (idx >= 0) customNodesList[idx] = entryItem;
    else customNodesList.push(entryItem);
    await dbPut("custom_nodes", entryItem);

    // 연결된 스킬이 있으면 스킬 숙련도도 함께 업데이트
    for (const sk of skillsList) {
      if ((sk.linkedNodes || []).includes(node.id)) {
        sk.level = newLevel;
        await dbPut("skills", sk);
      }
    }

    rebuildMergedTree();
    renderTreeWorkspace();
    showToast(`🎯 ${node.id} 숙련도가 Lv.${newLevel}(으)로 기록되었습니다.`);
  }

  function renderSkillRegistry() {
    const container = document.getElementById("skill-list-grid");
    if (!container) return;

    if (skillsList.length === 0) {
      container.innerHTML = '<p class="empty-text">등록된 스킬이 없습니다. 위 폼에서 첫 스킬을 등록하세요.</p>';
      return;
    }

    container.innerHTML = "";
    skillsList.forEach((sk) => {
      const lv = Number(sk.level) || 0;
      const card = document.createElement("div");
      card.className = "skill-card";
      card.innerHTML = `
        <div class="skill-card-header">
          <div>
            <span class="node-id-badge">${escapeHtml(sk.id)} · ${escapeHtml(sk.category)}</span>
            <h3 style="font-size:1rem; font-weight:800; margin-top:0.25rem;">${escapeHtml(sk.name)}</h3>
          </div>
          <span class="prof-chip prof-${lv}">Lv.${lv}</span>
        </div>
        <div style="font-size:0.84rem; color:var(--text-muted);">${escapeHtml(sk.notes || "")}</div>
        <div style="font-size:0.78rem; color:#0369a1; font-weight:700;">
          연결 노드: ${escapeHtml((sk.linkedNodes || []).join(", ") || "없음")}
        </div>
        <div class="skill-controls">
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <label style="font-size:0.78rem; font-weight:700;">숙련도:</label>
            <select class="select-input skill-lv-change" data-id="${escapeHtml(sk.id)}" style="font-size:0.8rem; padding:0.2rem 0.45rem;">
              <option value="0" ${lv === 0 ? "selected" : ""}>Lv.0 미경험(⛔)</option>
              <option value="1" ${lv === 1 ? "selected" : ""}>Lv.1 관찰(⚠️)</option>
              <option value="2" ${lv === 2 ? "selected" : ""}>Lv.2 부분시행(⚠️)</option>
              <option value="3" ${lv === 3 ? "selected" : ""}>Lv.3 지도하완수(🔶)</option>
              <option value="4" ${lv === 4 ? "selected" : ""}>Lv.4 단독시행(✅)</option>
              <option value="5" ${lv === 5 ? "selected" : ""}>Lv.5 교육가능(🌟)</option>
            </select>
          </div>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <span style="font-size:0.8rem; font-weight:700;">시행: ${Number(sk.count || 0)}회</span>
            <button type="button" class="btn btn-sm btn-outline skill-inc-count" data-id="${escapeHtml(sk.id)}">
              +1회 시행 기록
            </button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll(".skill-lv-change").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        const id = sel.getAttribute("data-id");
        const sk = skillsList.find((x) => x.id === id);
        if (!sk) return;
        sk.level = Number(e.target.value);
        sk.updated = new Date().toISOString().slice(0, 10);
        await dbPut("skills", sk);
        rebuildMergedTree();
        renderSkillRegistry();
        showToast(`✅ 스킬 ${sk.id} 숙련도가 Lv.${sk.level}(으)로 변경되었습니다.`);
      });
    });

    container.querySelectorAll(".skill-inc-count").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const sk = skillsList.find((x) => x.id === id);
        if (!sk) return;
        sk.count = Number(sk.count || 0) + 1;
        sk.updated = new Date().toISOString().slice(0, 10);
        await dbPut("skills", sk);
        renderSkillRegistry();
        showToast(`📈 ${sk.name} 누적 시행 ${sk.count}회 기록!`);
      });
    });
  }

  /* ==================== VIEW 4: 케이스 기록 & 진화 피드백 엔진 ==================== */
  function syncCaseFormWithCurrentPath() {
    const symInput = document.getElementById("case-symptom-input");
    const pathInput = document.getElementById("case-path-input");
    const dxInput = document.getElementById("case-dx-input");

    if (symInput) symInput.value = activeSymptomCode;
    if (pathInput && currentPath.length > 0) {
      pathInput.value = currentPath.join(", ");
    }

    // 경로 내 dx 노드가 있으면 최종진단 자동 추천
    if (dxInput && !dxInput.value && mergedTreeData && mergedTreeData["증상"][activeSymptomCode]) {
      const nodesMap = mergedTreeData["증상"][activeSymptomCode].nodes || {};
      const dxNodeId = currentPath.find((id) => nodesMap[id] && nodesMap[id]["유형"] === "dx");
      if (dxNodeId) {
        dxInput.value = nodesMap[dxNodeId]["제목"].replace(" 감별", "");
      }
    }
  }

  function formatCaseToMarkdown(c) {
    return [
      `### ${c.caseId} (${c.date} · ${c.symptom})`,
      "```yaml",
      `case: ${c.caseId}`,
      `날짜: ${c.date}`,
      `증상: ${c.symptom}`,
      `경로: [${(c.path || []).join(", ")}]`,
      `최종진단: ${c.finalDx}`,
      `결과: {NRS_전: ${c.nrsBefore}, NRS_후: ${c.nrsAfter}, 시점: ${c.timepoint}}`,
      `개정후보: "${(c.memo || "").replace(/"/g, "'")}"`,
      "```",
    ].join("\n");
  }

  function renderCasesAndEvolution() {
    const evoContainer = document.getElementById("evolution-signals");
    const historyContainer = document.getElementById("case-history-list");
    if (!evoContainer || !historyContainer) return;

    const stats = computeNodeEvolutionStats();
    const statEntries = Object.entries(stats).sort((a, b) => b[1].total - a[1].total);

    if (statEntries.length === 0) {
      evoContainer.innerHTML =
        '<p class="empty-text">아직 기록된 케이스가 없습니다. 좌측에서 케이스를 저장하거나 우측 상단 [⚡ 샘플 케이스 6건 생성] 버튼을 눌러 진화 시뮬레이션을 확인해 보세요.</p>';
    } else {
      evoContainer.innerHTML = "";
      statEntries.forEach(([nid, st]) => {
        // 치료(L4) 또는 감별(L3) 또는 메모가 있는 노드 위주로 표시
        if (!nid.includes("-L4-") && !nid.includes("-L3-") && st.memos.length === 0) return;

        let badge = `<span class="mini-badge" style="background:#e2e8f0;">표본 수집 중 (n=${st.total})</span>`;
        let cls = "";
        if (st.signal === "promote") {
          badge = `<span class="mini-badge badge-first-choice">🌟 1차 선택 승격 (반응률 ${st.rate}% ≥ 70%, n=${st.total})</span>`;
          cls = "promote";
        } else if (st.signal === "demote") {
          badge = `<span class="mini-badge badge-revise-candidate">🔧 대안 분기 추가·강등 후보 (반응률 ${st.rate}% < 40%, n=${st.total})</span>`;
          cls = "demote";
        }

        const uniqueMemos = Array.from(new Set(st.memos)).slice(0, 2);
        const card = document.createElement("div");
        card.className = `evo-card ${cls}`;
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
            <strong>${escapeHtml(nid)}</strong>
            ${badge}
          </div>
          <div style="font-size:0.84rem;">
            누적 케이스: <strong>${st.total}건</strong> · 호전(NRS 50%↓): <strong>${st.responders}건 (${st.rate}%)</strong>
          </div>
          ${
            uniqueMemos.length > 0
              ? `<div style="font-size:0.8rem; color:#334155;">💡 누적 개정 메모: ${escapeHtml(
                  uniqueMemos.join(" / ")
                )}</div>`
              : ""
          }
        `;
        evoContainer.appendChild(card);
      });
    }

    if (casesList.length === 0) {
      historyContainer.innerHTML = '<p class="empty-text">저장된 케이스가 없습니다.</p>';
    } else {
      historyContainer.innerHTML = "";
      casesList
        .slice()
        .reverse()
        .forEach((c) => {
          const item = document.createElement("div");
          item.className = "case-item";
          item.innerHTML = `
            <div>
              <div style="font-weight:800; font-size:0.88rem;">
                ${escapeHtml(c.caseId)} · ${escapeHtml(c.symptom)} — ${escapeHtml(c.finalDx)}
                <span style="color:#0284c7;">(NRS ${c.nrsBefore} → ${c.nrsAfter}, ${escapeHtml(c.timepoint)})</span>
              </div>
              <div style="font-size:0.78rem; color:var(--text-muted);">
                경로: ${escapeHtml((c.path || []).join(" → "))}
              </div>
              ${
                c.memo
                  ? `<div style="font-size:0.78rem; color:#475569;">메모: ${escapeHtml(c.memo)}</div>`
                  : ""
              }
            </div>
            <button type="button" class="btn btn-sm btn-outline btn-copy-one-case" data-case-id="${escapeHtml(
              c.caseId
            )}">
              📋 md 복사
            </button>
          `;
          historyContainer.appendChild(item);
        });

      historyContainer.querySelectorAll(".btn-copy-one-case").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cid = btn.getAttribute("data-case-id");
          const target = casesList.find((x) => x.caseId === cid);
          if (target) {
            copyToClipboard(formatCaseToMarkdown(target), `${cid} 케이스 md`);
          }
        });
      });
    }
  }

  /* ==================== VIEW 5: 가지치기 편집기 & AI(LLM Wiki) 협업 워크벤치 ==================== */
  function loadNodeIntoEditor(symCode, node, asChildBranch) {
    const sym = mergedTreeData["증상"][symCode];
    document.getElementById("edit-sym-code").value = symCode;
    document.getElementById("edit-sym-name").value = sym ? sym.name : symCode;

    if (asChildBranch) {
      // 현재 노드를 부모로 하는 새 하위 노드 ID 자동 제안
      const curLayerMatch = String(node.id).match(/-L([0-5])-/);
      const nextLayerNum = curLayerMatch ? Math.min(5, Number(curLayerMatch[1]) + 1) : 1;
      const existingIds = Object.keys(sym ? sym.nodes : {});
      let seq = 1;
      let candidateId = "";
      do {
        candidateId = `${symCode}-L${nextLayerNum}-${String(seq).padStart(2, "0")}`;
        seq += 1;
      } while (existingIds.includes(candidateId));

      document.getElementById("edit-node-id").value = candidateId;
      document.getElementById("edit-node-parent").value = node.id;
      document.getElementById("edit-parent-branch").value = "추가분기";
      document.getElementById("edit-node-title").value = "";
      document.getElementById("edit-node-cond").value = `${node.id} 분기`;
      document.getElementById("edit-node-primary").value = "";
      document.getElementById("edit-node-secondary").value = "";
      document.getElementById("edit-node-next").value = "";
      showToast(`🌿 ${node.id}에서 파생되는 새 노드(${candidateId}) 양식이 준비되었습니다.`);
    } else {
      // 기존 노드 수정
      document.getElementById("edit-node-id").value = node.id;
      document.getElementById("edit-node-type").value = node["유형"] || "ask";
      document.getElementById("edit-node-parent").value = node["상위"] || "";
      document.getElementById("edit-parent-branch").value = "";
      document.getElementById("edit-node-title").value = node["제목"] || "";
      document.getElementById("edit-node-cond").value = node["조건"] || "";
      document.getElementById("edit-node-status").value = node["상태"] || "검토";
      document.getElementById("edit-node-trust").value = node["신뢰도"] || "상";
      document.getElementById("edit-node-prof").value = String(
        typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4
      );
      document.getElementById("edit-node-redflag").value = node["레드플래그"] === true ? "true" : "false";

      // 다음 노드 직렬화
      const nxt = node["다음"];
      if (Array.isArray(nxt)) {
        document.getElementById("edit-node-next").value = nxt.join(", ");
      } else if (nxt && typeof nxt === "object") {
        document.getElementById("edit-node-next").value = Object.entries(nxt)
          .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join("|") : v}`)
          .join(", ");
      } else {
        document.getElementById("edit-node-next").value = "";
      }

      document.getElementById("edit-node-primary").value =
        node["질문"] ||
        node["술기세트"] ||
        node["환자설명"] ||
        node["검사명"] ||
        (Array.isArray(node["후보"]) ? node["후보"].join(", ") : "") ||
        node["측정지표"] ||
        "";
      document.getElementById("edit-node-secondary").value =
        node["왜"] ||
        node["자침점용량"] ||
        node["생활지도"] ||
        node["배제대상"] ||
        node["위험감별"] ||
        node["판정기준"] ||
        "";
      document.getElementById("edit-node-referral").value = node["전원기준"] || "";
      document.getElementById("edit-node-evidence").value = node["근거"] || "";
    }
  }

  function parseNextFieldInput(rawStr) {
    const str = (rawStr || "").trim();
    if (!str) return [];
    if (str.includes(":")) {
      const out = {};
      str.split(",").forEach((part) => {
        if (part.includes(":")) {
          const [k, v] = part.split(":", 2);
          const targets = v
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean);
          if (k.trim() && targets.length > 0) {
            out[k.trim()] = targets;
          }
        }
      });
      return out;
    }
    return str
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function buildNodeObjectFromEditor() {
    const symCode = document.getElementById("edit-sym-code").value.trim().toUpperCase();
    const symName = document.getElementById("edit-sym-name").value.trim() || symCode;
    const nodeId = document.getElementById("edit-node-id").value.trim().toUpperCase();
    const ntype = document.getElementById("edit-node-type").value;
    const parentId = document.getElementById("edit-node-parent").value.trim().toUpperCase();
    const parentBranch = document.getElementById("edit-parent-branch").value.trim();
    const title = document.getElementById("edit-node-title").value.trim();
    const cond = document.getElementById("edit-node-cond").value.trim();
    const status = document.getElementById("edit-node-status").value;
    const trust = document.getElementById("edit-node-trust").value;
    const prof = Number(document.getElementById("edit-node-prof").value);
    const isRedflag = document.getElementById("edit-node-redflag").value === "true";
    const nextVal = parseNextFieldInput(document.getElementById("edit-node-next").value);
    const primary = document.getElementById("edit-node-primary").value.trim();
    const secondary = document.getElementById("edit-node-secondary").value.trim();
    const referral = document.getElementById("edit-node-referral").value.trim();
    const evidence = document.getElementById("edit-node-evidence").value.trim() || "임상 경험 및 가이드라인 (PMID 미확인)";

    const node = {
      id: nodeId,
      유형: ntype,
      제목: title,
      상태: status,
      신뢰도: trust,
      근거: evidence,
      내숙련도: prof,
      다음: nextVal,
      개정: new Date().toISOString().slice(0, 10),
      파일: `${symName}/커스텀_${nodeId}.md#${nodeId}`,
    };

    if (parentId) node["상위"] = parentId;
    if (cond) node["조건"] = cond;
    if (referral) node["전원기준"] = referral;

    if (ntype === "ask") {
      node["레드플래그"] = isRedflag;
      node["질문"] = primary;
      node["왜"] = secondary || "임상 감별 분기 확인";
      node["본문"] = `- **질문**: ${primary}\n- **왜 묻는가**: ${node["왜"]}`;
    } else if (ntype === "test") {
      node["검사명"] = primary;
      node["배제대상"] = secondary || "주요 감별 질환 배제";
      node["본문"] = `- **검사명**: ${primary}\n- **무엇을 배제하는가**: ${node["배제대상"]}`;
    } else if (ntype === "dx") {
      node["후보"] = primary.split(",").map((x) => x.trim()).filter(Boolean);
      node["위험감별"] = secondary || "중추성·응급 질환 배제";
      node["질환링크"] = [`[[${node["후보"][0] || title}]]`];
      node["본문"] = `- **후보**: ${primary}\n- **놓치면 위험한 감별**: ${node["위험감별"]}`;
    } else if (ntype === "treat") {
      node["술기세트"] = primary;
      node["자침점용량"] = secondary || "표준 자침점 및 용량";
      node["재평가시점"] = "치료 1주 후 및 2주 후";
      node["전원기준"] = referral || "2주 무반응 또는 신경학적 이상 발생 시 전원";
      node["환자설명"] = `${title} 치료를 통해 긴장된 조직과 신경을 안정시킵니다. 꾸준히 치료받으시면 통증이 단계적으로 완화됩니다. 이상 증상 발생 시 즉시 정밀 검사를 의뢰합니다.`;
      node["본문"] = `- **술기 세트**: ${primary}\n- **자침점·용량**: ${node["자침점용량"]}\n- **전원 기준**: ${node["전원기준"]}`;
    } else if (ntype === "teach") {
      node["환자설명"] = primary;
      node["생활지도"] = secondary || "규칙적인 수면과 바른 자세 유지";
      node["전원기준"] = referral || "급격한 악화 또는 신경학적 결손 시 즉시 전원";
      node["본문"] = `- **환자 설명 3문장**: ${primary}\n- **생활 지도**: ${node["생활지도"]}`;
    } else {
      node["측정지표"] = primary;
      node["판정기준"] = secondary || "NRS 50% 이상 호전 여부";
      node["본문"] = `- **측정 지표**: ${primary}\n- **판정 기준**: ${node["판정기준"]}`;
    }

    return { symCode, symName, parentBranch, node };
  }

  function formatNodeToVaultMarkdown(node) {
    const lines = [`## ${node.id} ${node["제목"]}`, "", "```yaml"];
    lines.push(`id: ${node.id}`);
    lines.push(`유형: ${node["유형"]}`);
    lines.push(`제목: "${String(node["제목"] || "").replace(/"/g, "'")}"`);
    if (node["상위"]) lines.push(`상위: ${node["상위"]}`);
    if (node["조건"]) lines.push(`조건: "${String(node["조건"]).replace(/"/g, "'")}"`);

    const nxt = node["다음"];
    if (Array.isArray(nxt)) {
      lines.push(`다음: [${nxt.join(", ")}]`);
    } else if (nxt && typeof nxt === "object") {
      lines.push("다음:");
      Object.entries(nxt).forEach(([k, v]) => {
        const arr = Array.isArray(v) ? v : [v];
        lines.push(`  ${k}: [${arr.join(", ")}]`);
      });
    }

    if (typeof node["레드플래그"] === "boolean") {
      lines.push(`레드플래그: ${node["레드플래그"]}`);
    }
    lines.push(`근거: "${String(node["근거"] || "PMID 미확인").replace(/"/g, "'")}"`);
    lines.push(`신뢰도: ${node["신뢰도"] || "상"}`);
    lines.push(`상태: ${node["상태"] || "검토"}`);
    lines.push(`내숙련도: ${typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4}`);

    const extraKeys = [
      "질문",
      "왜",
      "검사명",
      "배제대상",
      "위험감별",
      "술기세트",
      "자침점용량",
      "재평가시점",
      "전원기준",
      "환자설명",
      "생활지도",
      "측정지표",
      "판정기준",
    ];
    extraKeys.forEach((k) => {
      if (node[k]) {
        lines.push(`${k}: "${String(node[k]).replace(/"/g, "'")}"`);
      }
    });

    lines.push(`개정: ${node["개정"] || "2026-11-18"}`);
    lines.push("```");
    lines.push("");
    lines.push(node["본문"] || "");
    return lines.join("\n");
  }

  function generateAiPathConsultBrief() {
    if (!mergedTreeData || !mergedTreeData["증상"][activeSymptomCode]) return "";
    const sym = mergedTreeData["증상"][activeSymptomCode];
    const nodesMap = sym.nodes || {};

    const pathDetails = currentPath
      .map((nid, idx) => {
        const n = nodesMap[nid];
        if (!n) return `${idx + 1}. ${nid}`;
        const summary =
          n["질문"] || n["검사명"] || n["술기세트"] || n["환자설명"] || n["제목"];
        return `${idx + 1}. [${n.id} · ${n["유형"]} · 숙련도 Lv.${n["내숙련도"] ?? "-"}] ${n["제목"]}\n   - 내용: ${summary}\n   - 근거: ${n["근거"] || "-"}`;
      })
      .join("\n");

    return [
      `# [CLIN-7 LLM Wiki 진료 경로 AI 3줄 점검 요청]`,
      `- 증상: ${sym.name} (${activeSymptomCode})`,
      `- 현재 걸어온 프로토콜 경로: ${currentPath.join(" → ")}`,
      "",
      `## 걸어온 노드 컨텍스트`,
      pathDetails,
      "",
      `## AI 응답 규칙 (노드 근거 기반 3줄 점검)`,
      `위 경로만 컨텍스트로 삼아 아래 3가지를 각 1~2줄로 간결하게 점검해 주십시오:`,
      `1. [아직 안 물어본 것 / 추가 문진·검사]: 현재 분기에서 놓치기 쉬운 추가 질문이나 이학적 검사`,
      `2. [감별 누락 / 레드플래그]: 반드시 배제해야 할 위험 감별진단`,
      `3. [금기 / 내 숙련도 위험]: 선택된 치료 노드의 금기사항 또는 숙련도(Lv.0~2) 주의점`,
    ].join("\n");
  }

  function generateAiEvolutionBrief() {
    const stats = computeNodeEvolutionStats();
    const lines = [
      `# [CLIN-7 프로토콜 진화 & 새 분기 공동 설계 브리프]`,
      `- 현재 선택 증상: ${activeSymptomCode}`,
      `- 누적 케이스 수: ${casesList.length}건`,
      "",
      `## 1. 노드별 치료 반응률 & 진화 신호`,
    ];

    Object.entries(stats).forEach(([nid, st]) => {
      lines.push(
        `- ${nid}: 누적 ${st.total}건 중 ${st.responders}건 호전 (반응률 ${st.rate}%) ${
          st.signal === "promote"
            ? "→ [🌟 1차 선택 승격]"
            : st.signal === "demote"
            ? "→ [🔧 대안 분기 추가 필요]"
            : ""
        }`
      );
      if (st.memos.length > 0) {
        lines.push(`  - 임상 개정 메모: ${Array.from(new Set(st.memos)).join(" | ")}`);
      }
    });

    lines.push("");
    lines.push(`## 2. AI 공동 작업 요청`);
    lines.push(
      `위 임상 피드백과 개정 메모를 바탕으로 \`00_스키마.md\` 규격(\`## ID 제목\` + \`yaml\` 블록)에 맞춰 추가하거나 세분화할 새로운 문진(L1)/검사(L2)/치료(L4) 노드를 작성해 주십시오.`
    );
    return lines.join("\n");
  }

  function renderEvolveWorkbench() {
    updateNavCounters();
  }

  /* ==================== 이벤트 리스너 등록 ==================== */
  function bindEvents() {
    // 상단 탭 네비게이션
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchView(btn.getAttribute("data-view"));
      });
    });

    // 홈 검색창
    searchInput.addEventListener("input", (e) => {
      renderSymptomGrid(e.target.value);
    });

    const newSymBtn = document.getElementById("btn-new-symptom-modal");
    if (newSymBtn) {
      newSymBtn.addEventListener("click", () => {
        switchView("evolve");
      });
    }

    // 트리 증상 드롭다운
    if (treeSymptomSelect) {
      treeSymptomSelect.addEventListener("change", (e) => {
        openSymptomInTree(e.target.value);
      });
    }

    // 경로 바 버튼들
    document.getElementById("btn-path-undo").addEventListener("click", () => {
      if (currentPath.length > 1) {
        currentPath.pop();
        activeNodeId = currentPath[currentPath.length - 1];
        renderTreeWorkspace();
      }
    });

    document.getElementById("btn-path-reset").addEventListener("click", () => {
      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry) {
        activeNodeId = sym.entry;
        currentPath = [sym.entry];
        renderTreeWorkspace();
      }
    });

    document.getElementById("btn-path-branch").addEventListener("click", () => {
      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.nodes[activeNodeId]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[activeNodeId], true);
        switchView("evolve");
      }
    });

    document.getElementById("btn-path-to-case").addEventListener("click", () => {
      switchView("cases");
    });

    document.getElementById("btn-tree-add-child").addEventListener("click", () => {
      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.nodes[activeNodeId]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[activeNodeId], true);
        switchView("evolve");
      }
    });

    document.getElementById("btn-tree-ai-check").addEventListener("click", () => {
      const brief = generateAiPathConsultBrief();
      copyToClipboard(brief, "현재 진료 경로 AI 점검 브리프");
    });

    // 환자 교육 모달 닫기
    document.getElementById("btn-close-teach-modal").addEventListener("click", () => {
      teachModal.hidden = true;
    });

    // 스킬 추가 폼
    document.getElementById("skill-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("skill-id-input").value.trim().toUpperCase();
      const category = document.getElementById("skill-category-input").value;
      const name = document.getElementById("skill-name-input").value.trim();
      const level = Number(document.getElementById("skill-level-input").value);
      const linkedRaw = document.getElementById("skill-linked-nodes").value;
      const notes = document.getElementById("skill-notes-input").value.trim();

      const linkedNodes = linkedRaw
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);

      const existing = skillsList.find((x) => x.id === id);
      const skillObj = {
        id,
        category,
        name,
        level,
        count: existing ? existing.count : 0,
        linkedNodes,
        notes,
        updated: new Date().toISOString().slice(0, 10),
      };

      if (existing) {
        Object.assign(existing, skillObj);
      } else {
        skillsList.push(skillObj);
      }

      await dbPut("skills", skillObj);
      rebuildMergedTree();
      renderSkillRegistry();
      e.target.reset();
      showToast(`🎯 내 스킬(${id} ${name})이 등록·동기화되었습니다.`);
    });

    // 스킬 레지스트리 md 내보내기
    document.getElementById("btn-export-skills-md").addEventListener("click", () => {
      const lines = [
        "# 내 임상 스킬 레지스트리 (00_스킬_레지스트리.md)",
        "",
        "| 스킬ID | 분류 | 술기명 | 내숙련도(0~5) | 시행횟수 | 연결 노드 | 메모 |",
        "| :--- | :--- | :--- | :---: | :---: | :--- | :--- |",
      ];
      skillsList.forEach((s) => {
        lines.push(
          `| ${s.id} | ${s.category} | ${s.name} | Lv.${s.level} | ${s.count}회 | ${(
            s.linkedNodes || []
          ).join(", ")} | ${s.notes || "-"} |`
        );
      });
      copyToClipboard(lines.join("\n"), "내 스킬 레지스트리 md");
    });

    // 케이스 저장 폼 (비식별 검사 포함)
    document.getElementById("case-record-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const warnEl = document.getElementById("case-phi-warning");
      warnEl.hidden = true;

      const symptom = document.getElementById("case-symptom-input").value;
      const timepoint = document.getElementById("case-timepoint-input").value;
      const pathRaw = document.getElementById("case-path-input").value;
      const nrsBefore = Number(document.getElementById("case-nrs-before").value);
      const nrsAfter = Number(document.getElementById("case-nrs-after").value);
      const finalDx = document.getElementById("case-dx-input").value.trim();
      const memo = document.getElementById("case-memo-input").value.trim();

      const combinedText = `${pathRaw} ${finalDx} ${memo}`;
      if (PHONE_REGEX.test(combinedText) || RRN_REGEX.test(combinedText)) {
        warnEl.textContent =
          "⛔ 환자 식별정보(전화번호 또는 주민등록번호 패턴)가 검출되어 저장할 수 없습니다. 비식별 요약만 기록해 주세요.";
        warnEl.hidden = false;
        return;
      }

      const pathArr = pathRaw
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);

      const caseId = `C-${String(casesList.length + 1).padStart(4, "0")}`;
      const caseObj = {
        caseId,
        date: new Date().toISOString().slice(0, 10),
        symptom,
        path: pathArr,
        nrsBefore,
        nrsAfter,
        timepoint,
        finalDx,
        memo,
      };

      casesList.push(caseObj);
      await dbPut("cases", caseObj);
      updateNavCounters();
      renderCasesAndEvolution();
      copyToClipboard(formatCaseToMarkdown(caseObj), `${caseId} 케이스 md`);
    });

    // 전체 케이스 md 내보내기
    document.getElementById("btn-export-all-cases-md").addEventListener("click", () => {
      if (casesList.length === 0) {
        showToast("저장된 케이스가 없습니다.");
        return;
      }
      const md = ["# 임상 프로토콜 비식별 케이스 로그", ""].concat(
        casesList.map((c) => formatCaseToMarkdown(c) + "\n")
      );
      copyToClipboard(md.join("\n"), `전체 케이스 ${casesList.length}건 md`);
    });

    // 샘플 케이스 6건 시드 생성 (진화 엔진 시뮬레이션)
    document.getElementById("btn-seed-demo-cases").addEventListener("click", async () => {
      const demoCases = [
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-01", "HA-L3-01", "HA-L4-01"],
          nrsBefore: 7,
          nrsAfter: 2,
          timepoint: "1주",
          finalDx: "경추성 두통",
          memo: "풍지·후두하근 아시혈 자침 후 두통 70% 감소",
        },
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-01", "HA-L3-01", "HA-L4-01"],
          nrsBefore: 8,
          nrsAfter: 3,
          timepoint: "1주",
          finalDx: "경추성 두통",
          memo: "천궁다조산 병행 시 야간 뒤통수 뻐근함 빠르게 호전",
        },
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-02", "HA-L3-02", "HA-L4-01"],
          nrsBefore: 6,
          nrsAfter: 2,
          timepoint: "1주",
          finalDx: "긴장형 두통",
          memo: "태양·백회·합곡 자침 반응 우수",
        },
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-02", "HA-L3-02", "HA-L4-01"],
          nrsBefore: 7,
          nrsAfter: 3,
          timepoint: "1주",
          finalDx: "긴장형 두통",
          memo: "턱관절 이갈이 동반 환자로 L1에 TMJ 질문 분기 추가 필요",
        },
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-01", "HA-L3-01", "HA-L4-01"],
          nrsBefore: 6,
          nrsAfter: 1,
          timepoint: "2주",
          finalDx: "경추성 두통",
          memo: "표준 침·부항 세트 5연속 호전 (1차 선택 승격 기준 충족)",
        },
        {
          symptom: "SH",
          path: ["SH-L0-01", "SH-L1-01", "SH-L1-02", "SH-L2-01", "SH-L3-01", "SH-L4-01"],
          nrsBefore: 8,
          nrsAfter: 4,
          timepoint: "2주",
          finalDx: "유착성 관절낭염",
          memo: "야간통 먼저 절반 감소, 외회전 가동범위 15도 증가",
        },
      ];

      for (const dc of demoCases) {
        const cid = `C-${String(casesList.length + 1).padStart(4, "0")}`;
        const obj = Object.assign({ caseId: cid, date: new Date().toISOString().slice(0, 10) }, dc);
        casesList.push(obj);
        await dbPut("cases", obj);
      }

      updateNavCounters();
      renderCasesAndEvolution();
      showToast("⚡ 샘플 케이스 6건이 추가되어 진화 엔진(1차 선택 승격 신호)이 활성화되었습니다!");
    });

    // 가지치기 노드 편집기 저장
    document.getElementById("node-editor-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const item = buildNodeObjectFromEditor();
      if (!/^[A-Z]{2,4}-(L[0-5]|S)-\d{2,3}$/.test(item.node.id)) {
        showToast("⛔ 노드 ID 형식이 올바르지 않습니다 (예: HA-L1-04)");
        return;
      }

      const existingIdx = customNodesList.findIndex((x) => x.id === item.node.id);
      if (existingIdx >= 0) {
        customNodesList[existingIdx] = { id: item.node.id, ...item };
      } else {
        customNodesList.push({ id: item.node.id, ...item });
      }

      await dbPut("custom_nodes", { id: item.node.id, ...item });
      rebuildMergedTree();

      const mdText = formatNodeToVaultMarkdown(item.node);
      await copyToClipboard(mdText, `${item.node.id} 노드 md`);

      activeSymptomCode = item.symCode;
      activeNodeId = item.node.id;
      switchView("tree");
    });

    document.getElementById("btn-reset-editor").addEventListener("click", () => {
      document.getElementById("node-editor-form").reset();
      showToast("새 노드 입력 양식이 초기화되었습니다.");
    });

    document.getElementById("btn-copy-single-node-md").addEventListener("click", () => {
      const item = buildNodeObjectFromEditor();
      copyToClipboard(formatNodeToVaultMarkdown(item.node), `${item.node.id} md`);
    });

    // AI 협업 & 마크다운 패치 내보내기 버튼들
    document.getElementById("btn-gen-ai-consult").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "진료 경로 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-gen-ai-evolution").addEventListener("click", () => {
      copyToClipboard(generateAiEvolutionBrief(), "프로토콜 진화·개정 AI 프롬프트");
    });

    document.getElementById("btn-export-custom-nodes-md").addEventListener("click", () => {
      if (customNodesList.length === 0) {
        showToast("저장된 커스텀 노드가 없습니다.");
        return;
      }
      const md = customNodesList.map((item) => formatNodeToVaultMarkdown(item.node)).join("\n\n");
      copyToClipboard(md, `커스텀 가지치기 노드 ${customNodesList.length}개 md`);
    });

    document.getElementById("btn-clear-custom-nodes").addEventListener("click", async () => {
      customNodesList = [];
      await dbClear("custom_nodes");
      rebuildMergedTree();
      renderEvolveWorkbench();
      showToast("커스텀 노드 오버레이가 초기화되었습니다.");
    });
  }

  /* ==================== 초기화 ==================== */
  async function init() {
    bindEvents();

    // 1. IndexedDB 데이터 로드
    const [savedSkills, savedCases, savedCustomNodes] = await Promise.all([
      dbGetAll("skills"),
      dbGetAll("cases"),
      dbGetAll("custom_nodes"),
    ]);

    if (savedSkills.length === 0) {
      skillsList = DEFAULT_SKILLS.slice();
      for (const sk of skillsList) {
        await dbPut("skills", sk);
      }
    } else {
      skillsList = savedSkills;
    }

    casesList = savedCases;
    customNodesList = savedCustomNodes;

    // 2. /tree.json 로드
    try {
      const res = await fetch("/tree.json", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      baseTreeData = await res.json();
      rebuildMergedTree();

      if (baseTreeData.generated) {
        generatedEl.textContent = `정본 갱신: ${baseTreeData.generated}`;
      } else {
        generatedEl.textContent = "tree.json 로드 완료";
      }

      renderRecentSymptoms();
      renderSymptomGrid("");
      populateSymptomSelects();
    } catch (err) {
      generatedEl.textContent = "로드 실패";
      gridEl.innerHTML = `<p class="error-text">tree.json을 불러오지 못했습니다: ${escapeHtml(
        err.message || String(err)
      )}</p>`;
    }

    // 3. PWA Service Worker 등록
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  init();
})();
