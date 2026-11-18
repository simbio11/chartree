/**
 * web/app.js — CLIN-7 진료 프로토콜 나무 (Tactical Card-Deck Edition)
 *
 * 핵심 UX:
 * 1. [🩺 실제 진료 보드]:
 *    - 가로 L0~L5 6열 카드 테이블 위에 모든 선택지 카드를 한눈에 배치
 *    - 내가 선택한 카드 경로(Active Path)는 선명한 블루 글로우 + 굵은 SVG 베지어 곡선으로 연결
 *    - 현재 카드에서 다음에 고를 수 있는 후보 가지(Playable Next)는 초록색 펄스 테두리 + 점선 SVG 애니메이션과
 *      `👉 [예] 선택 시` / `👉 [아니오] 선택 시` 리본 태그로 즉시 식별
 *    - 선택하지 않고 지나친 갈래의 카드들은 자리에 그대로 보이되 자연스럽게 흐릿하게(Dimmed, opacity 0.34 + grayscale) 처리
 *      (언제든 흐릿한 카드를 클릭하면 그 갈래로 즉시 경로 전환!)
 *    - 상단 바는 단 1줄로 정리하고, [⚡ 내 루틴 덱]은 상단 우측 서랍 버튼으로 깔끔하게 수납
 *
 * 2. [🛠️ 세팅 · 공부 모드 (카드·루틴·스킬 제작소)]:
 *    - 🃏 1. 프로토콜 카드 제작소: 문진/검사/감별/치료/티칭 카드를 만들고 부모 카드의 [예/아니오] 가지에 연결
 *    - 🎴 2. 루틴 덱 빌더: 보유 카드 풀에서 카드를 카드게임처럼 클릭해 슬롯에 꽂아 나만의 진료 루틴 덱 조합
 *    - 🎯 3. 내 스킬 도감 · 숙련도(Lv.0~5): 침·약침·추나·검사 스킬 레벨과 시행 횟수 기록 (Lv.0~2 치료 카드는 자동 경고)
 *    - 🧬 4. 진화 통계 · AI 협업 연구소: 케이스 승률(반응률) 기반 1차 주력 카드 승격 및 AI 프롬프트·볼트 md 내보내기
 */

