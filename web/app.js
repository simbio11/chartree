/**
 * web/app.js — CLIN-7 진료 프로토콜 나무 (직관적 2모드 개편판)
 *
 * [모드 1: 🩺 실제 진료 모드]
 * - 주호소 알약 버튼 클릭 → 문진(ask) → 검사(test) → 감별(dx) → 치료(treat) → 티칭(teach) 가지가
 *   위에서 아래로 물 흐르듯 자연스럽게 이어지는 타임라인 스트림(Branch Flow Stream) + 우측 큰 집중 카드
 * - 내 진료 루틴(프리셋) 원클릭 적용
 * - 치료 세트(자침점·용량·빈도) 원클릭 복사 + 환자 교육용 24px+ 큰 글씨 전체화면 모달
 * - 하단 3초 케이스 저장 바 (전/후 NRS + 한줄 메모 → IndexedDB 저장 & 진화 통계 반영)
 * - 필요할 때만 펼쳐보는 L0~L5 전체 트리 지도
 *
 * [모드 2: 🛠️ 세팅 · 공부 모드]
 * - 1. 가지치기 트리 설계: 왼쪽 트리 구조에서 [+ '예' 가지 추가] / [+ '아니오' 가지 추가] 버튼 한 번으로
 *      부모-자식 연결이 자동 세팅된 새 노드를 만들고 즉시 반영
 * - 2. 내 진료 루틴(세트) 짜기: 자주 쓰는 [문진→검사→치료→티칭] 경로와 나만의 오더 메모를 루틴으로 저장
 * - 3. 내 진료 스킬 · 숙련도(Lv.0~5): 침·약침·추나·검사 스킬 등록 및 숙련도/시행횟수 기록 (Lv.0~2 자동 경고 연동)
 * - 4. 케이스 진화 통계 · AI 협업: 반응률 기반 1차 선택 승격/개정 후보 자동 포착 및 AI 프롬프트·볼트 md 내보내기
 */

(function () {
  "use strict";

  const RECENT_STORAGE_KEY = "clin7_recent_symptoms_v1";
  const DB_NAME = "clin7_protocol_evolution_db";
  const DB_VERSION = 2;

  const PHONE_REGEX = /\b01[016789]-\d{3,4}-\d{4}\b/;
  const RRN_REGEX = /\b\d{6}-[1-4]\d{6}\b/;

  const LAYER_META = [
    { key: "L0", title: "L0 · 증상 진입" },
    { key: "L1", title: "L1 · 분기 문진" },
    { key: "L2", title: "L2 · 이학적 검사" },
    { key: "L3", title: "L3 · 감별 진단" },
    { key: "L4", title: "L4 · 치료·티칭" },
    { key: "L5", title: "L5 · 결과·전원" },
  ];

  const TYPE_KOREAN = {
    ask: "❓ 문진 질문",
    test: "🔬 이학적 검사",
    dx: "🩺 감별 진단",
    treat: "💊 치료 세트",
    teach: "🗣️ 환자 설명",
    outcome: "📊 결과·전원",
    skill: "🎯 술기 스킬",
  };

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

  const DEFAULT_ROUTINES = [
    {
      id: "RT-01",
      symptom: "HA",
      name: "경추성 두통 표준 침·부항·천궁다조산 루틴",
      path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-01", "HA-L3-01", "HA-L4-01"],
      orderMemo: "1) SNOOP4 레드플래그 배제 → 2) CFRT 회전제한 확인 → 3) 풍지·태양·합곡·후두하근 아시혈 15분 유침 + 건식부항 + 천궁다조산 3일분",
    },
    {
      id: "RT-02",
      symptom: "HA",
      name: "긴장형 두통 두개주위 근막이완 + 생활티칭 루틴",
      path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-02", "HA-L3-02", "HA-L4-01", "HA-L4-03"],
      orderMemo: "1) 측두근·승모근 압통 확인 → 2) 백회·태양·풍지·합곡·태충 자침 → 3) 진통제 과용 주의 및 스마트폰 목 스트레칭 티칭",
    },
    {
      id: "RT-03",
      symptom: "SH",
      name: "오십견(유착성 관절낭염) 야간통 완화 침·서근탕 루틴",
      path: ["SH-L0-01", "SH-L1-01", "SH-L1-02", "SH-L2-01", "SH-L3-01", "SH-L4-01", "SH-L4-03"],
      orderMemo: "1) 수동 외회전(PROM) 제한 확인 → 2) 견우·견료·천종·곡지 전침 15분 + 서근탕 → 3) 수면 시 아픈 어깨 아래 낮은 베개 받치기 티칭",
    },
    {
      id: "RT-04",
      symptom: "DZ",
      name: "말초성 어지럼(전정신경염) 침·반하백출천마탕 루틴",
      path: ["DZ-L0-01", "DZ-L1-01", "DZ-L1-02", "DZ-L2-01", "DZ-L3-01", "DZ-L4-01", "DZ-L4-02"],
      orderMemo: "1) HINTS 중추성 배제 → 2) 백회·풍지·예풍·내관·족삼리 자침 + 반하백출천마탕 → 3) 시선 고정 고개 회전 전정재활운동 티칭",
    },
  ];

  // 전역 상태
  let baseTreeData = null;
  let mergedTreeData = null;
  let customNodesList = [];
  let skillsList = [];
  let routinesList = [];
  let casesList = [];

  let currentMode = "clinic"; // "clinic" | "setup"
  let currentSubview = "builder"; // "builder" | "routines" | "skills" | "evolution"
  let activeSymptomCode = "HA";
  let activeNodeId = "HA-L0-01";
  let currentPath = ["HA-L0-01"];
  // 각 단계에서 어떤 답변(예/아니오/양성 등)을 눌러 다음으로 갔는지 기록
  let pathDecisions = {}; // { fromNodeId: "예" }

  // DOM 참조
  const gridEl = document.getElementById("symptom-grid");
  const searchInput = document.getElementById("symptom-search");
  const generatedEl = document.getElementById("generated-time");
  const statsEl = document.getElementById("summary-stats");
  const recentSection = document.getElementById("recent-section");
  const recentList = document.getElementById("recent-list");
  const nodeSearchSection = document.getElementById("node-search-results-section");
  const nodeSearchGrid = document.getElementById("node-search-results");

  const pathwayChips = document.getElementById("pathway-chips");
  const branchFlowStream = document.getElementById("branch-flow-stream");
  const nodeDetailPanel = document.getElementById("node-detail-panel");
  const nodeDetailContent = document.getElementById("node-detail-content");
  const fullTreeDrawer = document.getElementById("full-tree-map-drawer");
  const treeColumnsEl = document.getElementById("tree-columns");

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
    } catch (_) {}
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
      showToast(`미리보기에 생성됨: ${label}`);
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
        if (!db.objectStoreNames.contains("routines")) {
          db.createObjectStore("routines", { keyPath: "id" });
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
    } catch (_) {}
  }

  async function dbDelete(storeName, key) {
    try {
      const db = await openDatabase();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (_) {}
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

  /* ==================== 트리 병합 & 통계 ==================== */
  function rebuildMergedTree() {
    if (!baseTreeData) return;
    mergedTreeData = JSON.parse(JSON.stringify(baseTreeData));
    if (!mergedTreeData["증상"]) mergedTreeData["증상"] = {};

    // 1. 커스텀 가지치기 노드 병합
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

      if (nodeObj["상위"] && sym.nodes[nodeObj["상위"]]) {
        const parent = sym.nodes[nodeObj["상위"]];
        const branchLabel = item.parentBranch || "다음";
        if (!parent["다음"] || (Array.isArray(parent["다음"]) && parent["다음"].length === 0)) {
          if (item.parentBranch) {
            parent["다음"] = { [branchLabel]: [nodeObj.id] };
          } else {
            parent["다음"] = [nodeObj.id];
          }
        } else if (Array.isArray(parent["다음"])) {
          if (item.parentBranch) {
            const existingArr = parent["다음"].slice();
            parent["다음"] = { 기본: existingArr, [branchLabel]: [nodeObj.id] };
          } else if (!parent["다음"].includes(nodeObj.id)) {
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

    // 2. 스킬 레지스트리 숙련도 동기화
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

    updateBadges();
  }

  function updateBadges() {
    const skEl = document.getElementById("nav-skill-count");
    const csEl = document.getElementById("nav-case-count");
    const cuEl = document.getElementById("nav-custom-count");
    const rtEl = document.getElementById("badge-routine-count");
    const badgeCu = document.getElementById("custom-node-badge-count");

    if (skEl) skEl.textContent = String(skillsList.length);
    if (csEl) csEl.textContent = String(casesList.length);
    if (cuEl) cuEl.textContent = String(customNodesList.length);
    if (rtEl) rtEl.textContent = String(routinesList.length);
    if (badgeCu) badgeCu.textContent = String(customNodesList.length);
  }

  function computeNodeEvolutionStats() {
    const stats = {};
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
        if (c.memo && c.memo.trim()) stats[nid].memos.push(c.memo.trim());
      });
    });

    Object.keys(stats).forEach((nid) => {
      const st = stats[nid];
      st.rate = st.total > 0 ? Math.round((st.responders / st.total) * 100) : 0;
      if (st.total >= 5 && st.rate >= 70) st.signal = "promote";
      else if (st.total >= 5 && st.rate < 40) st.signal = "demote";
      else if (st.memos.length > 0) st.signal = "memo";
    });
    return stats;
  }

  /* ==================== 모드 & 서브탭 전환 ==================== */
  function switchMode(mode) {
    currentMode = mode;
    document.getElementById("btn-mode-clinic").classList.toggle("active", mode === "clinic");
    document.getElementById("btn-mode-setup").classList.toggle("active", mode === "setup");

    document.getElementById("mode-clinic-container").hidden = mode !== "clinic";
    document.getElementById("mode-setup-container").hidden = mode !== "setup";

    if (mode === "clinic") {
      renderClinicMode();
    } else {
      populateSymptomSelects();
      switchSetupSubview(currentSubview);
    }
  }

  function switchSetupSubview(subview) {
    currentSubview = subview;
    document.querySelectorAll(".setup-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-subview") === subview);
    });
    ["builder", "routines", "skills", "evolution"].forEach((sv) => {
      const el = document.getElementById(`subview-${sv}`);
      if (el) el.hidden = sv !== subview;
    });

    if (subview === "builder") {
      renderVisualTreeOutline();
    } else if (subview === "routines") {
      renderRoutineManager();
    } else if (subview === "skills") {
      renderSkillRegistry();
    } else if (subview === "evolution") {
      syncCaseFormWithCurrentPath();
      renderCasesAndEvolution();
    }
  }

  /* ==================== 최근 증상 ==================== */
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
    } catch (_) {}
  }

  /* ==================== MODE 1: 실제 진료 모드 렌더링 ==================== */
  function renderClinicMode() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;

    const symptoms = mergedTreeData["증상"];
    if (!symptoms[activeSymptomCode]) {
      activeSymptomCode = Object.keys(symptoms)[0] || "HA";
    }
    const sym = symptoms[activeSymptomCode];
    const nodesMap = sym ? sym.nodes || {} : {};
    if (!nodesMap[activeNodeId]) {
      activeNodeId = sym.entry || Object.keys(nodesMap)[0];
      currentPath = activeNodeId ? [activeNodeId] : [];
      pathDecisions = {};
    }

    renderSymptomQuickBar();
    renderRecentSymptomsBar();
    renderClinicRoutinesStrip();
    renderPathwayBar();
    renderNaturalBranchStream(nodesMap);
    renderFocusStageCard(nodesMap[activeNodeId], nodesMap);
    if (!fullTreeDrawer.hidden) {
      renderFullTreeMap(nodesMap);
    }
  }

  function renderSymptomQuickBar() {
    const symptoms = mergedTreeData["증상"];
    gridEl.innerHTML = "";
    let totalNodes = 0;

    Object.entries(symptoms).forEach(([code, symObj]) => {
      const count = Object.keys(symObj.nodes || {}).length;
      totalNodes += count;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `symptom-pill-btn ${code === activeSymptomCode ? "active" : ""}`;
      btn.setAttribute("role", "listitem");
      btn.innerHTML = `<span>${escapeHtml(symObj.name)}</span> <span style="font-size:0.76rem; opacity:0.8;">(${escapeHtml(
        code
      )}·${count})</span>`;
      btn.addEventListener("click", () => {
        selectSymptom(code);
      });
      gridEl.appendChild(btn);
    });

    if (statsEl) {
      statsEl.textContent = `증상 ${Object.keys(symptoms).length}개 · 노드 ${totalNodes}개`;
    }
  }

  function renderRecentSymptomsBar() {
    const recentCodes = loadRecentSymptoms().filter((c) => mergedTreeData["증상"][c]);
    if (recentCodes.length <= 1) {
      recentSection.hidden = true;
      return;
    }
    recentSection.hidden = false;
    recentList.innerHTML = "";
    recentCodes.forEach((code) => {
      const sym = mergedTreeData["증상"][code];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "recent-chip";
      b.textContent = sym.name;
      b.addEventListener("click", () => selectSymptom(code));
      recentList.appendChild(b);
    });
  }

  function selectSymptom(symCode, targetNodeId) {
    if (!mergedTreeData || !mergedTreeData["증상"][symCode]) return;
    pushRecentSymptom(symCode);
    activeSymptomCode = symCode;
    const sym = mergedTreeData["증상"][symCode];
    const entryId = sym.entry || Object.keys(sym.nodes)[0];
    pathDecisions = {};

    if (targetNodeId && sym.nodes[targetNodeId]) {
      activeNodeId = targetNodeId;
      currentPath = buildPathToNode(sym.nodes, entryId, targetNodeId);
    } else {
      activeNodeId = entryId;
      currentPath = [entryId];
    }
    renderClinicMode();
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

  function renderClinicRoutinesStrip() {
    const stripEl = document.getElementById("clinic-routine-pills");
    if (!stripEl) return;

    const matchingRoutines = routinesList.filter((r) => r.symptom === activeSymptomCode);
    stripEl.innerHTML = "";

    if (matchingRoutines.length === 0) {
      stripEl.innerHTML = `<span style="font-size:0.8rem; color:var(--text-muted);">이 증상에 등록된 루틴이 없습니다.</span>`;
    } else {
      matchingRoutines.forEach((rt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "routine-pill-btn";
        btn.textContent = `⚡ ${rt.name}`;
        btn.title = rt.orderMemo || "";
        btn.addEventListener("click", () => {
          applyRoutineToClinic(rt);
        });
        stripEl.appendChild(btn);
      });
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-sm btn-secondary";
    addBtn.textContent = "+ 새 루틴 짜기";
    addBtn.addEventListener("click", () => {
      switchMode("setup");
      switchSetupSubview("routines");
    });
    stripEl.appendChild(addBtn);
  }

  function applyRoutineToClinic(rt) {
    const sym = mergedTreeData["증상"][rt.symptom];
    if (!sym) return;
    activeSymptomCode = rt.symptom;
    const validPath = (rt.path || []).filter((nid) => sym.nodes[nid]);
    if (validPath.length > 0) {
      currentPath = validPath;
      activeNodeId = validPath[validPath.length - 1];
      pathDecisions = {};
      renderClinicMode();
      const memoEl = document.getElementById("qc-memo");
      if (memoEl && rt.orderMemo) memoEl.value = `[${rt.name}] ${rt.orderMemo}`;
      showToast(`⚡ '${rt.name}' 루틴 경로(${validPath.length}단계)가 한 번에 적용되었습니다!`);
    }
  }

  function renderPathwayBar() {
    const sym = mergedTreeData["증상"][activeSymptomCode];
    const nodesMap = sym ? sym.nodes || {} : {};
    pathwayChips.innerHTML = "";

    currentPath.forEach((nid, idx) => {
      const node = nodesMap[nid];
      if (!node) return;
      if (idx > 0) {
        const prevId = currentPath[idx - 1];
        const decision = pathDecisions[prevId];
        const arrow = document.createElement("span");
        arrow.className = "path-arrow";
        arrow.textContent = decision ? `—(${decision})→` : "→";
        pathwayChips.appendChild(arrow);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      const isRF = node["레드플래그"] === true;
      btn.className = `path-chip ${nid === activeNodeId ? "active" : ""} ${isRF ? "redflag" : ""}`;
      btn.textContent = `${ idx + 1 }. ${node["제목"]}`;
      btn.addEventListener("click", () => {
        activeNodeId = nid;
        currentPath = currentPath.slice(0, idx + 1);
        renderClinicMode();
      });
      pathwayChips.appendChild(btn);
    });
  }

  /* ==================== 핵심: 문진 다음에 연결되는 가지가 자연스럽게 나오는 스트림 ==================== */
  function extractBranchesList(node) {
    // 반환: [{ label: "예", targetId: "HA-L1-02" }, ...]
    if (!node || !node["다음"]) return [];
    const nxt = node["다음"];
    const out = [];
    if (Array.isArray(nxt)) {
      nxt.forEach((tid) => {
        if (tid) out.push({ label: "다음 단계", targetId: String(tid) });
      });
    } else if (typeof nxt === "object") {
      Object.entries(nxt).forEach(([label, arr]) => {
        const targets = Array.isArray(arr) ? arr : [arr];
        targets.forEach((tid) => {
          if (tid) out.push({ label, targetId: String(tid) });
        });
      });
    }
    return out;
  }

  function renderNaturalBranchStream(nodesMap) {
    branchFlowStream.innerHTML = "";
    const evoStats = computeNodeEvolutionStats();

    // 1. 지금까지 걸어온 단계들을 위에서 아래로 카드로 연결해 보여준다
    currentPath.forEach((nid, idx) => {
      const node = nodesMap[nid];
      if (!node) return;
      const isCurrent = nid === activeNodeId;
      const isRF = node["레드플래그"] === true;
      const ntype = node["유형"] || "ask";

      const wrap = document.createElement("div");
      wrap.className = "stream-step-wrap";

      if (idx > 0) {
        const prevId = currentPath[idx - 1];
        const decisionLabel = pathDecisions[prevId] || "선택";
        const conn = document.createElement("div");
        conn.className = "stream-connector";
        conn.textContent = `↓ [${decisionLabel}] 선택으로 연결됨`;
        wrap.appendChild(conn);
      }

      const card = document.createElement("div");
      card.className = `stream-step-card ${isCurrent ? "current" : "visited"} ${isRF ? "redflag-step" : ""}`;

      const mainSummary =
        node["질문"] ||
        node["술기세트"] ||
        node["검사명"] ||
        node["환자설명"] ||
        (Array.isArray(node["후보"]) ? node["후보"].join(", ") : "") ||
        node["측정지표"] ||
        "";

      card.innerHTML = `
        <div class="node-card-top">
          <span class="node-id-badge">Step ${idx + 1} · ${escapeHtml(node.id)}</span>
          <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
            TYPE_KOREAN[ntype] || ntype
          )}</span>
        </div>
        <div style="font-size:1rem; font-weight:800;">${escapeHtml(node["제목"])}</div>
        ${
          mainSummary
            ? `<div style="font-size:0.86rem; color:var(--text-muted);">${escapeHtml(mainSummary)}</div>`
            : ""
        }
      `;

      card.addEventListener("click", () => {
        activeNodeId = nid;
        currentPath = currentPath.slice(0, idx + 1);
        renderClinicMode();
      });

      wrap.appendChild(card);
      branchFlowStream.appendChild(wrap);
    });

    // 2. 현재 단계 바로 아래에 "다음으로 뻗어나가는 가지(Branches)"를 시각적으로 펼쳐 보여준다
    const activeNode = nodesMap[activeNodeId];
    const branches = extractBranchesList(activeNode);

    const nextBox = document.createElement("div");
    nextBox.className = "next-branches-container";

    if (branches.length === 0) {
      nextBox.innerHTML = `
        <div class="next-branches-title">🏁 최종 단계에 도달했습니다 (우측에서 치료 복사·환자 설명·3초 케이스 기록을 진행하세요)</div>
      `;
    } else {
      nextBox.innerHTML = `
        <div class="next-branches-title">
          🌿 이 단계에서 이어지는 다음 가지 (${branches.length}갈래 — 클릭하면 그 가지로 내려갑니다)
        </div>
        <div class="next-branches-grid" id="stream-next-cards"></div>
      `;
      const grid = nextBox.querySelector("#stream-next-cards");

      branches.forEach(({ label, targetId }) => {
        const targetNode = nodesMap[targetId];
        if (!targetNode) return;
        const isYes = label.includes("예") || label.includes("양성") || label.includes("수동제한");
        const isDanger = activeNode["레드플래그"] === true && isYes;
        const tType = targetNode["유형"] || "ask";
        const prof = typeof targetNode["내숙련도"] === "number" ? targetNode["내숙련도"] : null;
        const st = evoStats[targetId];

        const bCard = document.createElement("button");
        bCard.type = "button";
        bCard.className = `next-branch-card ${
          isDanger ? "branch-danger" : isYes ? "branch-yes" : "branch-no"
        }`;

        const subPreview =
          targetNode["질문"] ||
          targetNode["술기세트"] ||
          targetNode["검사명"] ||
          targetNode["환자설명"] ||
          (Array.isArray(targetNode["후보"]) ? targetNode["후보"].join(", ") : "") ||
          "";

        let extraBadges = "";
        if (tType === "treat" && prof !== null && prof <= 2) {
          extraBadges += `<span class="mini-badge badge-supervise">⚠️ 지도 필요 (Lv.${prof})</span>`;
        }
        if (st && st.signal === "promote") {
          extraBadges += `<span class="mini-badge badge-first-choice">🌟 1차 선택 (${st.rate}%)</span>`;
        }

        bCard.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:0.4rem;">
            <span class="branch-decision-pill">👉 [${escapeHtml(label)}] 선택 시</span>
            <span class="node-type-badge type-${escapeHtml(tType)}">${escapeHtml(
              TYPE_KOREAN[tType] || tType
            )}</span>
          </div>
          <div style="font-size:1.02rem; font-weight:800; color:var(--text); margin-top:0.2rem;">
            ${escapeHtml(targetNode["제목"])} <span style="font-size:0.75rem; color:var(--text-muted);">(${escapeHtml(
              targetId
            )})</span>
          </div>
          ${
            subPreview
              ? `<div style="font-size:0.83rem; color:var(--text-muted);">${escapeHtml(subPreview)}</div>`
              : ""
          }
          ${extraBadges ? `<div style="display:flex; gap:0.3rem; flex-wrap:wrap;">${extraBadges}</div>` : ""}
        `;

        bCard.addEventListener("click", () => {
          followBranch(activeNodeId, label, targetId);
        });
        grid.appendChild(bCard);
      });
    }

    branchFlowStream.appendChild(nextBox);
  }

  function followBranch(fromNodeId, decisionLabel, targetNodeId) {
    pathDecisions[fromNodeId] = decisionLabel;
    const existingIdx = currentPath.indexOf(targetNodeId);
    if (existingIdx !== -1) {
      currentPath = currentPath.slice(0, existingIdx + 1);
    } else {
      currentPath.push(targetNodeId);
    }
    activeNodeId = targetNodeId;
    renderClinicMode();
  }

  /* ==================== 우측: 현재 단계 집중 액션 카드 ==================== */
  function renderFocusStageCard(node, nodesMap) {
    if (!node) {
      nodeDetailContent.innerHTML = "<p>단계를 선택해 주세요.</p>";
      return;
    }

    const isRedflag = node["레드플래그"] === true;
    nodeDetailPanel.classList.toggle("redflag-panel", isRedflag);

    const ntype = node["유형"] || "ask";
    const prof = typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4;
    const branches = extractBranchesList(node);
    const evoStats = computeNodeEvolutionStats();
    const nodeStat = evoStats[node.id];

    let html = `
      <div>
        <div class="stage-top-bar">
          <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
              TYPE_KOREAN[ntype] || ntype
            )}</span>
            <span class="mini-badge" style="background:#f1f5f9;">상태: ${escapeHtml(
              node["상태"] || "정본"
            )}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            ${
              ntype === "treat" && prof <= 2
                ? `<span class="mini-badge ${prof === 0 ? "badge-forbid" : "badge-supervise"}">${
                    prof === 0 ? "⛔ Lv.0 시행 금지(위임/전원)" : `⚠️ 지도 필요 (내 숙련도 Lv.${prof})`
                  }</span>`
                : `<span class="mini-badge badge-first-choice">내 숙련도 Lv.${prof}</span>`
            }
          </div>
        </div>
        <h2 class="stage-big-title">${escapeHtml(node["제목"])}</h2>
        ${
          isRedflag
            ? `<div class="redflag-alert-box">
                🚨 [레드플래그 — 즉시 전원] 양성일 경우 원내 시술을 보류하고 즉시 응급실/상급병원으로 전원하십시오.<br>
                • 전원 기준: ${escapeHtml(node["전원기준"] || "양성 시 즉시 응급 전원")}
               </div>`
            : ""
        }
      </div>
    `;

    // 유형별 메인 히어로 블록
    if (ntype === "ask") {
      html += `
        <div class="hero-question-box">
          <div class="hero-question-text">Q. “${escapeHtml(node["질문"] || node["제목"])}”</div>
          <div class="hero-why-text"><strong>💡 왜 묻는가:</strong> ${escapeHtml(
            node["왜"] || "핵심 감별 분기"
          )}</div>
        </div>
      `;
    } else if (ntype === "test") {
      html += `
        <div class="hero-question-box" style="background:#faf5ff; border-left-color:#7c3aed;">
          <div class="hero-question-text" style="color:#4c1d95;">🔬 ${escapeHtml(
            node["검사명"] || node["제목"]
          )}</div>
          <div class="hero-why-text"><strong>🎯 무엇을 배제하는가:</strong> ${escapeHtml(
            node["배제대상"] || "-"
          )}</div>
          ${
            node["민감도"]
              ? `<div class="hero-why-text"><strong>📊 정확도:</strong> 민감도 ${escapeHtml(
                  node["민감도"]
                )} · 특이도 ${escapeHtml(node["특이도"] || "-")} · LR+ ${escapeHtml(
                  node["LR+"] || "-"
                )} (소요 ${escapeHtml(node["소요시간"] || "2분")})</div>`
              : ""
          }
        </div>
      `;
    } else if (ntype === "dx") {
      const candidates = Array.isArray(node["후보"]) ? node["후보"] : [node["제목"]];
      html += `
        <div class="hero-question-box" style="background:#fffbeb; border-left-color:#d97706;">
          <div style="font-size:0.85rem; font-weight:800; color:#b45309;">🩺 감별 진단 후보</div>
          <div class="hero-question-text" style="color:#78350f; font-size:1.15rem; margin-top:0.25rem;">
            ${candidates.map((c) => `• ${escapeHtml(c)}`).join("<br>")}
          </div>
          ${
            node["위험감별"]
              ? `<div class="hero-why-text" style="color:#dc2626; font-weight:700;">🚨 놓치면 위험한 감별: ${escapeHtml(
                  node["위험감별"]
                )}</div>`
              : ""
          }
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
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
            <strong style="color:#166534; font-size:1rem;">💊 치료 세트 오더 (차트 붙여넣기용)</strong>
            <button type="button" id="btn-copy-treat-set" class="btn btn-primary">
              📋 자침점·용량·빈도 원클릭 복사
            </button>
          </div>
          <pre id="treat-copy-text" class="treat-copy-pre">${escapeHtml(copyPayload)}</pre>
          ${
            node["환자설명"]
              ? `<button type="button" class="btn btn-lg btn-outline btn-open-patient-teach">
                   🖥️ 환자에게 보여주기 (24px+ 큰 글씨 설명 화면)
                 </button>`
              : ""
          }
        </div>
      `;
    } else if (ntype === "teach") {
      html += `
        <div class="treat-summary-box" style="background:#fdf2f8; border-color:#f472b6;">
          <strong style="color:#9d174d; font-size:1rem;">🗣️ 환자 설명 3문장 & 생활 수칙</strong>
          <p style="font-size:1.05rem; font-weight:700; color:#1e293b; line-height:1.55;">
            ${escapeHtml(node["환자설명"] || "")}
          </p>
          <button type="button" class="btn btn-lg btn-primary btn-open-patient-teach">
            🖥️ 환자에게 보여주기 (24px+ 큰 글씨 전체화면 열기)
          </button>
        </div>
      `;
    }

    // 큰 분기 선택 버튼 (클릭 시 다음 가지가 바로 연결됨)
    if (branches.length > 0) {
      let choicesHtml = "";
      branches.forEach(({ label, targetId }) => {
        const tNode = nodesMap[targetId];
        const tTitle = tNode ? tNode["제목"] : targetId;
        const isYes = label.includes("예") || label.includes("양성") || label.includes("수동제한");
        const btnCls = isRedflag && isYes ? "choice-danger" : isYes ? "choice-yes" : "choice-no";
        choicesHtml += `
          <button type="button" class="big-choice-btn ${btnCls} btn-stage-branch" data-label="${escapeHtml(
            label
          )}" data-target="${escapeHtml(targetId)}">
            <span class="choice-label">👉 [${escapeHtml(label)}]</span>
            <span class="choice-target">다음 가지: ${escapeHtml(tTitle)} (${escapeHtml(targetId)}) →</span>
          </button>
        `;
      });

      html += `
        <div>
          <div style="font-size:0.84rem; font-weight:800; color:var(--text-muted); margin-bottom:0.4rem;">
            ⚡ 답변/소견을 선택하면 다음 가지로 바로 이어집니다:
          </div>
          <div class="big-choice-grid">${choicesHtml}</div>
        </div>
      `;
    }

    // 보조 임상 정보 (깔끔한 요약)
    const extraItems = [
      ["확률 ↑ 소견", node["올리는소견"]],
      ["확률 ↓ 소견", node["내리는소견"]],
      ["생활 지도", node["생활지도"]],
      ["흔한 오해 / 주의", node["흔한오해"] || node["하지말아야할것"]],
      ["전원 기준", node["전원기준"]],
      ["근거 출처", node["근거"]],
    ].filter((x) => x[1]);

    if (extraItems.length > 0 || (nodeStat && nodeStat.total > 0)) {
      html += `<div class="detail-kv-list">`;
      if (nodeStat && nodeStat.total > 0) {
        html += `
          <div class="detail-kv-item" style="background:#f0fdf4; border-color:#86efac;">
            <span class="detail-kv-label">🧬 내 임상 누적 반응률:</span>
            <span><strong>${nodeStat.rate}%</strong> (${nodeStat.responders}/${nodeStat.total}건 호전)</span>
          </div>
        `;
      }
      extraItems.forEach(([k, v]) => {
        html += `
          <div class="detail-kv-item">
            <span class="detail-kv-label">${escapeHtml(k)}:</span>
            <span>${escapeHtml(v)}</span>
          </div>
        `;
      });
      html += `</div>`;
    }

    nodeDetailContent.innerHTML = html;

    // 이벤트 연결
    nodeDetailContent.querySelectorAll(".btn-stage-branch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const label = btn.getAttribute("data-label");
        const targetId = btn.getAttribute("data-target");
        followBranch(node.id, label, targetId);
      });
    });

    const copyBtn = document.getElementById("btn-copy-treat-set");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const pre = document.getElementById("treat-copy-text");
        if (pre) copyToClipboard(pre.textContent, `${node.id} 치료 세트`);
      });
    }

    nodeDetailContent.querySelectorAll(".btn-open-patient-teach").forEach((btn) => {
      btn.addEventListener("click", () => openPatientTeachModal(node));
    });
  }

  /* ==================== 접이식 L0~L5 전체 트리 지도 ==================== */
  function getLayerFromNodeId(nid) {
    const m = String(nid).match(/^[A-Z]{2,4}-(L[0-5]|S)-/);
    return m ? m[1] : "L1";
  }

  function renderFullTreeMap(nodesMap) {
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
      const col = document.createElement("div");
      col.className = "layer-column";
      col.innerHTML = `
        <div class="layer-header">
          <span>${escapeHtml(title)}</span>
          <span>${colNodes.length}</span>
        </div>
      `;
      colNodes.forEach((n) => {
        const card = document.createElement("div");
        card.className = `tree-node-card ${n.id === activeNodeId ? "selected" : ""} ${
          n["레드플래그"] ? "redflag-node" : ""
        }`;
        card.innerHTML = `
          <div class="node-card-top">
            <span class="node-id-badge">${escapeHtml(n.id)}</span>
            <span class="node-type-badge type-${escapeHtml(n["유형"])}">${escapeHtml(n["유형"])}</span>
          </div>
          <div style="font-size:0.84rem; font-weight:700;">${escapeHtml(n["제목"])}</div>
        `;
        card.addEventListener("click", () => {
          selectSymptom(activeSymptomCode, n.id);
        });
        col.appendChild(card);
      });
      treeColumnsEl.appendChild(col);
    });
  }

  /* ==================== 환자 교육 24px+ 모달 ==================== */
  function openPatientTeachModal(node) {
    teachModalTitle.textContent = node["제목"];
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

  /* ==================== MODE 2 - SUBVIEW 1: 시각적 가지치기 트리 빌더 ==================== */
  function populateSymptomSelects() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const entries = Object.entries(mergedTreeData["증상"]);
    const html = entries
      .map(
        ([code, obj]) =>
          `<option value="${escapeHtml(code)}" ${code === activeSymptomCode ? "selected" : ""}>${escapeHtml(
            obj.name
          )} (${escapeHtml(code)} · ${Object.keys(obj.nodes || {}).length}노드)</option>`
      )
      .join("");

    ["setup-symptom-select", "routine-sym-input", "case-symptom-input"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  function renderVisualTreeOutline() {
    const container = document.getElementById("visual-tree-outline");
    if (!container || !mergedTreeData || !mergedTreeData["증상"][activeSymptomCode]) return;

    const sym = mergedTreeData["증상"][activeSymptomCode];
    const nodesMap = sym.nodes || {};
    const sortedNodes = Object.values(nodesMap).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const editingId = document.getElementById("edit-node-id").value.trim();

    container.innerHTML = "";
    sortedNodes.forEach((node) => {
      const branches = extractBranchesList(node);
      const row = document.createElement("div");
      row.className = `outline-node-row ${node.id === editingId ? "active-edit" : ""}`;

      const branchSummary =
        branches.length > 0
          ? branches.map((b) => `<span class="mini-badge" style="background:#e0f2fe; color:#0369a1;">[${escapeHtml(b.label)}] → ${escapeHtml(b.targetId)}</span>`).join(" ")
          : `<span style="font-size:0.75rem; color:var(--text-muted);">끝 노드 (하위 가지 없음)</span>`;

      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
          <div>
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(
              TYPE_KOREAN[node["유형"]] || node["유형"]
            )}</span>
            <strong style="font-size:0.92rem; margin-left:0.3rem;">${escapeHtml(node["제목"])}</strong>
          </div>
          <button type="button" class="btn btn-sm btn-secondary btn-outline-edit" data-id="${escapeHtml(node.id)}">
            ✏️ 내용 수정
          </button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.3rem; align-items:center;">
          <span style="font-size:0.76rem; color:var(--text-muted); font-weight:700;">연결된 다음 가지:</span>
          ${branchSummary}
        </div>
        <div class="outline-branch-actions">
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="예">
            + [예/양성] 가지 추가
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="아니오">
            + [아니오/음성] 가지 추가
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="다음">
            + 다음 치료/티칭 가지 연결
          </button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll(".btn-outline-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nid = btn.getAttribute("data-id");
        if (nodesMap[nid]) {
          loadNodeIntoEditor(activeSymptomCode, nodesMap[nid], false, "");
          renderVisualTreeOutline();
        }
      });
    });

    container.querySelectorAll(".btn-quick-branch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nid = btn.getAttribute("data-id");
        const branchLabel = btn.getAttribute("data-branch");
        if (nodesMap[nid]) {
          loadNodeIntoEditor(activeSymptomCode, nodesMap[nid], true, branchLabel);
          renderVisualTreeOutline();
        }
      });
    });
  }

  function loadNodeIntoEditor(symCode, node, asChildBranch, branchLabel) {
    const sym = mergedTreeData["증상"][symCode];
    document.getElementById("edit-sym-code").value = symCode;
    document.getElementById("edit-sym-name").value = sym ? sym.name : symCode;
    const headingEl = document.getElementById("editor-form-heading");

    if (asChildBranch) {
      const curLayerMatch = String(node.id).match(/-L([0-5])-/);
      const nextLayerNum = curLayerMatch ? Math.min(5, Number(curLayerMatch[1]) + 1) : 1;
      const existingIds = Object.keys(sym ? sym.nodes : {});
      let seq = 1;
      let candidateId = "";
      do {
        candidateId = `${symCode}-L${nextLayerNum}-${String(seq).padStart(2, "0")}`;
        seq += 1;
      } while (existingIds.includes(candidateId));

      const defaultNextType =
        nextLayerNum <= 1 ? "ask" : nextLayerNum === 2 ? "test" : nextLayerNum === 3 ? "dx" : "treat";

      document.getElementById("edit-node-id").value = candidateId;
      document.getElementById("edit-node-parent").value = node.id;
      document.getElementById("edit-parent-branch").value = branchLabel || "예";
      document.getElementById("edit-node-type").value = defaultNextType;
      document.getElementById("edit-node-title").value = "";
      document.getElementById("edit-node-cond").value = `${node["제목"]} → [${branchLabel || "예"}]`;
      document.getElementById("edit-node-primary").value = "";
      document.getElementById("edit-node-secondary").value = "";
      document.getElementById("edit-node-next").value = "";
      if (headingEl) {
        headingEl.textContent = `🌿 [${node.id}]에서 '${branchLabel || "새"}' 가지로 뻗어나갈 새 단계(${candidateId}) 만들기`;
      }
      document.getElementById("edit-node-title").focus();
      showToast(`🌿 ${node.id}의 [${branchLabel}] 가지로 새 노드(${candidateId})가 준비되었습니다.`);
    } else {
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

      if (headingEl) {
        headingEl.textContent = `✏️ [${node.id}] ${node["제목"]} 수정 중`;
      }
    }
  }

  /* ==================== MODE 2 - SUBVIEW 2: 내 진료 루틴(세트) 메이커 ==================== */
  function renderRoutineManager() {
    const container = document.getElementById("routine-list-container");
    if (!container) return;

    if (routinesList.length === 0) {
      container.innerHTML = '<p class="empty-text">등록된 루틴이 없습니다. 좌측에서 자주 쓰는 진료 루틴을 만들어 보세요.</p>';
      return;
    }

    container.innerHTML = "";
    routinesList.forEach((rt) => {
      const card = document.createElement("div");
      card.className = "routine-card";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem;">
          <div>
            <span class="node-id-badge">${escapeHtml(rt.id)} · ${escapeHtml(rt.symptom)}</span>
            <strong style="font-size:1rem; margin-left:0.35rem;">⚡ ${escapeHtml(rt.name)}</strong>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-sm btn-primary btn-run-routine" data-id="${escapeHtml(rt.id)}">
              🩺 진료 모드로 바로 실행
            </button>
            <button type="button" class="btn btn-sm btn-danger-outline btn-del-routine" data-id="${escapeHtml(
              rt.id
            )}">
              삭제
            </button>
          </div>
        </div>
        <div style="font-size:0.8rem; color:#0369a1; font-weight:700;">
          가지 경로: ${escapeHtml((rt.path || []).join(" → "))}
        </div>
        ${
          rt.orderMemo
            ? `<div style="font-size:0.84rem; color:var(--text-muted); background:#ffffff; padding:0.5rem 0.7rem; border-radius:6px; border:1px solid var(--border-light);">
                 ${escapeHtml(rt.orderMemo)}
               </div>`
            : ""
        }
      `;
      container.appendChild(card);
    });

    container.querySelectorAll(".btn-run-routine").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const rt = routinesList.find((x) => x.id === id);
        if (rt) {
          switchMode("clinic");
          applyRoutineToClinic(rt);
        }
      });
    });

    container.querySelectorAll(".btn-del-routine").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        routinesList = routinesList.filter((x) => x.id !== id);
        await dbDelete("routines", id);
        updateBadges();
        renderRoutineManager();
        showToast("루틴이 삭제되었습니다.");
      });
    });
  }

  /* ==================== MODE 2 - SUBVIEW 3: 스킬 도감 ==================== */
  function renderSkillRegistry() {
    const container = document.getElementById("skill-list-grid");
    if (!container) return;

    if (skillsList.length === 0) {
      container.innerHTML = "<p>등록된 스킬이 없습니다.</p>";
      return;
    }

    container.innerHTML = "";
    skillsList.forEach((sk) => {
      const lv = Number(sk.level) || 0;
      const card = document.createElement("div");
      card.className = "skill-card";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
          <div>
            <span class="node-id-badge">${escapeHtml(sk.id)} · ${escapeHtml(sk.category)}</span>
            <h3 style="font-size:0.98rem; font-weight:800; margin-top:0.25rem;">${escapeHtml(sk.name)}</h3>
          </div>
          <span class="prof-chip prof-${lv}">Lv.${lv}</span>
        </div>
        <div style="font-size:0.84rem; color:var(--text-muted);">${escapeHtml(sk.notes || "")}</div>
        <div style="font-size:0.78rem; color:#0369a1; font-weight:700;">
          연결 노드: ${escapeHtml((sk.linkedNodes || []).join(", ") || "없음")}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; padding-top:0.4rem; border-top:1px solid var(--border-light);">
          <select class="select-input skill-lv-change" data-id="${escapeHtml(sk.id)}" style="font-size:0.8rem; padding:0.22rem 0.5rem;">
            <option value="0" ${lv === 0 ? "selected" : ""}>Lv.0 미경험(⛔)</option>
            <option value="1" ${lv === 1 ? "selected" : ""}>Lv.1 관찰(⚠️)</option>
            <option value="2" ${lv === 2 ? "selected" : ""}>Lv.2 부분시행(⚠️)</option>
            <option value="3" ${lv === 3 ? "selected" : ""}>Lv.3 지도하완수(🔶)</option>
            <option value="4" ${lv === 4 ? "selected" : ""}>Lv.4 단독시행(✅)</option>
            <option value="5" ${lv === 5 ? "selected" : ""}>Lv.5 교육가능(🌟)</option>
          </select>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <span style="font-size:0.8rem; font-weight:800;">시행 ${Number(sk.count || 0)}회</span>
            <button type="button" class="btn btn-sm btn-outline skill-inc-count" data-id="${escapeHtml(sk.id)}">
              +1회 기록
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
        showToast(`🎯 ${sk.name} 숙련도가 Lv.${sk.level}(으)로 업데이트되었습니다.`);
      });
    });

    container.querySelectorAll(".skill-inc-count").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const sk = skillsList.find((x) => x.id === id);
        if (!sk) return;
        sk.count = Number(sk.count || 0) + 1;
        await dbPut("skills", sk);
        renderSkillRegistry();
        showToast(`📈 ${sk.name} 누적 ${sk.count}회 시행!`);
      });
    });
  }

  /* ==================== MODE 2 - SUBVIEW 4: 케이스 진화 & AI 협업 ==================== */
  function syncCaseFormWithCurrentPath() {
    const symInput = document.getElementById("case-symptom-input");
    const pathInput = document.getElementById("case-path-input");
    if (symInput) symInput.value = activeSymptomCode;
    if (pathInput && currentPath.length > 0) pathInput.value = currentPath.join(", ");
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
        '<p style="font-size:0.86rem; color:var(--text-muted);">아직 기록된 케이스가 없습니다. 진료 모드 하단에서 3초 케이스를 저장하거나 [⚡ 샘플 케이스 6건 시뮬레이션]을 눌러보세요.</p>';
    } else {
      evoContainer.innerHTML = "";
      statEntries.forEach(([nid, st]) => {
        if (!nid.includes("-L4-") && !nid.includes("-L3-") && st.memos.length === 0) return;
        let badge = `<span class="mini-badge" style="background:#e2e8f0;">표본 수집 중 (n=${st.total})</span>`;
        let cls = "";
        if (st.signal === "promote") {
          badge = `<span class="mini-badge badge-first-choice">🌟 1차 선택 승격 (반응률 ${st.rate}% ≥ 70%, n=${st.total})</span>`;
          cls = "promote";
        } else if (st.signal === "demote") {
          badge = `<span class="mini-badge badge-revise-candidate">🔧 분기 개정 후보 (반응률 ${st.rate}% < 40%, n=${st.total})</span>`;
          cls = "demote";
        }
        const uniqueMemos = Array.from(new Set(st.memos)).slice(0, 2);
        const card = document.createElement("div");
        card.className = `evo-card ${cls}`;
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
            <strong>${escapeHtml(nid)}</strong>
            ${badge}
          </div>
          <div style="font-size:0.84rem;">누적 ${st.total}건 중 <strong>${st.responders}건 호전 (${st.rate}%)</strong></div>
          ${
            uniqueMemos.length > 0
              ? `<div style="font-size:0.8rem; color:#334155;">💡 메모: ${escapeHtml(uniqueMemos.join(" / "))}</div>`
              : ""
          }
        `;
        evoContainer.appendChild(card);
      });
    }

    historyContainer.innerHTML = "";
    casesList
      .slice()
      .reverse()
      .slice(0, 10)
      .forEach((c) => {
        const div = document.createElement("div");
        div.className = "case-item";
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${escapeHtml(c.caseId)} · ${escapeHtml(c.finalDx)} (NRS ${c.nrsBefore}→${c.nrsAfter})</strong>
            <button type="button" class="btn btn-sm btn-outline btn-copy-one-case" data-case-id="${escapeHtml(
              c.caseId
            )}">📋 md 복사</button>
          </div>
          <div style="font-size:0.78rem; color:var(--text-muted);">경로: ${escapeHtml((c.path || []).join(" → "))}</div>
        `;
        historyContainer.appendChild(div);
      });

    historyContainer.querySelectorAll(".btn-copy-one-case").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cid = btn.getAttribute("data-case-id");
        const target = casesList.find((x) => x.caseId === cid);
        if (target) copyToClipboard(formatCaseToMarkdown(target), `${cid} md`);
      });
    });
  }

  /* ==================== 편집기 노드 조립 & 볼트 md 포맷 ==================== */
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
          if (k.trim() && targets.length > 0) out[k.trim()] = targets;
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
      node["환자설명"] = `${title} 치료를 통해 긴장된 조직과 신경을 안정시킵니다. 꾸준히 치료받으시면 통증이 단계적으로 완화됩니다.`;
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

    if (typeof node["레드플래그"] === "boolean") lines.push(`레드플래그: ${node["레드플래그"]}`);
    lines.push(`근거: "${String(node["근거"] || "PMID 미확인").replace(/"/g, "'")}"`);
    lines.push(`신뢰도: ${node["신뢰도"] || "상"}`);
    lines.push(`상태: ${node["상태"] || "검토"}`);
    lines.push(`내숙련도: ${typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4}`);

    [
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
    ].forEach((k) => {
      if (node[k]) lines.push(`${k}: "${String(node[k]).replace(/"/g, "'")}"`);
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
        const summary = n["질문"] || n["검사명"] || n["술기세트"] || n["환자설명"] || n["제목"];
        return `${idx + 1}. [${n.id} · ${n["유형"]} · 숙련도 Lv.${n["내숙련도"] ?? "-"}] ${n["제목"]}\n   - 내용: ${summary}`;
      })
      .join("\n");

    return [
      `# [CLIN-7 진료 경로 AI 3줄 점검 요청]`,
      `- 증상: ${sym.name} (${activeSymptomCode})`,
      `- 걸어온 가지 경로: ${currentPath.join(" → ")}`,
      "",
      `## 걸어온 노드 컨텍스트`,
      pathDetails,
      "",
      `## AI 점검 요청 (각 1~2줄)`,
      `1. [아직 안 물어본 질문 / 추가 검사]: 현재 가지에서 놓치기 쉬운 추가 문진이나 이학적 검사`,
      `2. [감별 누락 / 레드플래그]: 반드시 배제해야 할 위험 감별진단`,
      `3. [금기 / 내 숙련도 주의]: 선택된 치료의 금기사항 또는 숙련도(Lv.0~2) 주의점`,
    ].join("\n");
  }

  function generateAiEvolutionBrief() {
    const stats = computeNodeEvolutionStats();
    const lines = [
      `# [CLIN-7 프로토콜 진화 & 새 가지 공동 설계 브리프]`,
      `- 대상 증상: ${activeSymptomCode}`,
      `- 누적 케이스: ${casesList.length}건`,
      "",
      `## 노드별 치료 반응률 & 임상 메모`,
    ];
    Object.entries(stats).forEach(([nid, st]) => {
      lines.push(`- ${nid}: 누적 ${st.total}건 중 ${st.responders}건 호전 (반응률 ${st.rate}%)`);
      if (st.memos.length > 0) {
        lines.push(`  - 임상 메모: ${Array.from(new Set(st.memos)).join(" | ")}`);
      }
    });
    lines.push(
      "",
      `## AI 공동 설계 요청`,
      `위 피드백을 반영해 \`00_스키마.md\` 규격(\`## ID 제목\` + \`yaml\` 블록)으로 추가할 새 문진/검사/치료 가지를 작성해 주십시오.`
    );
    return lines.join("\n");
  }

  /* ==================== 빠른 검색 ==================== */
  function handleQuickSearch(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q || !mergedTreeData) {
      nodeSearchSection.hidden = true;
      return;
    }

    const matched = [];
    Object.entries(mergedTreeData["증상"]).forEach(([code, sym]) => {
      Object.values(sym.nodes || {}).forEach((node) => {
        const hay = [
          code,
          sym.name,
          node.id,
          node["제목"],
          node["질문"],
          node["술기세트"],
          node["자침점용량"],
          node["검사명"],
          node["환자설명"],
        ]
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) {
          matched.push({ symCode: code, symName: sym.name, node });
        }
      });
    });

    nodeSearchSection.hidden = false;
    nodeSearchGrid.innerHTML = "";
    if (matched.length === 0) {
      nodeSearchGrid.innerHTML = "<p>일치하는 단계가 없습니다.</p>";
      return;
    }

    matched.slice(0, 9).forEach(({ symCode, symName, node }) => {
      const card = document.createElement("div");
      card.className = "tree-node-card";
      card.innerHTML = `
        <div class="node-card-top">
          <span class="node-id-badge">${escapeHtml(symName)} · ${escapeHtml(node.id)}</span>
          <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(
            TYPE_KOREAN[node["유형"]] || node["유형"]
          )}</span>
        </div>
        <div style="font-weight:800; font-size:0.9rem;">${escapeHtml(node["제목"])}</div>
      `;
      card.addEventListener("click", () => {
        nodeSearchSection.hidden = true;
        searchInput.value = "";
        selectSymptom(symCode, node.id);
      });
      nodeSearchGrid.appendChild(card);
    });
  }

  /* ==================== 이벤트 바인딩 ==================== */
  function bindEvents() {
    // 상단 2대 모드 스위치
    document.getElementById("btn-mode-clinic").addEventListener("click", () => switchMode("clinic"));
    document.getElementById("btn-mode-setup").addEventListener("click", () => switchMode("setup"));

    // 세팅 모드 내부 서브탭
    document.querySelectorAll(".setup-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchSetupSubview(btn.getAttribute("data-subview"));
      });
    });

    // 빠른 검색
    searchInput.addEventListener("input", (e) => handleQuickSearch(e.target.value));
    document.getElementById("btn-close-search").addEventListener("click", () => {
      nodeSearchSection.hidden = true;
      searchInput.value = "";
    });

    // 경로 조작 버튼
    document.getElementById("btn-path-undo").addEventListener("click", () => {
      if (currentPath.length > 1) {
        currentPath.pop();
        activeNodeId = currentPath[currentPath.length - 1];
        renderClinicMode();
      }
    });

    document.getElementById("btn-path-reset").addEventListener("click", () => {
      selectSymptom(activeSymptomCode);
    });

    document.getElementById("btn-toggle-fullmap").addEventListener("click", () => {
      fullTreeDrawer.hidden = !fullTreeDrawer.hidden;
      if (!fullTreeDrawer.hidden) {
        const sym = mergedTreeData["증상"][activeSymptomCode];
        if (sym) renderFullTreeMap(sym.nodes || {});
      }
    });

    document.getElementById("btn-close-fullmap").addEventListener("click", () => {
      fullTreeDrawer.hidden = true;
    });

    // 진료 모드 → 세팅 모드(현재 노드에서 가지 추가/수정) 바로가기
    document.getElementById("btn-clinic-to-setup").addEventListener("click", () => {
      const sym = mergedTreeData["증상"][activeSymptomCode];
      const curNode = sym && sym.nodes ? sym.nodes[activeNodeId] : null;
      switchMode("setup");
      switchSetupSubview("builder");
      if (curNode) {
        loadNodeIntoEditor(activeSymptomCode, curNode, true, "예");
        renderVisualTreeOutline();
      }
    });

    // 진료 모드 하단: 3초 케이스 저장 & AI 3줄 점검
    document.getElementById("btn-clinic-ai-prompt").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "현재 진료 경로 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-qc-save").addEventListener("click", async () => {
      const nrsBefore = Number(document.getElementById("qc-nrs-before").value);
      const nrsAfter = Number(document.getElementById("qc-nrs-after").value);
      const memo = document.getElementById("qc-memo").value.trim();

      if (PHONE_REGEX.test(memo) || RRN_REGEX.test(memo)) {
        showToast("⛔ 전화번호·주민번호 등 환자 식별정보는 입력할 수 없습니다.");
        return;
      }

      const sym = mergedTreeData["증상"][activeSymptomCode];
      const nodesMap = sym ? sym.nodes || {} : {};
      const dxNodeId = currentPath.find((id) => nodesMap[id] && nodesMap[id]["유형"] === "dx");
      const autoDx = dxNodeId
        ? nodesMap[dxNodeId]["제목"].replace(" 감별", "")
        : sym
        ? sym.name
        : activeSymptomCode;

      const caseId = `C-${String(casesList.length + 1).padStart(4, "0")}`;
      const caseObj = {
        caseId,
        date: new Date().toISOString().slice(0, 10),
        symptom: activeSymptomCode,
        path: currentPath.slice(),
        nrsBefore,
        nrsAfter,
        timepoint: "1주",
        finalDx: autoDx,
        memo,
      };

      casesList.push(caseObj);
      await dbPut("cases", caseObj);
      updateBadges();
      document.getElementById("qc-memo").value = "";
      renderClinicMode();
      await copyToClipboard(formatCaseToMarkdown(caseObj), `${caseId} 케이스 저장 & md 복사`);
    });

    // 환자 티칭 모달 닫기
    document.getElementById("btn-close-teach-modal").addEventListener("click", () => {
      teachModal.hidden = true;
    });

    // 세팅 모드 증상 선택 변경
    document.getElementById("setup-symptom-select").addEventListener("change", (e) => {
      activeSymptomCode = e.target.value;
      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry && sym.nodes[sym.entry]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[sym.entry], false, "");
      }
      renderVisualTreeOutline();
    });

    // 가지치기 노드 편집기 저장
    document.getElementById("node-editor-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const item = buildNodeObjectFromEditor();
      if (!/^[A-Z]{2,4}-(L[0-5]|S)-\d{2,3}$/.test(item.node.id)) {
        showToast("⛔ 노드 ID 형식을 확인해 주세요 (예: HA-L1-03)");
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
      populateSymptomSelects();
      renderVisualTreeOutline();
      await copyToClipboard(formatNodeToVaultMarkdown(item.node), `${item.node.id} 저장 & md 복사`);
    });

    document.getElementById("btn-reset-editor").addEventListener("click", () => {
      document.getElementById("node-editor-form").reset();
      document.getElementById("edit-sym-code").value = activeSymptomCode;
      const sym = mergedTreeData["증상"][activeSymptomCode];
      document.getElementById("edit-sym-name").value = sym ? sym.name : activeSymptomCode;
      document.getElementById("editor-form-heading").textContent = "🌿 새 노드 / 새 증상 만들기";
    });

    document.getElementById("btn-copy-single-node-md").addEventListener("click", () => {
      const item = buildNodeObjectFromEditor();
      copyToClipboard(formatNodeToVaultMarkdown(item.node), `${item.node.id} md`);
    });

    document.getElementById("btn-export-custom-nodes-md").addEventListener("click", () => {
      if (customNodesList.length === 0) {
        showToast("수정한 커스텀 노드가 없습니다.");
        return;
      }
      const md = customNodesList.map((item) => formatNodeToVaultMarkdown(item.node)).join("\n\n");
      copyToClipboard(md, `커스텀 노드 ${customNodesList.length}개 md`);
    });

    document.getElementById("btn-clear-custom-nodes").addEventListener("click", async () => {
      customNodesList = [];
      await dbClear("custom_nodes");
      rebuildMergedTree();
      renderVisualTreeOutline();
      showToast("커스텀 노드 수정 내역이 초기화되었습니다.");
    });

    // 루틴 추가 폼
    document.getElementById("btn-fill-routine-from-path").addEventListener("click", () => {
      document.getElementById("routine-sym-input").value = activeSymptomCode;
      document.getElementById("routine-path-input").value = currentPath.join(", ");
      showToast("현재 진료 경로를 루틴에 채웠습니다.");
    });

    document.getElementById("routine-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const symptom = document.getElementById("routine-sym-input").value;
      const name = document.getElementById("routine-name-input").value.trim();
      const pathRaw = document.getElementById("routine-path-input").value;
      const orderMemo = document.getElementById("routine-order-input").value.trim();

      const path = pathRaw
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);

      const id = `RT-${String(routinesList.length + 1).padStart(2, "0")}`;
      const rtObj = { id, symptom, name, path, orderMemo };
      routinesList.push(rtObj);
      await dbPut("routines", rtObj);
      updateBadges();
      renderRoutineManager();
      e.target.reset();
      showToast(`⚡ 새 진료 루틴 '${name}'이(가) 저장되었습니다!`);
    });

    document.getElementById("btn-export-routines-md").addEventListener("click", () => {
      const lines = ["# 내 진료 루틴 프리셋 모음", ""];
      routinesList.forEach((r) => {
        lines.push(`## ${r.id} [${r.symptom}] ${r.name}`);
        lines.push(`- **가지 경로**: \`${(r.path || []).join(" → ")}\``);
        lines.push(`- **오더 메모**: ${r.orderMemo || "-"}`);
        lines.push("");
      });
      copyToClipboard(lines.join("\n"), "내 진료 루틴 전체 md");
    });

    // 스킬 추가 폼
    document.getElementById("skill-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("skill-id-input").value.trim().toUpperCase();
      const category = document.getElementById("skill-category-input").value;
      const name = document.getElementById("skill-name-input").value.trim();
      const level = Number(document.getElementById("skill-level-input").value);
      const linkedNodes = document
        .getElementById("skill-linked-nodes")
        .value.split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
      const notes = document.getElementById("skill-notes-input").value.trim();

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
      if (existing) Object.assign(existing, skillObj);
      else skillsList.push(skillObj);

      await dbPut("skills", skillObj);
      rebuildMergedTree();
      renderSkillRegistry();
      e.target.reset();
      showToast(`🎯 스킬 '${name}'이(가) 저장되었습니다.`);
    });

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

    // 상세 케이스 폼
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

      if (PHONE_REGEX.test(`${pathRaw} ${finalDx} ${memo}`) || RRN_REGEX.test(`${pathRaw} ${finalDx} ${memo}`)) {
        warnEl.textContent = "⛔ 전화번호·주민번호 패턴이 검출되어 저장할 수 없습니다.";
        warnEl.hidden = false;
        return;
      }

      const caseId = `C-${String(casesList.length + 1).padStart(4, "0")}`;
      const caseObj = {
        caseId,
        date: new Date().toISOString().slice(0, 10),
        symptom,
        path: pathRaw
          .split(",")
          .map((x) => x.trim().toUpperCase())
          .filter(Boolean),
        nrsBefore,
        nrsAfter,
        timepoint,
        finalDx,
        memo,
      };
      casesList.push(caseObj);
      await dbPut("cases", caseObj);
      updateBadges();
      renderCasesAndEvolution();
      copyToClipboard(formatCaseToMarkdown(caseObj), `${caseId} 케이스 md`);
    });

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
          memo: "턱관절 이갈이 동반 환자로 L1에 TMJ 질문 가지 추가 제안",
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
          memo: "야간통 절반 감소, 외회전 가동범위 15도 증가",
        },
      ];

      for (const dc of demoCases) {
        const cid = `C-${String(casesList.length + 1).padStart(4, "0")}`;
        const obj = Object.assign({ caseId: cid, date: new Date().toISOString().slice(0, 10) }, dc);
        casesList.push(obj);
        await dbPut("cases", obj);
      }

      updateBadges();
      renderCasesAndEvolution();
      showToast("⚡ 샘플 케이스 6건이 추가되어 1차 선택 승격 신호가 활성화되었습니다!");
    });

    document.getElementById("btn-gen-ai-consult").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "현재 진료 경로 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-gen-ai-evolution").addEventListener("click", () => {
      copyToClipboard(generateAiEvolutionBrief(), "프로토콜 진화·개정 AI 프롬프트");
    });
  }

  /* ==================== 초기화 ==================== */
  async function init() {
    bindEvents();

    const [savedSkills, savedCases, savedCustomNodes, savedRoutines] = await Promise.all([
      dbGetAll("skills"),
      dbGetAll("cases"),
      dbGetAll("custom_nodes"),
      dbGetAll("routines"),
    ]);

    if (savedSkills.length === 0) {
      skillsList = DEFAULT_SKILLS.slice();
      for (const sk of skillsList) await dbPut("skills", sk);
    } else {
      skillsList = savedSkills;
    }

    if (savedRoutines.length === 0) {
      routinesList = DEFAULT_ROUTINES.slice();
      for (const rt of routinesList) await dbPut("routines", rt);
    } else {
      routinesList = savedRoutines;
    }

    casesList = savedCases;
    customNodesList = savedCustomNodes;

    try {
      const res = await fetch("/tree.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      baseTreeData = await res.json();
      rebuildMergedTree();

      generatedEl.textContent = baseTreeData.generated
        ? `프로토콜 준비 완료 (${baseTreeData.generated.slice(0, 10)})`
        : "프로토콜 로드 완료";

      populateSymptomSelects();
      renderClinicMode();

      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry && sym.nodes[sym.entry]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[sym.entry], false, "");
      }
    } catch (err) {
      generatedEl.textContent = "로드 실패";
      gridEl.innerHTML = `<p style="color:red;">tree.json 로드 실패: ${escapeHtml(err.message || String(err))}</p>`;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  init();
})();