(function () {
  "use strict";

  const RECENT_STORAGE_KEY = "clin7_recent_symptoms_v1";
  const DB_NAME = "clin7_protocol_evolution_db";
  const DB_VERSION = 2;

  const PHONE_REGEX = /\b01[016789]-\d{3,4}-\d{4}\b/;
  const RRN_REGEX = /\b\d{6}-[1-4]\d{6}\b/;

  const LAYER_META = [
    { key: "L0", title: "L0 · 진입 카드" },
    { key: "L1", title: "L1 · 문진 카드 (Ask)" },
    { key: "L2", title: "L2 · 검사 카드 (Test)" },
    { key: "L3", title: "L3 · 감별 카드 (Dx)" },
    { key: "L4", title: "L4 · 치료·티칭 카드" },
    { key: "L5", title: "L5 · 결과·전원 카드" },
  ];

  const TYPE_KOREAN = {
    ask: "❓ 문진",
    test: "🔬 검사",
    dx: "🩺 감별",
    treat: "💊 치료",
    teach: "🗣️ 티칭",
    outcome: "📊 결과",
    skill: "🎯 스킬",
  };

  const DEFAULT_SKILLS = [
    {
      id: "SK-001",
      category: "침·전침",
      name: "두경부·편두통 표적 자침 (풍지·태양-솔곡 수평자침·득기 30분)",
      level: 4,
      count: 42,
      linkedNodes: ["HA-L4-01", "HA-L4-04", "DZ-L4-02"],
      notes: "0.25×30mm 득기 유도 후 20~30분 유침. 풍지는 반대측 안구 방향으로 0.8~1.2촌 사자.",
      updated: "2026-11-18",
    },
    {
      id: "SK-002",
      category: "약침·봉침",
      name: "상부 경추(풍지·천주·후두하근) 심부 약침술 (신바로/오공/자하거)",
      level: 2,
      count: 6,
      linkedNodes: ["HA-L4-02", "DZ-L4-05"],
      notes: "추골동맥 주행 주의. 30G×25mm로 후두골 하연 확인 후 반드시 혈액 역류(Regurgitation) 체크 뒤 0.2~0.3cc 주입.",
      updated: "2026-11-18",
    },
    {
      id: "SK-003",
      category: "추나·수기",
      name: "상부 경추 굴곡-회전 검사(CFRT) 및 C0-C1/C1-C2 가동 추나",
      level: 4,
      count: 28,
      linkedNodes: ["HA-L2-01", "HA-L4-03"],
      notes: "턱을 쇄골에 닿게 최대 굴곡 후 C1-C2 회전 비교(<32° 양성). 추골동맥 보호를 위해 상경추 HVLA 회전 thrust 금기.",
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
      name: "HINTS+ (두부충동·안진·사위편향 + 청력) & Dix-Hallpike / Epley 정복술",
      level: 4,
      count: 19,
      linkedNodes: ["DZ-L2-01", "DZ-L2-02", "DZ-L4-01"],
      notes: "HINTS+는 자발안진 있는 s-AVS에서만 사용. Epley는 각 단계 30~60초씩 충분히 정지해 이석을 굴려내려야 성공함.",
      updated: "2026-11-18",
    },
    {
      id: "SK-006",
      category: "추나·수기",
      name: "시선방향인지(GDR) & HRV 바이오피드백 비약물 재활 훈련",
      level: 3,
      count: 9,
      linkedNodes: ["HA-L4-06"],
      notes: "약물과용(MOH)·만성 두통 환자에서 들숨4초-날숨6초(분당6회) 호흡 및 전방 75cm GDR 30시행 안내.",
      updated: "2026-11-18",
    },
  ];

  const DEFAULT_ROUTINES = [
    {
      id: "RT-01",
      symptom: "HA",
      name: "경추성 두통 (눈 뒤 방산) 2Hz 전침+청상견통탕+목보호 덱",
      path: ["HA-L0-01", "HA-L1-01", "HA-L1-03", "HA-L2-01", "HA-L3-01", "HA-L4-03", "HA-L4-09"],
      orderMemo: "1) SNNOOP10 배제 → 2) CFRT(<32°) 및 C2 외측 1.5cm 눈뒤 방산 확인 → 3) 풍지-천주 2Hz 전침 20분 + 청상견통탕/갈근탕 → 4) 베개 6~8cm & 온찜질 티칭",
    },
    {
      id: "RT-02",
      symptom: "HA",
      name: "긴장형 두통 (CPG A등급) 득기 30분 침+자세교정 덱",
      path: ["HA-L0-01", "HA-L1-01", "HA-L1-05", "HA-L2-02", "HA-L3-02", "HA-L4-01", "HA-L4-08"],
      orderMemo: "1) 두개주위 근막 압통 확인 → 2) 풍지·태양·백회·합곡·태충 득기 후 30분 유침(10분 간격 재자극) + 소요산가감 → 3) Chin-Tuck 10초×15회 & 테니스공 이완 티칭",
    },
    {
      id: "RT-03",
      symptom: "HA",
      name: "편두통 (무조짐·월경편두통) CGRP 표적침+변증한약+SEEDS 덱",
      path: ["HA-L0-01", "HA-L1-01", "HA-L1-04", "HA-L2-03", "HA-L3-03", "HA-L4-04", "HA-L4-05", "HA-L4-07"],
      orderMemo: "1) HIT-6 & 두피 이질통 확인 → 2) 태양-솔곡 수평자침 + 족임읍·외관 → 3) 천마구등음/천궁차조산/가미소요산 → 4) SEEDS & 두통일기(8~12주 예방) 티칭",
    },
    {
      id: "RT-04",
      symptom: "DZ",
      name: "이석증 (BPPV) Epley 정복술 + 잔여어지럼 침/반하백출천마탕 + 비타민D 덱",
      path: ["DZ-L0-01", "DZ-L1-01", "DZ-L1-02", "DZ-L2-01", "DZ-L3-01", "DZ-L4-01", "DZ-L4-03", "DZ-L4-07"],
      orderMemo: "1) 양측 Dix-Hallpike 확인 → 2) Epley(단계별 60초 정지) → 3) 잔여 멍함에 반하백출천마탕 3~5일분 → 4) 과도한 목고정 금지·전정억제제 중단·비타민D 티칭",
    },
    {
      id: "RT-05",
      symptom: "DZ",
      name: "전정신경염 (s-AVS) HINTS+ 감별 → 와위 침구+전정재활운동 덱",
      path: ["DZ-L0-01", "DZ-L1-01", "DZ-L1-03", "DZ-L2-02", "DZ-L3-02", "DZ-L4-02", "DZ-L4-08"],
      orderMemo: "1) HINTS+ 말초성 & 청력정상 확인 → 2) 와위 예풍·풍지·내관·족삼리 자침 → 3) 누워만 있지 말고 시선고정 고개회전 전정재활운동 티칭",
    },
    {
      id: "RT-06",
      symptom: "SH",
      name: "오십견(유착성 관절낭염) 야간통 완화 침·서근탕 덱",
      path: ["SH-L0-01", "SH-L1-01", "SH-L1-02", "SH-L2-01", "SH-L3-01", "SH-L4-01", "SH-L4-03"],
      orderMemo: "1) 수동 외회전(PROM) 제한 확인 → 2) 견우·견료·천종·곡지 전침 15분 + 서근탕 → 3) 수면 시 아픈 어깨 아래 낮은 베개 받치기 티칭",
    },
  ];

  // 상태 변수
  let baseTreeData = null;
  let mergedTreeData = null;
  let customNodesList = [];
  let skillsList = [];
  let routinesList = [];
  let casesList = [];

  let currentMode = "clinic";
  let currentSubview = "builder";
  let activeSymptomCode = "HA";
  let activeNodeId = "HA-L0-01";
  let currentPath = ["HA-L0-01"];
  let pathDecisions = {}; // { fromNodeId: "예" }

  // 루틴 덱 빌더에서 현재 슬롯에 담아둔 카드 ID 배열
  let builderDeckSlots = [];

  // DOM 참조
  const gridEl = document.getElementById("symptom-grid");
  const searchInput = document.getElementById("symptom-search");
  const generatedEl = document.getElementById("generated-time");
  const statsEl = document.getElementById("summary-stats");
  const nodeSearchSection = document.getElementById("node-search-results-section");
  const nodeSearchGrid = document.getElementById("node-search-results");
  const routineDrawer = document.getElementById("routine-deck-drawer");

  const pathwayChips = document.getElementById("pathway-chips");
  const treeColumnsEl = document.getElementById("tree-columns");
  const branchSvgLayer = document.getElementById("branch-svg-layer");
  const boardCanvas = document.getElementById("board-canvas");
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
    }, 3000);
  }

  async function copyToClipboard(text, label) {
    const previewEl = document.getElementById("export-preview-textarea");
    if (previewEl) previewEl.value = text;
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

  /* ==================== IndexedDB ==================== */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("cases")) db.createObjectStore("cases", { keyPath: "caseId" });
        if (!db.objectStoreNames.contains("skills")) db.createObjectStore("skills", { keyPath: "id" });
        if (!db.objectStoreNames.contains("custom_nodes")) db.createObjectStore("custom_nodes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("routines")) db.createObjectStore("routines", { keyPath: "id" });
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

  /* ==================== 데이터 병합 ==================== */
  function rebuildMergedTree() {
    if (!baseTreeData) return;
    mergedTreeData = JSON.parse(JSON.stringify(baseTreeData));
    if (!mergedTreeData["증상"]) mergedTreeData["증상"] = {};

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
          parent["다음"] = item.parentBranch ? { [branchLabel]: [nodeObj.id] } : [nodeObj.id];
        } else if (Array.isArray(parent["다음"])) {
          if (item.parentBranch) {
            parent["다음"] = { 기본: parent["다음"].slice(), [branchLabel]: [nodeObj.id] };
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
    const hRtEl = document.getElementById("header-routine-count");
    const badgeCu = document.getElementById("custom-node-badge-count");

    if (skEl) skEl.textContent = String(skillsList.length);
    if (csEl) csEl.textContent = String(casesList.length);
    if (cuEl) cuEl.textContent = String(customNodesList.length);
    if (rtEl) rtEl.textContent = String(routinesList.length);
    if (hRtEl) hRtEl.textContent = String(routinesList.length);
    if (badgeCu) badgeCu.textContent = String(customNodesList.length);
  }

  function computeNodeEvolutionStats() {
    const stats = {};
    casesList.forEach((c) => {
      const before = Number(c.nrsBefore);
      const after = Number(c.nrsAfter);
      const isResponder = before > 0 ? (before - after) / before >= 0.5 || before - after >= 3 : after === 0;

      (c.path || []).forEach((nid) => {
        if (!stats[nid]) stats[nid] = { total: 0, responders: 0, rate: 0, memos: [], signal: null };
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

  function extractBranchesList(node) {
    if (!node || !node["다음"]) return [];
    const nxt = node["다음"];
    const out = [];
    if (Array.isArray(nxt)) {
      nxt.forEach((tid) => {
        if (tid) out.push({ label: "다음", targetId: String(tid) });
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

  /* ==================== 모드 & 서브탭 전환 ==================== */
  function switchMode(mode) {
    currentMode = mode;
    document.getElementById("btn-mode-clinic").classList.toggle("active", mode === "clinic");
    document.getElementById("btn-mode-setup").classList.toggle("active", mode === "setup");

    document.getElementById("mode-clinic-container").hidden = mode !== "clinic";
    document.getElementById("mode-setup-container").hidden = mode !== "setup";

    if (mode === "clinic") {
      renderClinicBoardMode();
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
      renderRoutineDeckBuilder();
      renderRoutineManager();
    } else if (subview === "skills") {
      renderSkillRegistry();
    } else if (subview === "evolution") {
      syncCaseFormWithCurrentPath();
      renderCasesAndEvolution();
    }
  }

  /* ==================== 상단 증상 덱 탭 & 루틴 덱 서랍 ==================== */
  function renderHeaderSymptomTabs() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const symptoms = mergedTreeData["증상"];
    gridEl.innerHTML = "";
    let totalNodes = 0;

    Object.entries(symptoms).forEach(([code, symObj]) => {
      const count = Object.keys(symObj.nodes || {}).length;
      totalNodes += count;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `symptom-deck-btn ${code === activeSymptomCode ? "active" : ""}`;
      btn.setAttribute("role", "listitem");
      btn.innerHTML = `<span>${escapeHtml(symObj.name)}</span> <span style="opacity:0.75; font-size:0.74rem;">${escapeHtml(
        code
      )}</span>`;
      btn.addEventListener("click", () => {
        selectSymptom(code);
        if (currentMode === "setup") {
          populateSymptomSelects();
          switchSetupSubview(currentSubview);
        }
      });
      gridEl.appendChild(btn);
    });

    if (statsEl) statsEl.textContent = `증상 ${Object.keys(symptoms).length} · 카드 ${totalNodes}`;
  }

  function renderRoutineDrawerCards() {
    const container = document.getElementById("clinic-routine-pills");
    if (!container) return;

    container.innerHTML = "";
    if (routinesList.length === 0) {
      container.innerHTML = "<p style='color:#94a3b8; font-size:0.84rem;'>저장된 루틴 덱이 없습니다.</p>";
      return;
    }

    routinesList.forEach((rt) => {
      const symName =
        mergedTreeData && mergedTreeData["증상"][rt.symptom]
          ? mergedTreeData["증상"][rt.symptom].name
          : rt.symptom;
      const div = document.createElement("div");
      div.className = "routine-deck-item";
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.74rem; color:#a5b4fc; font-weight:800;">${escapeHtml(rt.id)} · ${escapeHtml(
            symName
          )}</span>
          <span style="font-size:0.74rem; background:#4f46e5; padding:0.1rem 0.45rem; border-radius:999px;">카드 ${
            (rt.path || []).length
          }장</span>
        </div>
        <strong style="font-size:0.95rem;">⚡ ${escapeHtml(rt.name)}</strong>
        <div style="font-size:0.76rem; color:#cbd5e1;">${escapeHtml((rt.path || []).join(" → "))}</div>
        ${
          rt.orderMemo
            ? `<div style="font-size:0.75rem; color:#94a3b8; margin-top:0.15rem;">${escapeHtml(rt.orderMemo)}</div>`
            : ""
        }
      `;
      div.addEventListener("click", () => {
        routineDrawer.hidden = true;
        if (currentMode !== "clinic") switchMode("clinic");
        applyRoutineToClinic(rt);
      });
      container.appendChild(div);
    });
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
      renderClinicBoardMode();
      const memoEl = document.getElementById("qc-memo");
      if (memoEl && rt.orderMemo) memoEl.value = `[${rt.name}] ${rt.orderMemo}`;
      showToast(`🎴 '${rt.name}' 카드 콤보(${validPath.length}장)가 보드에 펼쳐졌습니다!`);
    }
  }

  /* ==================== MODE 1: 가로 카드 보드 + 흐릿한 비선택지 + SVG 연결선 ==================== */
  function selectSymptom(symCode, targetNodeId) {
    if (!mergedTreeData || !mergedTreeData["증상"][symCode]) return;
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
    renderClinicBoardMode();
  }

  function buildPathToNode(nodesMap, entryId, targetId) {
    // 부모 링크 또는 그래프 BFS 역추적으로 진입점부터 targetId까지의 경로를 찾는다
    const parentChain = [];
    let cur = targetId;
    const visited = new Set();
    while (cur && nodesMap[cur] && !visited.has(cur)) {
      visited.add(cur);
      parentChain.unshift(cur);
      if (cur === entryId) break;
      cur = nodesMap[cur]["상위"];
    }
    if (parentChain[0] !== entryId && nodesMap[entryId]) {
      parentChain.unshift(entryId);
    }
    return parentChain;
  }

  function getLayerFromNodeId(nid) {
    const m = String(nid).match(/^[A-Z]{2,4}-(L[0-5]|S)-/);
    return m ? m[1] : "L1";
  }

  function renderClinicBoardMode() {
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

    renderHeaderSymptomTabs();
    renderRoutineDrawerCards();
    renderComboTrailBar(nodesMap);
    renderHorizontalCardBoard(nodesMap);
    renderActiveCardDock(nodesMap[activeNodeId], nodesMap);

    // 레이아웃 렌더링 직후 SVG 가지 연결선 그리기
    requestAnimationFrame(() => {
      drawSvgBranchLines(nodesMap);
    });
  }

  function renderComboTrailBar(nodesMap) {
    pathwayChips.innerHTML = "";
    currentPath.forEach((nid, idx) => {
      const node = nodesMap[nid];
      if (!node) return;
      if (idx > 0) {
        const prevId = currentPath[idx - 1];
        const dec = pathDecisions[prevId];
        const arrow = document.createElement("span");
        arrow.className = "path-arrow";
        arrow.textContent = dec ? `(${dec})→` : "→";
        pathwayChips.appendChild(arrow);
      }
      const chip = document.createElement("button");
      chip.type = "button";
      const isRF = node["레드플래그"] === true;
      chip.className = `path-chip ${nid === activeNodeId ? "active" : ""} ${isRF ? "redflag" : ""}`;
      chip.textContent = `${node.id} ${node["제목"]}`;
      chip.addEventListener("click", () => {
        activeNodeId = nid;
        currentPath = currentPath.slice(0, idx + 1);
        renderClinicBoardMode();
      });
      pathwayChips.appendChild(chip);
    });
  }

  function renderHorizontalCardBoard(nodesMap) {
    const activeNode = nodesMap[activeNodeId];
    const nextBranches = extractBranchesList(activeNode);
    // { targetId: "예" } 매핑
    const nextDecisionMap = {};
    nextBranches.forEach(({ label, targetId }) => {
      nextDecisionMap[targetId] = label;
    });

    const pathSet = new Set(currentPath);
    const evoStats = computeNodeEvolutionStats();

    // L0~L5 그룹핑하되, 각 층에서 (1) 현재 경로 카드 (2) 다음 후보 카드 (3) 나머지 흐릿한 카드 순으로 정렬하면 시선이 자연스럽게 이어짐
    const grouped = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [] };
    Object.values(nodesMap).forEach((node) => {
      const layer = getLayerFromNodeId(node.id);
      if (grouped[layer]) grouped[layer].push(node);
      else grouped.L4.push(node);
    });

    treeColumnsEl.innerHTML = "";

    LAYER_META.forEach(({ key, title }) => {
      const colNodes = (grouped[key] || []).sort((a, b) => {
        const scoreA = a.id === activeNodeId ? 0 : pathSet.has(a.id) ? 1 : nextDecisionMap[a.id] ? 2 : 3;
        const scoreB = b.id === activeNodeId ? 0 : pathSet.has(b.id) ? 1 : nextDecisionMap[b.id] ? 2 : 3;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return String(a.id).localeCompare(String(b.id));
      });

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
        const decisionRibbonLabel = nextDecisionMap[node.id];
        const isPlayableNext = Boolean(decisionRibbonLabel);
        const isDimmed = !isSelected && !isInPath && !isPlayableNext;
        const isRedflag = node["레드플래그"] === true;
        const ntype = node["유형"] || "ask";
        const prof = typeof node["내숙련도"] === "number" ? node["내숙련도"] : null;
        const nStats = evoStats[node.id];

        const card = document.createElement("article");
        card.setAttribute("data-node-id", node.id);
        card.setAttribute("data-type", ntype);
        card.className = [
          "tree-node-card",
          isSelected ? "selected" : "",
          isInPath ? "in-path" : "",
          isPlayableNext ? "recommended-next" : "",
          isDimmed ? "card-dimmed" : "",
          isRedflag ? "redflag-node" : "",
        ]
          .filter(Boolean)
          .join(" ");

        // 다음 선택 가능한 후보 카드면 상단에 "👉 [예] 선택 시" 리본 표시
        let ribbonHtml = "";
        if (isPlayableNext) {
          const isYes =
            decisionRibbonLabel.includes("예") ||
            decisionRibbonLabel.includes("양성") ||
            decisionRibbonLabel.includes("수동제한") ||
            decisionRibbonLabel.includes("진료 시작");
          const isDanger = activeNode && activeNode["레드플래그"] === true && isYes;
          const rCls = isDanger ? "ribbon-danger" : isYes ? "" : "ribbon-no";
          ribbonHtml = `<span class="next-decision-ribbon ${rCls}">👉 [${escapeHtml(
            decisionRibbonLabel
          )}] 카드 뽑기</span>`;
        }

        let badgesHtml = "";
        if (isRedflag) {
          badgesHtml += `<span class="redflag-banner-tag">🚨 레드플래그 · 전원</span>`;
        }
        if (ntype === "treat" && prof !== null) {
          if (prof === 0) {
            badgesHtml += `<span class="mini-badge badge-forbid">⛔ Lv.0 시행금지</span>`;
          } else if (prof <= 2) {
            badgesHtml += `<span class="mini-badge badge-supervise">⚠️ 지도필요 Lv.${prof}</span>`;
          } else {
            badgesHtml += `<span class="mini-badge badge-first-choice">★ Lv.${prof}</span>`;
          }
        }
        if (nStats && nStats.total > 0) {
          if (nStats.signal === "promote") {
            badgesHtml += `<span class="mini-badge badge-first-choice">🌟 주력 (${nStats.rate}%)</span>`;
          } else if (nStats.signal === "demote") {
            badgesHtml += `<span class="mini-badge badge-revise-candidate">🔧 개편후보 (${nStats.rate}%)</span>`;
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

        // 현재 포커스된 카드에는 카드 내부에도 바로 [예] / [아니오] 미니 버튼을 달아 보드에서 시선을 떼지 않고도 진행 가능하게 함
        let inlineChoicesHtml = "";
        if (isSelected && nextBranches.length > 0) {
          const btns = nextBranches
            .map(({ label, targetId }) => {
              const isYes =
                label.includes("예") ||
                label.includes("양성") ||
                label.includes("수동제한") ||
                label.includes("진료 시작");
              const isDanger = isRedflag && isYes;
              const bCls = isDanger ? "inline-danger" : isYes ? "inline-yes" : "inline-no";
              return `<button type="button" class="btn-inline-choice ${bCls}" data-branch-label="${escapeHtml(
                label
              )}" data-branch-target="${escapeHtml(targetId)}">${escapeHtml(label)} →</button>`;
            })
            .join("");
          inlineChoicesHtml = `<div class="card-inline-choices">${btns}</div>`;
        }

        card.innerHTML = `
          ${ribbonHtml}
          <div class="node-card-top">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
              TYPE_KOREAN[ntype] || ntype
            )}</span>
          </div>
          <div class="node-card-title">${escapeHtml(node["제목"])}</div>
          ${previewText ? `<div class="node-card-preview">${escapeHtml(previewText)}</div>` : ""}
          ${badgesHtml ? `<div class="node-card-badges">${badgesHtml}</div>` : ""}
          ${inlineChoicesHtml}
        `;

        // 인라인 분기 버튼 클릭
        card.querySelectorAll(".btn-inline-choice").forEach((b) => {
          b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const lb = b.getAttribute("data-branch-label");
            const tid = b.getAttribute("data-branch-target");
            playCardTransition(node.id, lb, tid);
          });
        });

        // 카드 자체 클릭
        card.addEventListener("click", () => {
          if (isPlayableNext) {
            playCardTransition(activeNodeId, decisionRibbonLabel, node.id);
          } else {
            const idxInPath = currentPath.indexOf(node.id);
            if (idxInPath !== -1) {
              activeNodeId = node.id;
              currentPath = currentPath.slice(0, idxInPath + 1);
            } else {
              // 흐릿한 비선택 카드를 클릭했을 때도 그 카드로 자연스럽게 경로 재구성
              const entryId = mergedTreeData["증상"][activeSymptomCode].entry;
              activeNodeId = node.id;
              currentPath = buildPathToNode(nodesMap, entryId, node.id);
            }
            renderClinicBoardMode();
          }
        });

        colEl.appendChild(card);
      });

      treeColumnsEl.appendChild(colEl);
    });
  }

  function playCardTransition(fromId, decisionLabel, toId) {
    pathDecisions[fromId] = decisionLabel;
    const existingIdx = currentPath.indexOf(toId);
    if (existingIdx !== -1) {
      currentPath = currentPath.slice(0, existingIdx + 1);
    } else {
      currentPath.push(toId);
    }
    activeNodeId = toId;
    renderClinicBoardMode();
  }

  /* ==================== 카드 간 SVG 베지어 곡선 연결선 렌더링 ==================== */
  function drawSvgBranchLines(nodesMap) {
    if (!branchSvgLayer || !boardCanvas) return;
    const canvasRect = boardCanvas.getBoundingClientRect();
    branchSvgLayer.setAttribute("width", String(boardCanvas.scrollWidth));
    branchSvgLayer.setAttribute("height", String(boardCanvas.scrollHeight));
    branchSvgLayer.innerHTML = "";

    const activeEdges = new Set();
    for (let i = 0; i < currentPath.length - 1; i++) {
      activeEdges.add(`${currentPath[i]}->${currentPath[i + 1]}`);
    }

    const activeNode = nodesMap[activeNodeId];
    const nextBranches = extractBranchesList(activeNode);
    const nextTargets = new Map();
    nextBranches.forEach(({ label, targetId }) => {
      nextTargets.set(`${activeNodeId}->${targetId}`, label);
    });

    const ns = branchSvgLayer.namespaceURI;

    Object.values(nodesMap).forEach((srcNode) => {
      const srcEl = boardCanvas.querySelector(`[data-node-id="${srcNode.id}"]`);
      if (!srcEl) return;
      const srcRect = srcEl.getBoundingClientRect();
      const x1 = srcRect.right - canvasRect.left;
      const y1 = srcRect.top + srcRect.height / 2 - canvasRect.top;

      const branches = extractBranchesList(srcNode);
      branches.forEach(({ targetId }) => {
        const dstEl = boardCanvas.querySelector(`[data-node-id="${targetId}"]`);
        if (!dstEl) return;
        const dstRect = dstEl.getBoundingClientRect();
        const x2 = dstRect.left - canvasRect.left;
        const y2 = dstRect.top + dstRect.height / 2 - canvasRect.top;

        const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        const pathEl = document.createElementNS(ns, "path");
        pathEl.setAttribute("d", d);

        const edgeKey = `${srcNode.id}->${targetId}`;
        if (activeEdges.has(edgeKey)) {
          pathEl.setAttribute("class", "svg-edge edge-active-path");
        } else if (nextTargets.has(edgeKey)) {
          const lb = nextTargets.get(edgeKey) || "";
          const isDanger = srcNode["레드플래그"] === true && lb.includes("예");
          pathEl.setAttribute("class", `svg-edge ${isDanger ? "edge-danger-next" : "edge-available-next"}`);
        } else {
          pathEl.setAttribute("class", "svg-edge");
        }

        branchSvgLayer.appendChild(pathEl);
      });
    });
  }

  /* ==================== 우측: 선택된 카드 상세 독 (Active Card Dock) ==================== */
  function renderActiveCardDock(node, nodesMap) {
    if (!node) {
      nodeDetailContent.innerHTML = "<p>보드에서 카드를 선택해 주세요.</p>";
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
      <div class="dock-card-frame">
        <div class="node-card-top">
          <div style="display:flex; gap:0.35rem; align-items:center;">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
              TYPE_KOREAN[ntype] || ntype
            )}</span>
            <span class="mini-badge" style="background:#f1f5f9;">${escapeHtml(node["상태"] || "정본")}</span>
          </div>
          ${
            ntype === "treat" && prof <= 2
              ? `<span class="mini-badge ${prof === 0 ? "badge-forbid" : "badge-supervise"}">${
                  prof === 0 ? "⛔ Lv.0 시행금지" : `⚠️ 지도 필요 (Lv.${prof})`
                }</span>`
              : `<span class="mini-badge badge-first-choice">숙련도 Lv.${prof}</span>`
          }
        </div>

        <h2 class="dock-card-title">${escapeHtml(node["제목"])}</h2>

        ${
          isRedflag
            ? `<div class="redflag-alert-box">
                🚨 [레드플래그 — 즉시 전원] 양성 소견 시 원내 모든 시술을 보류하고 즉시 응급실/상급병원으로 전원하십시오.<br>
                • 전원 기준: ${escapeHtml(node["전원기준"] || "양성 시 지체 없이 응급 전원")}
               </div>`
            : ""
        }
    `;

    // 유형별 메인 카드 효과 영역
    if (ntype === "ask") {
      html += `
        <div class="hero-question-box">
          <div class="hero-question-text">Q. “${escapeHtml(node["질문"] || node["제목"])}”</div>
          <div class="hero-why-text"><strong>💡 왜 묻는가:</strong> ${escapeHtml(
            node["왜"] || "임상 분기 판정"
          )}</div>
        </div>
      `;
    } else if (ntype === "test") {
      html += `
        <div class="hero-question-box" style="background:#faf5ff; border-left-color:#7c3aed;">
          <div class="hero-question-text" style="color:#4c1d95;">🔬 ${escapeHtml(
            node["검사명"] || node["제목"]
          )}</div>
          <div class="hero-why-text"><strong>🎯 배제 대상:</strong> ${escapeHtml(
            node["배제대상"] || "-"
          )}</div>
          ${
            node["민감도"]
              ? `<div class="hero-why-text"><strong>📊 정확도:</strong> 민감도 ${escapeHtml(
                  node["민감도"]
                )} · 특이도 ${escapeHtml(node["특이도"] || "-")} · LR+ ${escapeHtml(node["LR+"] || "-")}</div>`
              : ""
          }
        </div>
      `;
    } else if (ntype === "dx") {
      const candidates = Array.isArray(node["후보"]) ? node["후보"] : [node["제목"]];
      html += `
        <div class="hero-question-box" style="background:#fffbeb; border-left-color:#d97706;">
          <div style="font-size:0.78rem; font-weight:800; color:#b45309;">🩺 감별 진단 후보</div>
          <div style="font-size:1rem; font-weight:800; color:#78350f; margin-top:0.25rem;">
            ${candidates.map((c) => `• ${escapeHtml(c)}`).join("<br>")}
          </div>
          ${
            node["위험감별"]
              ? `<div class="hero-why-text" style="color:#dc2626; font-weight:700;">🚨 위험 감별: ${escapeHtml(
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
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
            <strong style="color:#166534; font-size:0.88rem;">💊 치료 오더 (차트 복사)</strong>
            <button type="button" id="btn-copy-treat-set" class="btn btn-sm btn-primary">
              📋 자침점·용량·빈도 복사
            </button>
          </div>
          <pre id="treat-copy-text" class="treat-copy-pre">${escapeHtml(copyPayload)}</pre>
          ${
            node["환자설명"]
              ? `<button type="button" class="btn btn-outline btn-open-patient-teach">
                   🖥️ 환자에게 보여주기 (24px+ 큰 글씨 화면)
                 </button>`
              : ""
          }
        </div>
      `;
    } else if (ntype === "teach") {
      html += `
        <div class="treat-summary-box" style="background:#fdf2f8; border-color:#f472b6;">
          <strong style="color:#9d174d; font-size:0.9rem;">🗣️ 환자 설명 3문장 & 생활 수칙</strong>
          <p style="font-size:0.95rem; font-weight:700; color:#1e293b;">${escapeHtml(
            node["환자설명"] || ""
          )}</p>
          <button type="button" class="btn btn-primary btn-open-patient-teach">
            🖥️ 환자에게 보여주기 (24px+ 큰 글씨 교육 화면)
          </button>
        </div>
      `;
    }

    // 다음 카드 뽑기(분기 선택) 버튼
    if (branches.length > 0) {
      const btnsHtml = branches
        .map(({ label, targetId }) => {
          const tNode = nodesMap[targetId];
          const tTitle = tNode ? tNode["제목"] : targetId;
          const isYes =
            label.includes("예") ||
            label.includes("양성") ||
            label.includes("수동제한") ||
            label.includes("진료 시작");
          const cls = isRedflag && isYes ? "choice-danger" : isYes ? "choice-yes" : "choice-no";
          return `
            <button type="button" class="dock-choice-btn ${cls} btn-dock-branch" data-label="${escapeHtml(
            label
          )}" data-target="${escapeHtml(targetId)}">
              <span>👉 [${escapeHtml(label)}]</span>
              <span style="font-size:0.82rem; opacity:0.92;">${escapeHtml(tTitle)} (${escapeHtml(targetId)}) →</span>
            </button>
          `;
        })
        .join("");

      html += `
        <div>
          <div style="font-size:0.78rem; font-weight:800; color:var(--text-muted); margin-bottom:0.35rem;">
            🎴 다음 이어질 카드 고르기:
          </div>
          <div class="dock-choice-grid">${btnsHtml}</div>
        </div>
      `;
    }

    // 보조 스펙
    const extraItems = [
      ["확률 ↑", node["올리는소견"]],
      ["확률 ↓", node["내리는소견"]],
      ["생활 지도", node["생활지도"]],
      ["주의/금기", node["하지말아야할것"] || node["금기"]],
      ["전원 기준", node["전원기준"]],
      ["근거", node["근거"]],
    ].filter((x) => x[1]);

    if (extraItems.length > 0 || (nodeStat && nodeStat.total > 0)) {
      html += `<div class="detail-kv-list">`;
      if (nodeStat && nodeStat.total > 0) {
        html += `
          <div class="detail-kv-item" style="background:#f0fdf4; border-color:#86efac;">
            <span class="detail-kv-label">🧬 실전 승률(반응률):</span>
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

    html += `</div>`; // close .dock-card-frame
    nodeDetailContent.innerHTML = html;

    nodeDetailContent.querySelectorAll(".btn-dock-branch").forEach((btn) => {
      btn.addEventListener("click", () => {
        playCardTransition(node.id, btn.getAttribute("data-label"), btn.getAttribute("data-target"));
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

  /* ==================== MODE 2 - WORKSHOP 1: 프로토콜 카드 제작소 ==================== */
  function populateSymptomSelects() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const entries = Object.entries(mergedTreeData["증상"]);
    const html = entries
      .map(
        ([code, obj]) =>
          `<option value="${escapeHtml(code)}" ${code === activeSymptomCode ? "selected" : ""}>${escapeHtml(
            obj.name
          )} (${escapeHtml(code)} · 카드 ${Object.keys(obj.nodes || {}).length}장)</option>`
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
          ? branches
              .map(
                (b) =>
                  `<span class="mini-badge" style="background:#e0f2fe; color:#0369a1;">[${escapeHtml(
                    b.label
                  )}] → ${escapeHtml(b.targetId)}</span>`
              )
              .join(" ")
          : `<span style="font-size:0.74rem; color:var(--text-muted);">종착 카드</span>`;

      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
          <div>
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(
              TYPE_KOREAN[node["유형"]] || node["유형"]
            )}</span>
            <strong style="font-size:0.9rem; margin-left:0.25rem;">${escapeHtml(node["제목"])}</strong>
          </div>
          <button type="button" class="btn btn-sm btn-secondary btn-outline-edit" data-id="${escapeHtml(node.id)}">
            ✏️ 카드 편집
          </button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.28rem; align-items:center;">
          <span style="font-size:0.74rem; color:var(--text-muted); font-weight:800;">연결 가지:</span>
          ${branchSummary}
        </div>
        <div class="outline-branch-actions">
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="예">
            + [예/양성] 새 카드 연결
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="아니오">
            + [아니오/음성] 새 카드 연결
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-quick-branch" data-id="${escapeHtml(
            node.id
          )}" data-branch="다음">
            + 다음 치료/티칭 카드 연결
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
        headingEl.textContent = `🃏 [${node.id}]의 '${branchLabel || "새"}' 가지에 연결될 새 카드(${candidateId})`;
      }
      document.getElementById("edit-node-title").focus();
      showToast(`🃏 ${node.id}의 [${branchLabel}] 가지로 새 카드(${candidateId}) 슬롯이 준비되었습니다.`);
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

      if (headingEl) headingEl.textContent = `🃏 [${node.id}] ${node["제목"]} 카드 수정`;
    }
  }

  /* ==================== MODE 2 - WORKSHOP 2: 카드게임식 루틴 덱 빌더 ==================== */
  function renderRoutineDeckBuilder() {
    const symSel = document.getElementById("routine-sym-input");
    const symCode = symSel ? symSel.value || activeSymptomCode : activeSymptomCode;
    const sym = mergedTreeData && mergedTreeData["증상"] ? mergedTreeData["증상"][symCode] : null;
    const nodesMap = sym ? sym.nodes || {} : {};

    // 만약 슬롯이 비어 있으면 현재 진료 경로로 초기 세팅
    if (builderDeckSlots.length === 0 && currentPath.length > 0 && currentPath[0].startsWith(symCode)) {
      builderDeckSlots = currentPath.slice();
    }

    renderRoutineVisualSlots(nodesMap);
    renderRoutineCardPool(nodesMap);
  }

  function renderRoutineVisualSlots(nodesMap) {
    const slotsEl = document.getElementById("routine-visual-slots");
    const hiddenInput = document.getElementById("routine-path-input");
    if (!slotsEl || !hiddenInput) return;

    hiddenInput.value = builderDeckSlots.join(", ");

    if (builderDeckSlots.length === 0) {
      slotsEl.innerHTML = `<span style="font-size:0.82rem; color:#94a3b8;">아직 슬롯이 비어 있습니다. 아래 보유 카드 풀에서 카드를 클릭해 순서대로 꽂아주세요.</span>`;
      return;
    }

    slotsEl.innerHTML = "";
    builderDeckSlots.forEach((nid, idx) => {
      if (idx > 0) {
        const arrow = document.createElement("span");
        arrow.style.color = "#818cf8";
        arrow.style.fontWeight = "900";
        arrow.textContent = "→";
        slotsEl.appendChild(arrow);
      }
      const n = nodesMap[nid];
      const title = n ? n["제목"] : nid;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "deck-slot-card";
      chip.title = "클릭하면 덱에서 이 카드를 뺍니다";
      chip.innerHTML = `<span>${idx + 1}. ${escapeHtml(nid)}</span> <span style="opacity:0.9;">${escapeHtml(
        title
      )}</span> <span>✕</span>`;
      chip.addEventListener("click", () => {
        builderDeckSlots.splice(idx, 1);
        renderRoutineVisualSlots(nodesMap);
        renderRoutineCardPool(nodesMap);
      });
      slotsEl.appendChild(chip);
    });
  }

  function renderRoutineCardPool(nodesMap) {
    const poolEl = document.getElementById("routine-card-pool");
    if (!poolEl) return;

    const sortedNodes = Object.values(nodesMap).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    poolEl.innerHTML = "";

    sortedNodes.forEach((node) => {
      const inDeck = builderDeckSlots.includes(node.id);
      const card = document.createElement("div");
      card.className = `pool-mini-card ${inDeck ? "in-deck" : ""}`;
      card.innerHTML = `
        <div class="node-card-top">
          <span class="node-id-badge">${escapeHtml(node.id)}</span>
          <span class="node-type-badge type-${escapeHtml(node["유형"])}">${escapeHtml(
            TYPE_KOREAN[node["유형"]] || node["유형"]
          )}</span>
        </div>
        <div style="font-size:0.82rem; font-weight:800;">${escapeHtml(node["제목"])}</div>
        <div style="font-size:0.72rem; color:${inDeck ? "#6d28d9" : "var(--text-muted)"}; font-weight:700;">
          ${inDeck ? "✔ 덱에 포함됨 (다시 누르면 해제)" : "+ 클릭하여 덱 슬롯에 추가"}
        </div>
      `;
      card.addEventListener("click", () => {
        const idx = builderDeckSlots.indexOf(node.id);
        if (idx >= 0) {
          builderDeckSlots.splice(idx, 1);
        } else {
          builderDeckSlots.push(node.id);
        }
        renderRoutineVisualSlots(nodesMap);
        renderRoutineCardPool(nodesMap);
      });
      poolEl.appendChild(card);
    });
  }

  function renderRoutineManager() {
    const container = document.getElementById("routine-list-container");
    if (!container) return;

    if (routinesList.length === 0) {
      container.innerHTML = "<p>저장된 루틴 덱이 없습니다.</p>";
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
            <strong style="font-size:0.96rem; margin-left:0.35rem;">⚡ ${escapeHtml(rt.name)}</strong>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-sm btn-primary btn-run-routine" data-id="${escapeHtml(rt.id)}">
              🩺 진료 보드에 펼치기
            </button>
            <button type="button" class="btn btn-sm btn-danger-outline btn-del-routine" data-id="${escapeHtml(
              rt.id
            )}">
              삭제
            </button>
          </div>
        </div>
        <div style="font-size:0.78rem; color:#0369a1; font-weight:800;">
          카드 콤보: ${escapeHtml((rt.path || []).join(" → "))}
        </div>
        ${
          rt.orderMemo
            ? `<div style="font-size:0.82rem; color:var(--text-muted); background:#ffffff; padding:0.45rem 0.65rem; border-radius:6px; border:1px solid var(--border-light);">
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
        showToast("루틴 덱이 삭제되었습니다.");
      });
    });
  }

  /* ==================== MODE 2 - WORKSHOP 3: 내 스킬 도감 ==================== */
  function renderSkillRegistry() {
    const container = document.getElementById("skill-list-grid");
    if (!container) return;

    container.innerHTML = "";
    skillsList.forEach((sk) => {
      const lv = Number(sk.level) || 0;
      const stars = "★".repeat(lv) + "☆".repeat(Math.max(0, 5 - lv));
      const card = document.createElement("div");
      card.className = "skill-card";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
          <div>
            <span class="node-id-badge">${escapeHtml(sk.id)} · ${escapeHtml(sk.category)}</span>
            <h3 style="font-size:0.95rem; font-weight:900; margin-top:0.25rem;">${escapeHtml(sk.name)}</h3>
          </div>
          <span class="prof-chip prof-${lv}">Lv.${lv} ${stars}</span>
        </div>
        <div style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(sk.notes || "")}</div>
        <div style="font-size:0.76rem; color:#0369a1; font-weight:800;">
          장착된 카드: ${escapeHtml((sk.linkedNodes || []).join(", ") || "없음")}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; padding-top:0.4rem; border-top:1px solid var(--border-light);">
          <select class="select-input skill-lv-change" data-id="${escapeHtml(sk.id)}" style="font-size:0.78rem; padding:0.2rem 0.45rem;">
            <option value="0" ${lv === 0 ? "selected" : ""}>Lv.0 미경험(⛔)</option>
            <option value="1" ${lv === 1 ? "selected" : ""}>Lv.1 관찰(⚠️)</option>
            <option value="2" ${lv === 2 ? "selected" : ""}>Lv.2 부분시행(⚠️)</option>
            <option value="3" ${lv === 3 ? "selected" : ""}>Lv.3 지도하완수(🔶)</option>
            <option value="4" ${lv === 4 ? "selected" : ""}>Lv.4 단독숙련(✅)</option>
            <option value="5" ${lv === 5 ? "selected" : ""}>Lv.5 마스터(🌟)</option>
          </select>
          <div style="display:flex; align-items:center; gap:0.35rem;">
            <span style="font-size:0.78rem; font-weight:800;">누적 ${Number(sk.count || 0)}회</span>
            <button type="button" class="btn btn-sm btn-outline skill-inc-count" data-id="${escapeHtml(sk.id)}">
              +1회 (+EXP)
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
        await dbPut("skills", sk);
        rebuildMergedTree();
        renderSkillRegistry();
        showToast(`🎯 ${sk.name} 숙련도가 Lv.${sk.level}(으)로 변경되었습니다.`);
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
        showToast(`📈 ${sk.name} 누적 시행 ${sk.count}회 달성!`);
      });
    });
  }

  /* ==================== MODE 2 - WORKSHOP 4: 진화 통계 & AI 협업 ==================== */
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
        '<p style="font-size:0.84rem; color:var(--text-muted);">기록된 케이스가 없습니다. [⚡ 샘플 케이스 6건 시뮬레이션]을 눌러 카드 승률 진화를 확인해 보세요.</p>';
    } else {
      evoContainer.innerHTML = "";
      statEntries.forEach(([nid, st]) => {
        if (!nid.includes("-L4-") && !nid.includes("-L3-") && st.memos.length === 0) return;
        let badge = `<span class="mini-badge" style="background:#e2e8f0;">데이터 수집 중 (n=${st.total})</span>`;
        let cls = "";
        if (st.signal === "promote") {
          badge = `<span class="mini-badge badge-first-choice">🌟 1차 주력 카드 승격 (승률 ${st.rate}% ≥ 70%, n=${st.total})</span>`;
          cls = "promote";
        } else if (st.signal === "demote") {
          badge = `<span class="mini-badge badge-revise-candidate">🔧 카드 개편 후보 (승률 ${st.rate}% < 40%, n=${st.total})</span>`;
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
          <div style="font-size:0.82rem;">실전 ${st.total}판 중 <strong>${st.responders}판 호전 (반응률 ${st.rate}%)</strong></div>
          ${
            uniqueMemos.length > 0
              ? `<div style="font-size:0.78rem; color:#334155;">💡 메모: ${escapeHtml(uniqueMemos.join(" / "))}</div>`
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
          <div style="font-size:0.76rem; color:var(--text-muted);">콤보: ${escapeHtml((c.path || []).join(" → "))}</div>
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

  /* ==================== 카드 편집기 → 노드 객체 & 마크다운 변환 ==================== */
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
      `# [CLIN-7 진료 카드 콤보 AI 3줄 점검 요청]`,
      `- 증상: ${sym.name} (${activeSymptomCode})`,
      `- 선택한 카드 경로: ${currentPath.join(" → ")}`,
      "",
      `## 카드 컨텍스트`,
      pathDetails,
      "",
      `## AI 점검 요청 (각 1~2줄)`,
      `1. [빠진 질문/검사 카드]: 현재 콤보에서 놓치기 쉬운 추가 문진이나 이학적 검사`,
      `2. [감별 누락 / 레드플래그]: 반드시 배제해야 할 위험 감별진단`,
      `3. [금기 / 내 숙련도 주의]: 선택된 치료 카드의 금기사항 또는 숙련도(Lv.0~2) 주의점`,
    ].join("\n");
  }

  function generateAiEvolutionBrief() {
    const stats = computeNodeEvolutionStats();
    const lines = [
      `# [CLIN-7 프로토콜 진화 & 신규 카드 공동 설계 브리프]`,
      `- 대상 증상: ${activeSymptomCode}`,
      `- 누적 케이스: ${casesList.length}건`,
      "",
      `## 카드별 치료 승률(반응률) & 임상 메모`,
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
      `위 피드백을 반영해 \`00_스키마.md\` 규격(\`## ID 제목\` + \`yaml\` 블록)으로 추가할 새 문진/검사/치료 카드를 작성해 주십시오.`
    );
    return lines.join("\n");
  }

  /* ==================== 빠른 검색 팝오버 ==================== */
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
        if (hay.includes(q)) matched.push({ symCode: code, symName: sym.name, node });
      });
    });

    nodeSearchSection.hidden = false;
    nodeSearchGrid.innerHTML = "";
    if (matched.length === 0) {
      nodeSearchGrid.innerHTML = "<p style='color:#94a3b8; font-size:0.84rem;'>일치하는 카드가 없습니다.</p>";
      return;
    }

    matched.slice(0, 9).forEach(({ symCode, symName, node }) => {
      const card = document.createElement("div");
      card.className = "routine-deck-item";
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between;">
          <span style="font-size:0.74rem; color:#38bdf8; font-weight:800;">${escapeHtml(symName)} · ${escapeHtml(
            node.id
          )}</span>
          <span style="font-size:0.72rem;">${escapeHtml(TYPE_KOREAN[node["유형"]] || node["유형"])}</span>
        </div>
        <strong style="font-size:0.9rem;">${escapeHtml(node["제목"])}</strong>
      `;
      card.addEventListener("click", () => {
        nodeSearchSection.hidden = true;
        searchInput.value = "";
        if (currentMode !== "clinic") switchMode("clinic");
        selectSymptom(symCode, node.id);
      });
      nodeSearchGrid.appendChild(card);
    });
  }

  /* ==================== 이벤트 바인딩 ==================== */
  function bindEvents() {
    document.getElementById("btn-mode-clinic").addEventListener("click", () => switchMode("clinic"));
    document.getElementById("btn-mode-setup").addEventListener("click", () => switchMode("setup"));

    document.querySelectorAll(".setup-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchSetupSubview(btn.getAttribute("data-subview")));
    });

    // 내 루틴 덱 서랍 토글
    document.getElementById("btn-toggle-routine-drawer").addEventListener("click", () => {
      routineDrawer.hidden = !routineDrawer.hidden;
      if (!routineDrawer.hidden) renderRoutineDrawerCards();
    });
    document.getElementById("btn-close-routine-drawer").addEventListener("click", () => {
      routineDrawer.hidden = true;
    });
    document.getElementById("btn-go-routine-builder").addEventListener("click", () => {
      routineDrawer.hidden = true;
      switchMode("setup");
      switchSetupSubview("routines");
    });

    // 검색
    searchInput.addEventListener("input", (e) => handleQuickSearch(e.target.value));
    document.getElementById("btn-close-search").addEventListener("click", () => {
      nodeSearchSection.hidden = true;
      searchInput.value = "";
    });

    // 보드 컨트롤
    document.getElementById("btn-path-undo").addEventListener("click", () => {
      if (currentPath.length > 1) {
        currentPath.pop();
        activeNodeId = currentPath[currentPath.length - 1];
        renderClinicBoardMode();
      }
    });

    document.getElementById("btn-path-reset").addEventListener("click", () => {
      selectSymptom(activeSymptomCode);
    });

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

    // 윈도우 리사이즈 및 보드 스크롤 시 SVG 연결선 재계산
    window.addEventListener("resize", () => {
      if (currentMode === "clinic" && mergedTreeData && mergedTreeData["증상"][activeSymptomCode]) {
        drawSvgBranchLines(mergedTreeData["증상"][activeSymptomCode].nodes || {});
      }
    });

    // 3초 케이스 기록 & AI 점검
    document.getElementById("btn-clinic-ai-prompt").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "현재 카드 콤보 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-qc-save").addEventListener("click", async () => {
      const nrsBefore = Number(document.getElementById("qc-nrs-before").value);
      const nrsAfter = Number(document.getElementById("qc-nrs-after").value);
      const memo = document.getElementById("qc-memo").value.trim();

      if (PHONE_REGEX.test(memo) || RRN_REGEX.test(memo)) {
        showToast("⛔ 전화번호·주민번호 등 식별정보는 입력할 수 없습니다.");
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
      renderClinicBoardMode();
      await copyToClipboard(formatCaseToMarkdown(caseObj), `${caseId} 케이스 기록 & md 복사`);
    });

    // 환자 교육 모달 닫기
    document.getElementById("btn-close-teach-modal").addEventListener("click", () => {
      teachModal.hidden = true;
    });

    // 세팅 모드 증상 변경
    document.getElementById("setup-symptom-select").addEventListener("change", (e) => {
      activeSymptomCode = e.target.value;
      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry && sym.nodes[sym.entry]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[sym.entry], false, "");
      }
      renderVisualTreeOutline();
    });

    // 카드 제작소 폼 저장
    document.getElementById("node-editor-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const item = buildNodeObjectFromEditor();
      if (!/^[A-Z]{2,4}-(L[0-5]|S)-\d{2,3}$/.test(item.node.id)) {
        showToast("⛔ 카드 ID 형식을 확인해 주세요 (예: HA-L1-03)");
        return;
      }

      const existingIdx = customNodesList.findIndex((x) => x.id === item.node.id);
      if (existingIdx >= 0) customNodesList[existingIdx] = { id: item.node.id, ...item };
      else customNodesList.push({ id: item.node.id, ...item });

      await dbPut("custom_nodes", { id: item.node.id, ...item });
      rebuildMergedTree();
      populateSymptomSelects();
      renderVisualTreeOutline();
      await copyToClipboard(formatNodeToVaultMarkdown(item.node), `${item.node.id} 카드 저장 & md 복사`);
    });

    document.getElementById("btn-reset-editor").addEventListener("click", () => {
      document.getElementById("node-editor-form").reset();
      document.getElementById("edit-sym-code").value = activeSymptomCode;
      const sym = mergedTreeData["증상"][activeSymptomCode];
      document.getElementById("edit-sym-name").value = sym ? sym.name : activeSymptomCode;
      document.getElementById("editor-form-heading").textContent = "🃏 새 카드 / 새 증상 덱 만들기";
    });

    document.getElementById("btn-copy-single-node-md").addEventListener("click", () => {
      const item = buildNodeObjectFromEditor();
      copyToClipboard(formatNodeToVaultMarkdown(item.node), `${item.node.id} md`);
    });

    document.getElementById("btn-export-custom-nodes-md").addEventListener("click", () => {
      if (customNodesList.length === 0) {
        showToast("저장된 커스텀 카드가 없습니다.");
        return;
      }
      const md = customNodesList.map((item) => formatNodeToVaultMarkdown(item.node)).join("\n\n");
      copyToClipboard(md, `커스텀 카드 ${customNodesList.length}장 md`);
    });

    document.getElementById("btn-clear-custom-nodes").addEventListener("click", async () => {
      customNodesList = [];
      await dbClear("custom_nodes");
      rebuildMergedTree();
      renderVisualTreeOutline();
      showToast("커스텀 카드 수정 내역이 초기화되었습니다.");
    });

    // 루틴 덱 빌더 이벤트
    document.getElementById("routine-sym-input").addEventListener("change", (e) => {
      activeSymptomCode = e.target.value;
      builderDeckSlots = [];
      renderRoutineDeckBuilder();
    });

    document.getElementById("btn-fill-routine-from-path").addEventListener("click", () => {
      document.getElementById("routine-sym-input").value = activeSymptomCode;
      builderDeckSlots = currentPath.slice();
      renderRoutineDeckBuilder();
      showToast("현재 진료 보드 카드 경로를 슬롯에 가져왔습니다.");
    });

    document.getElementById("btn-clear-routine-slots").addEventListener("click", () => {
      builderDeckSlots = [];
      renderRoutineDeckBuilder();
    });

    document.getElementById("routine-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (builderDeckSlots.length === 0) {
        showToast("⛔ 루틴 덱 슬롯에 카드를 최소 1장 이상 담아주세요.");
        return;
      }
      const symptom = document.getElementById("routine-sym-input").value;
      const name = document.getElementById("routine-name-input").value.trim();
      const orderMemo = document.getElementById("routine-order-input").value.trim();

      const id = `RT-${String(routinesList.length + 1).padStart(2, "0")}`;
      const rtObj = { id, symptom, name, path: builderDeckSlots.slice(), orderMemo };
      routinesList.push(rtObj);
      await dbPut("routines", rtObj);
      updateBadges();
      renderRoutineManager();
      document.getElementById("routine-name-input").value = "";
      document.getElementById("routine-order-input").value = "";
      showToast(`🎴 새 진료 루틴 덱 '${name}'이(가) 완성되었습니다!`);
    });

    document.getElementById("btn-export-routines-md").addEventListener("click", () => {
      const lines = ["# 내 진료 루틴 덱 모음", ""];
      routinesList.forEach((r) => {
        lines.push(`## ${r.id} [${r.symptom}] ${r.name}`);
        lines.push(`- **카드 콤보**: \`${(r.path || []).join(" → ")}\``);
        lines.push(`- **오더 메모**: ${r.orderMemo || "-"}`);
        lines.push("");
      });
      copyToClipboard(lines.join("\n"), "내 진료 루틴 덱 md");
    });

    // 스킬 도감 등록
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
      showToast(`🎯 스킬 '${name}'이(가) 도감에 등록되었습니다.`);
    });

    document.getElementById("btn-export-skills-md").addEventListener("click", () => {
      const lines = [
        "# 내 임상 스킬 도감 (00_스킬_레지스트리.md)",
        "",
        "| 스킬ID | 분류 | 술기명 | 내숙련도(0~5) | 시행횟수 | 장착 카드 | 메모 |",
        "| :--- | :--- | :--- | :---: | :---: | :--- | :--- |",
      ];
      skillsList.forEach((s) => {
        lines.push(
          `| ${s.id} | ${s.category} | ${s.name} | Lv.${s.level} | ${s.count}회 | ${(
            s.linkedNodes || []
          ).join(", ")} | ${s.notes || "-"} |`
        );
      });
      copyToClipboard(lines.join("\n"), "내 스킬 도감 md");
    });

    // 케이스 기록 폼
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
          memo: "턱관절 이갈이 동반 환자로 L1에 TMJ 질문 카드 추가 제안",
        },
        {
          symptom: "HA",
          path: ["HA-L0-01", "HA-L1-01", "HA-L1-02", "HA-L2-01", "HA-L3-01", "HA-L4-01"],
          nrsBefore: 6,
          nrsAfter: 1,
          timepoint: "2주",
          finalDx: "경추성 두통",
          memo: "표준 침·부항 카드 5연속 호전 (1차 주력 카드 승격)",
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
      showToast("⚡ 샘플 케이스 6건이 추가되어 1차 주력 카드 승격 신호가 켜졌습니다!");
    });

    document.getElementById("btn-gen-ai-consult").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "현재 카드 경로 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-gen-ai-evolution").addEventListener("click", () => {
      copyToClipboard(generateAiEvolutionBrief(), "프로토콜 진화·신규 카드 AI 프롬프트");
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

    const seedFlag = localStorage.getItem("clin7_seed_v3");
    if (savedSkills.length === 0 || seedFlag !== "done") {
      const skillMap = new Map(savedSkills.map((s) => [s.id, s]));
      for (const sk of DEFAULT_SKILLS) {
        if (!skillMap.has(sk.id) || seedFlag !== "done") {
          const prevCount = skillMap.has(sk.id) ? skillMap.get(sk.id).count : sk.count;
          const mergedSk = Object.assign({}, sk, { count: prevCount });
          skillMap.set(sk.id, mergedSk);
          await dbPut("skills", mergedSk);
        }
      }
      skillsList = Array.from(skillMap.values());
    } else {
      skillsList = savedSkills;
    }

    if (savedRoutines.length === 0 || seedFlag !== "done") {
      const rtMap = new Map(savedRoutines.map((r) => [r.id, r]));
      for (const rt of DEFAULT_ROUTINES) {
        if (!rtMap.has(rt.id) || seedFlag !== "done") {
          rtMap.set(rt.id, rt);
          await dbPut("routines", rt);
        }
      }
      routinesList = Array.from(rtMap.values());
      localStorage.setItem("clin7_seed_v3", "done");
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

      if (generatedEl) generatedEl.textContent = baseTreeData.generated || "OK";

      populateSymptomSelects();
      renderClinicBoardMode();

      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry && sym.nodes[sym.entry]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[sym.entry], false, "");
      }
    } catch (err) {
      gridEl.innerHTML = `<p style="color:red;">tree.json 로드 실패: ${escapeHtml(err.message || String(err))}</p>`;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  init();
})();
