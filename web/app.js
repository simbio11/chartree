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
    { key: "L0", title: "L0 · 호소 양상" },
    { key: "L1", title: "L1 · 문진" },
    { key: "L2", title: "L2 · 검사" },
    { key: "L3", title: "L3 · 감별" },
    { key: "L4", title: "L4 · 치료·티칭" },
    { key: "L5", title: "L5 · 결과·전원" },
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

  const MODALITY_ICONS = {
    침: "🪡 침",
    전침: "⚡ 전침",
    약침: "💉 약침",
    추나: "👐 추나",
    "수기·정복": "👐 수기",
    한약: "🌿 한약",
    재활: "🧘 재활",
  };

  const SYMPTOM_CATEGORIES = [
    {
      key: "msk",
      icon: "🦴",
      label: "척추 · 관절",
      codes: ["LBP", "NP", "SH", "KN", "AN", "EL", "HN", "FTL", "TMJ"],
    },
    {
      key: "neuro",
      icon: "🧠",
      label: "두경부 · 신경",
      codes: ["HA", "DZ", "FP", "TIN"],
    },
    {
      key: "internal",
      icon: "🫁",
      label: "소화 · 호흡 · 순환",
      codes: ["DY", "AB", "RH", "ED"],
    },
    {
      key: "special",
      icon: "🌙",
      label: "수면 · 피로 · 부인",
      codes: ["SL", "FT", "DM"],
    },
  ];

  const FALLBACK_CATEGORY = { key: "etc", icon: "📁", label: "기타 증상" };

  const DEFAULT_SKILLS = [
    {
      id: "SK-001",
      category: "침·전침",
      name: "두경부·편두통·전정·요추 심부 표적 침술 (협척·신수·풍지·예풍)",
      level: 4,
      count: 42,
      linkedNodes: ["HA-L4-01", "DZ-L4-02", "SH-L4-01", "LBP-L4-01", "NP-L4-01", "KN-L4-01", "AN-L4-01", "EL-L4-01", "HN-L4-01", "FTL-L4-01", "DY-L4-01", "AB-L4-01"],
      notes: "두경부·사지·말초신경·족부·위장/대장(천추·상거허·팔료혈) 표적 자침. 마른체형 천추 심자 주의, 흉추 배수혈 기흉 주의.",
      updated: "2026-11-19",
    },
    {
      id: "SK-002",
      category: "침·전침",
      name: "경항부·협착·사지관절·DPN·족저·위장/대장(천추-복결) 2Hz / 100Hz 전침술",
      level: 4,
      count: 35,
      linkedNodes: ["HA-L4-02", "DZ-L4-03", "SH-L4-01", "LBP-L4-02", "NP-L4-02", "KN-L4-02", "AN-L4-02", "EL-L4-02", "HN-L4-02", "FTL-L4-02", "DY-L4-02", "AB-L4-02"],
      notes: "만성 변비엔 천추-복결(동측 연결) 2/10Hz, IBS엔 족삼리-상거허 2Hz. 급성 복증·장폐색·임신부·심장박동기 절대 금기.",
      updated: "2026-11-19",
    },
    {
      id: "SK-003",
      category: "약침·봉침",
      name: "척추·관절·신경·족부·배수혈(T3-T10/대장수·팔료혈) 약침술",
      level: 3,
      count: 14,
      linkedNodes: ["HA-L4-03", "DZ-L4-04", "SH-L4-02", "LBP-L4-03", "NP-L4-03", "KN-L4-03", "AN-L4-03", "EL-L4-03", "HN-L4-03", "FTL-L4-03", "DY-L4-03", "AB-L4-03"],
      notes: "흉추 기흉 및 전복부 장막 천공 회피(배부/천골부 권장); 신경·건 실질 내 직접 주사 및 급성 복증 절대 금지.",
      updated: "2026-11-19",
    },
    {
      id: "SK-004",
      category: "추나·수기",
      name: "Cox · 상경추·사지 추나 · 흉요천추/횡격막 MFR · 시계방향 대장유동",
      level: 3,
      count: 28,
      linkedNodes: ["HA-L4-04", "DZ-L4-05", "SH-L4-03", "LBP-L4-04", "NP-L4-04", "KN-L4-04", "AN-L4-04", "EL-L4-04", "HN-L4-04", "FTL-L4-04", "DY-L4-04", "AB-L4-04"],
      notes: "변비·IBS엔 요천추·장요근 이완 + 시계방향 대장 유동(충수염·게실염·IBD 활동기·장폐색 시 복부 마사지 절대 금지).",
      updated: "2026-11-19",
    },
    {
      id: "SK-005",
      category: "이학적검사",
      name: "HINTS+ · SLR · Ottawa · Durkan · Windlass · 복진(McBurney/Carnett/Murphy)",
      level: 4,
      count: 19,
      linkedNodes: ["DZ-L2-01", "DZ-L2-02", "DZ-L4-01", "LBP-L2-01", "LBP-L2-04", "NP-L2-02", "NP-L2-06", "KN-L2-02", "AN-L2-01", "AN-L2-04", "EL-L2-01", "EL-L2-03", "HN-L2-01", "HN-L2-04", "HN-L2-06", "FTL-L2-01", "FTL-L2-02", "FTL-L2-04", "FTL-L2-05", "DY-L2-01", "DY-L2-02", "DY-L2-04", "DY-L2-05", "AB-L2-01", "AB-L2-02", "AB-L2-03", "AB-L2-05"],
      notes: "9분면 청진→촉진, McBurney/Rovsing/Psoas(충수염), 브리스톨 척도, Carnett, 탈수 4징후 및 50세↑ 대장내시경 기준 점검.",
      updated: "2026-11-19",
    },
    {
      id: "SK-006",
      category: "한약처방",
      name: "변증 한약 (독활기생탕·평위산·반하사심탕·오패산·통사요방·대건중탕·곽향정기산)",
      level: 4,
      count: 54,
      linkedNodes: ["HA-L4-05", "DZ-L4-06", "SH-L4-04", "LBP-L4-06", "NP-L4-05", "KN-L4-06", "AN-L4-05", "EL-L4-06", "HN-L4-05", "FTL-L4-05", "DY-L4-05", "AB-L4-05"],
      notes: "IBS엔 통사요방·삼령백출산, 변비/유착엔 대건중탕·마자인환(대황 장기연용 금기), SIBO 가스 시 다당류 조절.",
      updated: "2026-11-19",
    },
    {
      id: "SK-007",
      category: "추나·수기",
      name: "WalkBack · Big 3 · CCFT · Rathleff·Alfredson · 횡격막호흡 · 배변발판자세",
      level: 4,
      count: 15,
      linkedNodes: ["HA-L4-06", "LBP-L4-07", "NP-L4-06", "KN-L4-07", "AN-L4-06", "HN-L4-06", "FTL-L4-06", "DY-L4-06", "AB-L4-06"],
      notes: "출구형 변비·IBS엔 15~20cm 배변 발판 + 골반저 이완 호기 배변 + 5~10분 이내 제한.",
      updated: "2026-11-19",
    },
    {
      id: "SK-008",
      category: "도침·침도",
      name: "견봉하 · 요추 인대 · 슬개지대 · 상과/드퀘르뱅/A1 도르래 미세 박리",
      level: 1,
      count: 2,
      linkedNodes: ["SH-L4-05", "LBP-L4-05", "KN-L4-05", "EL-L4-05"],
      notes: "Lv.1 — 초음파 가이드/골면 접촉 필수. L1~L3 횡돌기 전방 신장/후복막 대혈관 손상 절대 주의.",
      updated: "2026-11-19",
    },
  ];

  const DEFAULT_ROUTINES = [
    {
      id: "RT-01",
      symptom: "HA",
      name: "경추성 두통 루틴 (전침 + 추나 + 한약 + 목보호 티칭)",
      path: ["HA-L0-02", "HA-L1-01", "HA-L1-03", "HA-L2-01", "HA-L3-01", "HA-L4-02", "HA-L4-04", "HA-L4-05", "HA-L4-09"],
      orderMemo: "[전침] 풍지-천주 2Hz 20분 + [추나] C0-C1 견인·후두하근 이완 + [한약] 청상견통탕/갈근탕 + [티칭] 베개 6~8cm & 온찜질",
    },
    {
      id: "RT-02",
      symptom: "HA",
      name: "긴장형 두통 루틴 (득기 침 + 전침 + 한약 + 자세 티칭)",
      path: ["HA-L0-04", "HA-L1-01", "HA-L1-06", "HA-L2-02", "HA-L3-02", "HA-L4-01", "HA-L4-02", "HA-L4-05", "HA-L4-08"],
      orderMemo: "[침] 풍지·태양·백회·합곡·태충 득기 30분 + [전침] 승모근/후두하근 2Hz + [한약] 소요산가감 + [티칭] Chin-Tuck & 테니스공 이완",
    },
    {
      id: "RT-03",
      symptom: "HA",
      name: "편두통·MOH 루틴 (표적 침 + 변증 한약 + GDR/HRV + SEEDS)",
      path: ["HA-L0-03", "HA-L1-01", "HA-L1-04", "HA-L2-03", "HA-L3-03", "HA-L4-01", "HA-L4-05", "HA-L4-06", "HA-L4-07"],
      orderMemo: "[침] 태양-솔곡 수평자침·족임읍·외관 + [한약] 천마구등음/천궁차조산 + [재활] HRV 호흡 + [티칭] SEEDS & 진통제 테이퍼링",
    },
    {
      id: "RT-04",
      symptom: "DZ",
      name: "이석증 (BPPV) 루틴 (이석정복 + 와위 침 + 한약 + 비타민D)",
      path: ["DZ-L0-02", "DZ-L1-01", "DZ-L1-02", "DZ-L2-01", "DZ-L3-01", "DZ-L4-01", "DZ-L4-02", "DZ-L4-06", "DZ-L4-07"],
      orderMemo: "[수기] Epley(단계별 60초 정지) + [침] 와위 예풍·풍지·내관 + [한약] 잔여 멍함에 반하백출천마탕 3~5일분 + [티칭] 전정억제제 중단·비타민D",
    },
    {
      id: "RT-05",
      symptom: "DZ",
      name: "전정신경염 루틴 (HINTS+ → 와위 침 + 한약 + 전정재활)",
      path: ["DZ-L0-03", "DZ-L1-01", "DZ-L1-03", "DZ-L2-02", "DZ-L3-02", "DZ-L4-02", "DZ-L4-06", "DZ-L4-08"],
      orderMemo: "[침] 와위 예풍·풍지·내관·족삼리 + [한약] 반하백출천마탕/건비이사탕 + [티칭] 시선고정 고개회전 전정재활운동",
    },
    {
      id: "RT-06",
      symptom: "DZ",
      name: "경추성 어지럼 루틴 (전침 + 후두하근 추나 + 한약 + 안전티칭)",
      path: ["DZ-L0-05", "DZ-L1-01", "DZ-L1-04", "DZ-L2-03", "DZ-L3-04", "DZ-L4-03", "DZ-L4-05", "DZ-L4-06", "DZ-L4-10"],
      orderMemo: "[전침] 풍지-천주 2Hz + [추나] 후두하근 억제 & C0-C1 가동(HVLA 금지) + [한약] 반하백출천마탕 + [티칭] 5D-3N 경고·기립주의",
    },
    {
      id: "RT-07",
      symptom: "SH",
      name: "오십견 루틴 (전침·침 + 견관절 추나 + 서근탕 + 스트레칭)",
      path: ["SH-L0-02", "SH-L1-01", "SH-L1-02", "SH-L2-01", "SH-L3-01", "SH-L4-01", "SH-L4-03", "SH-L4-04", "SH-L4-06"],
      orderMemo: "[전침] 견우-견료 2Hz + [추나] 견관절 가동술 + [한약] 서근탕/양화이사탕 + [티칭] 시계추 운동 & 베개 받치기",
    },
    {
      id: "RT-08",
      symptom: "LBP",
      name: "요추 디스크·좌골신경통 루틴 (심부침 + 신바로약침 + Cox + 독활기생탕)",
      path: ["LBP-L0-02", "LBP-L1-01", "LBP-L1-02", "LBP-L2-01", "LBP-L3-01", "LBP-L4-01", "LBP-L4-03", "LBP-L4-04", "LBP-L4-06", "LBP-L4-08"],
      orderMemo: "[침] 협척·BL23·BL25·GB30 + [약침] 신바로 L4-5/L5-S1 + [추나] Cox 굴곡신연(HVLA 금지) + [한약] 독활기생탕 + [티칭] 맥켄지 중심화 & 기상1h 굴곡금지",
    },
    {
      id: "RT-09",
      symptom: "LBP",
      name: "척추관 협착증 루틴 (2Hz 심자 전침 + 자하거·신바로 + Cox + 굴곡티칭)",
      path: ["LBP-L0-03", "LBP-L1-01", "LBP-L1-03", "LBP-L2-02", "LBP-L3-02", "LBP-L4-02", "LBP-L4-03", "LBP-L4-04", "LBP-L4-06", "LBP-L4-10"],
      orderMemo: "[전침] BL25-L4협척-BL32 2Hz 30분(Ann Intern Med RCT) + [약침] 신바로/자하거 + [추나] Cox + [한약] 독활기생탕/삼기음 + [티칭] 전굴 휴식·신전 금지",
    },
    {
      id: "RT-10",
      symptom: "LBP",
      name: "비특이·만성 요통 루틴 (침 + QL/장요근 MFR + WalkBack·Big 3)",
      path: ["LBP-L0-06", "LBP-L1-01", "LBP-L1-06", "LBP-L2-05", "LBP-L3-05", "LBP-L4-01", "LBP-L4-04", "LBP-L4-06", "LBP-L4-07", "LBP-L4-09"],
      orderMemo: "[침] 협척·QL·BL40 + [추나] 측와위 장요근/QL MFR + [한약] 오적산/당귀수산 + [재활] WalkBack & McGill Big 3 + [티칭] 활동 유지·진통제 3단계 감량",
    },
    {
      id: "RT-11",
      symptom: "NP",
      name: "급성 낙침 루틴 (후계 동기침 + 건측 MFR + 회수산/갈근탕 + 베개 티칭)",
      path: ["NP-L0-02", "NP-L1-01", "NP-L1-02", "NP-L2-01", "NP-L3-01", "NP-L4-01", "NP-L4-04", "NP-L4-05", "NP-L4-07"],
      orderMemo: "[침] 후계·낙침혈 동적 자침 + 건측 견갑거근/SCM + [추나] 건측 이완(HVLA 금지) + [한약] 회수산/갈근탕 + [티칭] 베개 6~8cm & 칼라 금지",
    },
    {
      id: "RT-12",
      symptom: "NP",
      name: "목디스크·신경근병증 루틴 (C5-7 협척 전침 + 신바로 + 부드러운 신연)",
      path: ["NP-L0-03", "NP-L1-01", "NP-L1-03", "NP-L2-02", "NP-L3-02", "NP-L4-01", "NP-L4-02", "NP-L4-03", "NP-L4-04", "NP-L4-08"],
      orderMemo: "[침·전침] C5-7 협척 2Hz + [약침] 신바로 후관절 + [추나] 중립 부드러운 축성 신연(척수증 배제 필수) + [티칭] Bakody·눈높이 교정",
    },
    {
      id: "RT-13",
      symptom: "NP",
      name: "거북목·편타 회복 루틴 (흉추 가동 + CCFT/Chin-Tuck + 갈근탕/당귀수산)",
      path: ["NP-L0-06", "NP-L1-01", "NP-L1-06", "NP-L2-05", "NP-L3-05", "NP-L4-01", "NP-L4-04", "NP-L4-05", "NP-L4-06", "NP-L4-10"],
      orderMemo: "[추나] 흉추 T1-4 가동 & 후두하근 이완 + [한약] 갈근탕/당귀수산 + [재활] Chin-Tuck(CCFT) + [티칭] 셀프 목 꺾기 금지·척수증 경고",
    },
    {
      id: "RT-14",
      symptom: "KN",
      name: "퇴행성 슬관절염 루틴 (혈해-양구 전침 + 신바로 + 독활기생탕 + 10%감량·운동)",
      path: ["KN-L0-02", "KN-L1-01", "KN-L1-02", "KN-L2-01", "KN-L3-01", "KN-L4-02", "KN-L4-03", "KN-L4-06", "KN-L4-07", "KN-L4-08"],
      orderMemo: "[전침] 혈해-양구 2Hz + [약침] 신바로 슬관절 + [한약] 독활기생탕/방기황기탕 + [재활] VMO/태극권 + [티칭] 초기 2~4주 적응통 & 체중 10% 감량",
    },
    {
      id: "RT-15",
      symptom: "KN",
      name: "퇴행성 반월판 파열 루틴 (독비·내슬안 침 + 신바로 + 장축견인 + 풀스쿼트금지)",
      path: ["KN-L0-03", "KN-L1-01", "KN-L1-03", "KN-L2-02", "KN-L3-02", "KN-L4-01", "KN-L4-03", "KN-L4-04", "KN-L4-06", "KN-L4-09"],
      orderMemo: "[침] 독비·내슬안 심부 사자 + [약침] 신바로 + [추나] 20~30° 부드러운 장축 견인(잠김 금기) + [한약] 독활기생탕 + [티칭] 비수술 표준 & 풀스쿼트 금지",
    },
    {
      id: "RT-16",
      symptom: "KN",
      name: "슬개대퇴(PFPS)·거위발 루틴 (침 + 슬개골 내측 가동 + 중둔근·VMO + 베개티칭)",
      path: ["KN-L0-04", "KN-L1-01", "KN-L1-04", "KN-L2-03", "KN-L3-03", "KN-L4-01", "KN-L4-02", "KN-L4-04", "KN-L4-07", "KN-L4-09"],
      orderMemo: "[침·전침] 혈해-양구 2Hz + [추나] 슬개골 내측 가동 & 외측지대 MFR + [재활] 중둔근/VMO(0~45°) + [티칭] 맥코넬 테이핑 & 계단 보행 요령",
    },
    {
      id: "RT-17",
      symptom: "AN",
      name: "급성 외측 발목 염좌 루틴 (구허·신맥 침 + 중성어혈 + 당귀수산·오령산 + 보조기)",
      path: ["AN-L0-02", "AN-L1-01", "AN-L1-02", "AN-L2-01", "AN-L3-01", "AN-L4-01", "AN-L4-03", "AN-L4-05", "AN-L4-07", "AN-L4-10"],
      orderMemo: "[침] 구허·신맥·곤륜 + [약침] 중성어혈/황련해독 + [한약] 당귀수산+오령산(부종절반) + [티칭] 초기 온찜질 금지·보조기 & 4~5일 지연 진찰",
    },
    {
      id: "RT-18",
      symptom: "AN",
      name: "만성 발목 불안정증(CAI) 루틴 (거골 후방활주 + 자하거 약침 + SEBT·비골근 재활)",
      path: ["AN-L0-04", "AN-L1-01", "AN-L1-04", "AN-L2-03", "AN-L3-03", "AN-L4-01", "AN-L4-03", "AN-L4-04", "AN-L4-06", "AN-L4-09"],
      orderMemo: "[추나] 거골 후내측 활주(족배굴곡 회복) + [약침] 자하거/녹용 인대 증식 + [재활] SEBT·한발서기·비골근 외번 + [티칭] 하이힐/굽 마모 신발 금지",
    },
    {
      id: "RT-19",
      symptom: "AN",
      name: "아킬레스건병증 루틴 (건 주위 전침 + 약침 + Alfredson 편심성 + 위치별 티칭)",
      path: ["AN-L0-05", "AN-L1-01", "AN-L1-05", "AN-L2-04", "AN-L3-04", "AN-L4-01", "AN-L4-02", "AN-L4-03", "AN-L4-06", "AN-L4-08"],
      orderMemo: "[침·전침] 태계·곤륜·승산-합양 2Hz(건 실질 금지) + [약침] 건 주변 자하거/신바로 + [재활] Alfredson 편심성 + [티칭] 삽입부 스트레칭 금지(평지까지)",
    },
    {
      id: "RT-20",
      symptom: "EL",
      name: "외측상과염(테니스 엘보) 루틴 (곡지-수삼리 전침 + Mulligan MWM + 편심성 티칭)",
      path: ["EL-L0-02", "EL-L1-01", "EL-L1-02", "EL-L2-01", "EL-L3-01", "EL-L4-01", "EL-L4-02", "EL-L4-03", "EL-L4-04", "EL-L4-07"],
      orderMemo: "[침·전침] 곡지-수삼리 2Hz + [약침] 신바로(스테로이드 2주 유예) + [추나] Mulligan MWM(BMJ 2006) + [티칭] 손바닥 위로 들기·편심성·주사 재발 경고",
    },
    {
      id: "RT-21",
      symptom: "EL",
      name: "드퀘르뱅 증후군 루틴 (양계·열결 침 + 안전 약침 + 엄지 스파이카·육아 티칭)",
      path: ["EL-L0-04", "EL-L1-01", "EL-L1-04", "EL-L2-03", "EL-L3-03", "EL-L4-01", "EL-L4-03", "EL-L4-06", "EL-L4-08"],
      orderMemo: "[침] 양계·열결 + [약침] 신바로(수유모 안전 대안) + [한약] 서경탕/당귀점통탕 + [티칭] 자가 꺾기 금지·엄지 스파이카·팔뚝 육아 자세",
    },
    {
      id: "RT-22",
      symptom: "EL",
      name: "TFCC · 수근관 · 방아쇠 수지 루틴 (양곡/내관 + 가동추나 + 야간 중립 부목)",
      path: ["EL-L0-05", "EL-L1-01", "EL-L1-05", "EL-L2-04", "EL-L3-04", "EL-L4-01", "EL-L4-03", "EL-L4-04", "EL-L4-06", "EL-L4-09"],
      orderMemo: "[침·약침] 양곡·양지·Fovea 자하거/봉약침 + [추나] DRUJ·수근골 가동 + [한약] 서경탕/오령산 + [티칭] 바닥 짚기 금지·야간 중립 부목",
    },
    {
      id: "RT-23",
      symptom: "HN",
      name: "수근관 증후군(CTS) 루틴 (내관 사자 + 신바로 + 신경활주 + 야간 0° 부목)",
      path: ["HN-L0-02", "HN-L1-01", "HN-L1-02", "HN-L2-01", "HN-L3-01", "HN-L4-01", "HN-L4-03", "HN-L4-04", "HN-L4-06", "HN-L4-09"],
      orderMemo: "[침] 내관·대릉 사자 + [약침] 수근관 주위 신바로(신경 내 금지) + [추나·재활] 정중신경 슬라이더 + [티칭] 야간 0° 부목 & 악력기 금지",
    },
    {
      id: "RT-24",
      symptom: "HN",
      name: "당뇨병성 다발신경병증(DSPN) 루틴 (팔풍-삼음교 2Hz + 황기계지오물탕 + 족부/B12 티칭)",
      path: ["HN-L0-05", "HN-L1-01", "HN-L1-05", "HN-L2-04", "HN-L3-04", "HN-L4-01", "HN-L4-02", "HN-L4-05", "HN-L4-07", "HN-L4-08"],
      orderMemo: "[침·전침] 족삼리-삼음교 2Hz(뜸·사혈 금지) + [한약] 황기계지오물탕/보양환오탕 + [티칭] 혈당·B12 선별 & 뜨거운 족욕·맨발 절대 금지",
    },
    {
      id: "RT-25",
      symptom: "HN",
      name: "주관절 터널(4·5지) 루틴 (소해 침 + 척골신경 슬라이더 + 팔꿈치 90°↓ 수면 티칭)",
      path: ["HN-L0-03", "HN-L1-01", "HN-L1-03", "HN-L2-02", "HN-L3-02", "HN-L4-01", "HN-L4-04", "HN-L4-05", "HN-L4-09"],
      orderMemo: "[침] 소해·후계 사자(척골신경 직자 회피) + [추나] 척골신경 슬라이더 + [한약] 황기계지오물탕 + [티칭] 수면 시 수건 부목(90°↓)",
    },
    {
      id: "RT-26",
      symptom: "FTL",
      name: "족저근막염 루틴 (승산·태계·신바로 + Low-Dye + Rathleff 로딩)",
      path: ["FTL-L0-02", "FTL-L1-01", "FTL-L1-02", "FTL-L2-01", "FTL-L3-01", "FTL-L4-01", "FTL-L4-03", "FTL-L4-04", "FTL-L4-06", "FTL-L4-07"],
      orderMemo: "[침·전침] 승산-곤륜·종골 내측 사자 + [약침] 신바로 내측결절 + [추나/테이핑] 거골 활주 + Low-Dye + [재활/티칭] 기상 전 스트레칭 & Rathleff",
    },
    {
      id: "RT-27",
      symptom: "FTL",
      name: "아킬레스건병증 루틴 (Thompson 배제 → 2/100Hz 전침 + 건주위 약침 + Alfredson)",
      path: ["FTL-L0-03", "FTL-L1-01", "FTL-L1-03", "FTL-L2-02", "FTL-L3-02", "FTL-L4-02", "FTL-L4-03", "FTL-L4-05", "FTL-L4-06", "FTL-L4-09"],
      orderMemo: "[전침] 승산-곤륜 2/100Hz + [약침] 신바로 건주위(건내 금기) + [한약] 독활기생탕 + [재활/티칭] Alfredson(부착부 과배굴 금기) & 6~12주 타임라인",
    },
    {
      id: "RT-28",
      symptom: "FTL",
      name: "족근관 증후군 루틴 (태계-조해 2Hz + 경골신경 슬라이더 + 당뇨 LOPS 감별)",
      path: ["FTL-L0-05", "FTL-L1-01", "FTL-L1-05", "FTL-L2-04", "FTL-L3-04", "FTL-L4-01", "FTL-L4-02", "FTL-L4-04", "FTL-L4-05", "FTL-L4-08"],
      orderMemo: "[침·전침] 태계-조해 2Hz(LOPS 시 뜸·과전류 금지) + [추나] 경골신경 슬라이더 + 아치 지지 + [한약] 당귀사역탕/방기황기탕",
    },
    {
      id: "RT-29",
      symptom: "DY",
      name: "식후고통(PDS)·급체 루틴 (중완·족삼리·내관 + T6-10 + 평위산/육군자탕)",
      path: ["DY-L0-02", "DY-L1-01", "DY-L1-02", "DY-L2-01", "DY-L3-01", "DY-L4-01", "DY-L4-02", "DY-L4-05", "DY-L4-06", "DY-L4-07"],
      orderMemo: "[침·전침] 중완·족삼리-상거허·내관 2Hz + T6-10 협척 + [한약] 평위산(트림)·보화환(급체)·육군자탕(기허) + [티칭] 소량 꼭꼭 씹기·식후 산책",
    },
    {
      id: "RT-30",
      symptom: "DY",
      name: "역류성 식도질환(GERD)·매핵기 루틴 (T3-7 약침 + 흉추/횡격막 추나 + 오패산·반하후박탕)",
      path: ["DY-L0-04", "DY-L1-01", "DY-L1-04", "DY-L2-03", "DY-L3-03", "DY-L4-01", "DY-L4-03", "DY-L4-04", "DY-L4-05", "DY-L4-06", "DY-L4-07"],
      orderMemo: "[약침·추나] T3-T7 협척(기흉주의) & 흉추신전·횡격막·SCM 이완 + [한약] 오패산·반하후박탕 + [티칭] 식후 3h 직립·상체 15cm 거상·좌측와위",
    },
    {
      id: "RT-31",
      symptom: "DY",
      name: "속쓰림·EPS·약인성 위염 루틴 (약물3축/내시경 → 반하사심탕 + PPI 테이퍼링 티칭)",
      path: ["DY-L0-03", "DY-L1-01", "DY-L1-03", "DY-L2-02", "DY-L2-05", "DY-L3-02", "DY-L4-01", "DY-L4-05", "DY-L4-08", "DY-L4-09"],
      orderMemo: "[검사] Carnett 복벽배제 & NSAIDs+SSRI/항응고 점검 + [한약] 반하사심탕·오패산 + [티칭] 40세↑ 내시경·고위험 PPI 유지 vs 단순 반동 테이퍼링",
    },
    {
      id: "RT-32",
      symptom: "AB",
      name: "과민성 장 증후군(IBS-D/SIBO) 루틴 (천추·상거허 + 통사요방/삼령백출산 + 저FODMAP)",
      path: ["AB-L0-02", "AB-L1-01", "AB-L1-02", "AB-L2-01", "AB-L3-01", "AB-L4-01", "AB-L4-02", "AB-L4-05", "AB-L4-07"],
      orderMemo: "[침·전침] 천추·상거허·족삼리·태충 2Hz + [한약] 통사요방(간비부조)/삼령백출산(SIBO 후박가미) + [티칭] 3단계 저FODMAP & 예기불안 완화",
    },
    {
      id: "RT-33",
      symptom: "AB",
      name: "만성 기능성/출구형 변비 루틴 (천추-복결 2/10Hz 전침 + 팔료혈 + 대건중탕·발판자세)",
      path: ["AB-L0-03", "AB-L1-01", "AB-L1-03", "AB-L2-02", "AB-L3-02", "AB-L4-01", "AB-L4-02", "AB-L4-03", "AB-L4-04", "AB-L4-05", "AB-L4-06", "AB-L4-08"],
      orderMemo: "[전침] 천추-복결 2/10Hz(Liu 2016) + [약침/추나] 팔료혈·장요근·시계방향 대장유동 + [한약/재활] 대건중탕/마자인환 + 배변 발판 15~20cm",
    },
    {
      id: "RT-34",
      symptom: "AB",
      name: "급성 위장관염 루틴 (탈수/이질 배제 → 곽향정기산 + 천추·족삼리 + ORS/지사제 금기)",
      path: ["AB-L0-05", "AB-L1-01", "AB-L1-05", "AB-L2-04", "AB-L3-03", "AB-L4-01", "AB-L4-05", "AB-L4-09"],
      orderMemo: "[검사] 활력징후/탈수·C.diff/충수염 배제 + [침/한약] 천추·족삼리 + 곽향정기산 3~5일 + [티칭] 전해질 ORS & 발열/혈변 시 지사제 절대 금기",
    },
  ];

  // 상태 변수
  let baseTreeData = null;
  let mergedTreeData = null;
  let customNodesList = [];
  let skillsList = [];
  let routinesList = [];
  let casesList = [];

  let currentMode = "home";
  let currentSubview = "builder";
  let activeSymptomCode = "HA";
  let activeNodeId = "HA-L0-01";
  let currentPath = ["HA-L0-01"];
  let pathDecisions = {}; // { fromNodeId: "예" }

  // 루틴 덱 빌더에서 현재 슬롯에 담아둔 카드 ID 배열
  let builderDeckSlots = [];
  // 스킬 도감 필터 상태
  let skillFilterSymptom = "ALL";
  let skillFilterType = "all";

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

  function linkifyCitationsHtml(str) {
    const escaped = escapeHtml(str);
    // PMID: 30587518 또는 PMID: 30587518, 24065011 형태를 모두 클릭 가능한 PubMed 링크 배지로 변환
    return escaped.replace(/PMID\s*:?\s*(\d{5,9}(?:\s*[,/]\s*\d{5,9})*)/gi, (_full, group) => {
      const nums = String(group)
        .split(/[,/]/)
        .map((x) => x.trim())
        .filter((x) => /^\d{5,9}$/.test(x));
      if (nums.length === 0) return _full;
      return nums
        .map(
          (num) =>
            `<a href="https://pubmed.ncbi.nlm.nih.gov/${num}/" target="_blank" rel="noopener noreferrer" class="pmid-link" onclick="event.stopPropagation()" title="PubMed 논문 원문 열기 (PMID: ${num})">🔗 PMID: ${num} ↗</a>`
        )
        .join(" ");
    });
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

  function isNodePresentInMergedTree(nid) {
    if (!mergedTreeData || !mergedTreeData["증상"]) return true;
    const sc = getNodeSymptomCode(nid);
    const sym = mergedTreeData["증상"][sc];
    return Boolean(sym && sym.nodes && sym.nodes[nid]);
  }

  function getActiveLinkedNodeIds(skillObj) {
    return (skillObj.linkedNodes || []).filter((nid) => isNodePresentInMergedTree(nid));
  }

  function getAvailableRoutines() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return routinesList;
    const symptoms = mergedTreeData["증상"];
    return routinesList.filter((rt) => {
      const sym = symptoms[rt.symptom];
      if (!sym || !sym.nodes) return false;
      const path = rt.path || [];
      return path.length === 0 || path.some((nid) => Boolean(sym.nodes[nid]));
    });
  }

  function getProtocolSkillCards(symFilter = "ALL", typeFilter = "all") {
    if (!mergedTreeData || !mergedTreeData["증상"]) return [];
    const targetTypes =
      typeFilter === "all" ? new Set(["treat", "test", "teach"]) : new Set([typeFilter]);
    const protoCards = [];
    Object.entries(mergedTreeData["증상"]).forEach(([symCode, symObj]) => {
      if (symFilter !== "ALL" && symFilter !== symCode) return;
      Object.values(symObj.nodes || {})
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((node) => {
          if (targetTypes.has(node["유형"])) {
            protoCards.push({ symCode, symName: symObj.name, node });
          }
        });
    });
    return protoCards;
  }

  function updateBadges() {
    const skEl = document.getElementById("nav-skill-count");
    const csEl = document.getElementById("nav-case-count");
    const cuEl = document.getElementById("nav-custom-count");
    const rtEl = document.getElementById("badge-routine-count");
    const hRtEl = document.getElementById("header-routine-count");
    const mgrRtEl = document.getElementById("routine-manager-count");
    const badgeCu = document.getElementById("custom-node-badge-count");

    const availableRoutines = getAvailableRoutines();
    const totalProtoSkills = getProtocolSkillCards("ALL", "all").length;
    const totalSkillTabCount = skillsList.length + totalProtoSkills;

    if (skEl) {
      skEl.textContent = String(totalSkillTabCount);
      skEl.title = `공용 술기 ${skillsList.length}개 + 프로토콜 카드 ${totalProtoSkills}장`;
    }
    if (csEl) csEl.textContent = String(casesList.length);
    if (cuEl) cuEl.textContent = String(customNodesList.length);
    if (rtEl) rtEl.textContent = String(availableRoutines.length);
    if (hRtEl) hRtEl.textContent = String(availableRoutines.length);
    if (mgrRtEl) mgrRtEl.textContent = `${availableRoutines.length}개`;
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

  function getEffectiveBranches(node, nodesMap) {
    const branches = extractBranchesList(node);
    if (!node || !String(node.id || "").endsWith("-L1-01")) return branches;
    const startNode = nodesMap && currentPath.length > 0 ? nodesMap[currentPath[0]] : null;
    const recId = startNode && startNode["추천문진"];
    if (!recId || !nodesMap[recId] || recId === node.id) return branches;
    return branches.map((b) =>
      b.label.includes("아니오") ? { label: b.label, targetId: recId } : b
    );
  }

  function isPositiveBranchLabel(label) {
    const s = String(label || "");
    return (
      s.includes("예") ||
      s.includes("양성") ||
      s.includes("수동제한") ||
      s.includes("진료 시작") ||
      s.includes("안전 확인")
    );
  }

  /* ==================== 모드 & 서브탭 전환 (부드러운 모션 적용) ==================== */
  function triggerSmoothEnter(el, clsName = "motion-enter") {
    if (!el) return;
    el.classList.remove(clsName);
    void el.offsetWidth;
    el.classList.add(clsName);
  }

  function recordRecentSymptom(symCode) {
    if (!symCode) return;
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      const prev = raw ? JSON.parse(raw) : [];
      const next = [symCode, ...prev.filter((c) => c !== symCode)].slice(0, 3);
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  function getRecentSymptoms() {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    const btnHome = document.getElementById("btn-mode-home");
    const btnClinic = document.getElementById("btn-mode-clinic");
    const btnSetup = document.getElementById("btn-mode-setup");
    if (btnHome) btnHome.classList.toggle("active", mode === "home");
    if (btnClinic) btnClinic.classList.toggle("active", mode === "clinic");
    if (btnSetup) btnSetup.classList.toggle("active", mode === "setup");

    const homeContainer = document.getElementById("mode-home-container");
    const clinicContainer = document.getElementById("mode-clinic-container");
    const setupContainer = document.getElementById("mode-setup-container");

    if (homeContainer) homeContainer.hidden = mode !== "home";
    if (clinicContainer) clinicContainer.hidden = mode !== "clinic";
    if (setupContainer) setupContainer.hidden = mode !== "setup";

    if (mode === "home") {
      renderHeaderSymptomTabs();
      renderHomeHubMode();
      triggerSmoothEnter(homeContainer);
    } else if (mode === "clinic") {
      renderClinicBoardMode();
      triggerSmoothEnter(clinicContainer);
    } else {
      renderHeaderSymptomTabs();
      populateSymptomSelects();
      switchSetupSubview(currentSubview);
      triggerSmoothEnter(setupContainer);
    }
  }

  function switchSetupSubview(subview) {
    currentSubview = subview;
    document.querySelectorAll(".setup-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-subview") === subview);
    });
    ["builder", "routines", "skills", "evolution"].forEach((sv) => {
      const el = document.getElementById(`subview-${sv}`);
      if (el) {
        el.hidden = sv !== subview;
        if (sv === subview) triggerSmoothEnter(el);
      }
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

  /* ==================== 상단 증상 카테고리 드롭다운 & 모바일 바텀 시트 ==================== */
  function getSymptomCategoryMeta(symCode) {
    const found = SYMPTOM_CATEGORIES.find((cat) => cat.codes.includes(symCode));
    return found || FALLBACK_CATEGORY;
  }

  function groupSymptomsByCategory(symptoms) {
    const buckets = new Map();
    SYMPTOM_CATEGORIES.forEach((cat) => {
      buckets.set(cat.key, { meta: cat, items: [] });
    });
    buckets.set(FALLBACK_CATEGORY.key, { meta: FALLBACK_CATEGORY, items: [] });

    Object.entries(symptoms).forEach(([code, symObj]) => {
      const catMeta = getSymptomCategoryMeta(code);
      const nodeCount = Object.keys(symObj.nodes || {}).length;
      buckets.get(catMeta.key).items.push({ code, symObj, nodeCount });
    });

    // 카테고리 내부는 로드맵 우선순위 순서대로 정렬하고, 비어 있는 카테고리는 제외
    const result = [];
    buckets.forEach((bucket) => {
      if (bucket.items.length === 0) return;
      const orderList = bucket.meta.codes || [];
      bucket.items.sort((a, b) => {
        const ia = orderList.indexOf(a.code);
        const ib = orderList.indexOf(b.code);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.code.localeCompare(b.code);
      });
      result.push(bucket);
    });
    return result;
  }

  function chooseSymptomFromNav(code, targetNodeId) {
    if (currentMode === "home") {
      activeSymptomCode = code;
      switchMode("clinic");
      selectSymptom(code, targetNodeId);
      return;
    }
    selectSymptom(code, targetNodeId);
    if (currentMode === "setup") {
      populateSymptomSelects();
      switchSetupSubview(currentSubview);
    }
  }

  function computeSymptomTypeBreakdown(nodesMap) {
    const counts = {
      total: 0,
      l0: 0,
      ask: 0,
      test: 0,
      dx: 0,
      treat: 0,
      teach: 0,
      outcome: 0,
    };
    Object.values(nodesMap || {}).forEach((n) => {
      counts.total += 1;
      const layer = getLayerFromNodeId(n.id);
      const t = n["유형"] || "ask";
      if (layer === "L0") counts.l0 += 1;
      else if (t === "ask") counts.ask += 1;
      else if (t === "test") counts.test += 1;
      else if (t === "dx") counts.dx += 1;
      else if (t === "treat") counts.treat += 1;
      else if (t === "teach") counts.teach += 1;
      else counts.outcome += 1;
    });
    return counts;
  }

  function renderHomeHubMode() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const symptoms = mergedTreeData["증상"];
    const grouped = groupSymptomsByCategory(symptoms);

    // 1. 전체 카드 유형별 집계
    const globalCounts = {
      symptoms: Object.keys(symptoms).length,
      total: 0,
      l0: 0,
      ask: 0,
      test: 0,
      dx: 0,
      treat: 0,
      teach: 0,
      outcome: 0,
    };
    const perSymptomCounts = {};
    Object.entries(symptoms).forEach(([code, symObj]) => {
      const c = computeSymptomTypeBreakdown(symObj.nodes);
      perSymptomCounts[code] = c;
      globalCounts.total += c.total;
      globalCounts.l0 += c.l0;
      globalCounts.ask += c.ask;
      globalCounts.test += c.test;
      globalCounts.dx += c.dx;
      globalCounts.treat += c.treat;
      globalCounts.teach += c.teach;
      globalCounts.outcome += c.outcome;
    });

    const statsGrid = document.getElementById("home-type-breakdown-grid");
    if (statsGrid) {
      const statSpecs = [
        {
          key: "total",
          badge: "ARCHIVE TOTAL",
          label: "전체 프로토콜 · 카드",
          val: `${globalCounts.symptoms}증상 · ${globalCounts.total}장`,
          sub: `루틴 덱 ${getAvailableRoutines().length}종 · 공용 술기 ${skillsList.length}종`,
          accent: "stat-total",
        },
        {
          key: "l0",
          badge: "L0 · ENTRY",
          label: "🗣️ 환자 호소 양상",
          val: `${globalCounts.l0}장`,
          sub: "주호소 유형별 맞춤 L1 문진 직결",
          accent: "stat-l0",
        },
        {
          key: "ask",
          badge: "L1 · INTERVIEW",
          label: "❓ 분기 문진 · 레드플래그",
          val: `${globalCounts.ask}장`,
          sub: "응급 배제(SNNOOP10·Ottawa 등) 및 감별 질문",
          accent: "stat-ask",
        },
        {
          key: "test",
          badge: "L2 · EXAM",
          label: "🔬 이학적 검사",
          val: `${globalCounts.test}장`,
          sub: "민감도·특이도·LR+ 기반 신체 진찰",
          accent: "stat-test",
        },
        {
          key: "dx",
          badge: "L3 · DIAGNOSIS",
          label: "🩺 감별 진단",
          val: `${globalCounts.dx}장`,
          sub: "확률 증감 소견 및 볼트 질환 노트 연계",
          accent: "stat-dx",
        },
        {
          key: "treat",
          badge: "L4 · TREATMENT",
          label: "💊 치료 술기 모듈",
          val: `${globalCounts.treat}장`,
          sub: "침·전침·약침·추나·한약·재활 원자 카드",
          accent: "stat-treat",
        },
        {
          key: "teach",
          badge: "L4 · PATIENT ED",
          label: "🗣️ 환자 티칭 · 생활지도",
          val: `${globalCounts.teach}장`,
          sub: "24px+ 환자 교육 화면 & 주의사항",
          accent: "stat-teach",
        },
        {
          key: "outcome",
          badge: "L5 · OUTCOME",
          label: "📊 경과 판정 · 전원",
          val: `${globalCounts.outcome}장`,
          sub: "NRS/기능 지표 평가 및 응급 전원 프로토콜",
          accent: "stat-outcome",
        },
      ];

      statsGrid.innerHTML = statSpecs
        .map(
          (st) => `
          <div class="home-stat-card ${st.accent}">
            <div class="hsc-top">
              <span class="hsc-badge">${escapeHtml(st.badge)}</span>
              <span class="hsc-value">${escapeHtml(st.val)}</span>
            </div>
            <div class="hsc-label">${escapeHtml(st.label)}</div>
            <div class="hsc-sub">${escapeHtml(st.sub)}</div>
          </div>
        `
        )
        .join("");
    }

    // 2. 최근 조회한 프로토콜 3개 표시
    const recentInline = document.getElementById("home-recent-inline");
    if (recentInline) {
      const recents = getRecentSymptoms().filter((c) => Boolean(symptoms[c]));
      if (recents.length === 0) {
        recentInline.innerHTML = "";
      } else {
        recentInline.innerHTML =
          `<span class="recent-label">최근 진료:</span>` +
          recents
            .map((code) => {
              const s = symptoms[code];
              return `<button type="button" class="recent-sym-chip" data-recent-sym="${escapeHtml(code)}">
                ${escapeHtml(s.name)} <span>${escapeHtml(code)}</span>
              </button>`;
            })
            .join("");
        recentInline.querySelectorAll(".recent-sym-chip").forEach((btn) => {
          btn.addEventListener("click", () => {
            chooseSymptomFromNav(btn.getAttribute("data-recent-sym"));
          });
        });
      }
    }

    // 3. 카테고리별 증상 프로토콜 디렉터리
    const dirContainer = document.getElementById("home-category-directory");
    if (!dirContainer) return;
    dirContainer.innerHTML = "";

    grouped.forEach(({ meta, items }) => {
      const catTotalCards = items.reduce((acc, it) => acc + it.nodeCount, 0);
      const catBlock = document.createElement("div");
      catBlock.className = "home-cat-block";
      catBlock.innerHTML = `
        <div class="home-cat-header">
          <div class="home-cat-title-wrap">
            <span class="home-cat-icon">${meta.icon}</span>
            <h3 class="home-cat-title">${escapeHtml(meta.label)}</h3>
            <span class="home-cat-meta">${items.length}개 증상 · 총 ${catTotalCards}장</span>
          </div>
        </div>
      `;

      const cardsGrid = document.createElement("div");
      cardsGrid.className = "home-sym-cards-grid";

      items.forEach(({ code, symObj }) => {
        const c = perSymptomCounts[code] || computeSymptomTypeBreakdown(symObj.nodes);
        const l0Nodes = Object.values(symObj.nodes || {})
          .filter((n) => getLayerFromNodeId(n.id) === "L0")
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));

        const l0ListHtml = l0Nodes
          .map((l0) => {
            const recId = l0["추천문진"];
            const recNode = recId && symObj.nodes[recId] ? symObj.nodes[recId] : null;
            const cleanTitle = String(l0["제목"] || "").replace(/^\[호소\]\s*/, "");
            return `
              <button type="button" class="home-l0-entry-btn" data-sym="${escapeHtml(code)}" data-node="${escapeHtml(
              l0.id
            )}" title="${escapeHtml(recNode ? `맞춤 추천문진: ${recId} ${recNode["제목"]}` : l0["제목"])}">
                <span class="hl0-left">
                  <span class="hl0-id">${escapeHtml(l0.id)}</span>
                  <span class="hl0-title">${escapeHtml(cleanTitle)}</span>
                </span>
                ${
                  recId
                    ? `<span class="hl0-rec">🎯 ${escapeHtml(recId)}</span>`
                    : `<span class="hl0-rec">진입 →</span>`
                }
              </button>
            `;
          })
          .join("");

        const symCard = document.createElement("article");
        symCard.className = "home-symptom-card";
        symCard.innerHTML = `
          <div class="hsc-header">
            <div class="hsc-title-group">
              <span class="hsc-code-badge">${escapeHtml(code)}</span>
              <h4 class="hsc-sym-name">${escapeHtml(symObj.name)}</h4>
            </div>
            <button type="button" class="btn-open-sym-board" data-open-sym="${escapeHtml(code)}">
              진료 보드 열기 (${c.total}장) →
            </button>
          </div>

          <!-- 종류별 카드 개수 브레이크다운 -->
          <div class="hsc-type-pills" aria-label="카드 종류별 개수">
            <span class="type-count-pill pill-l0" title="환자 호소 양상 (L0)">🗣️ 호소 <strong>${c.l0}</strong></span>
            <span class="type-count-pill pill-ask" title="분기 문진 (L1)">❓ 문진 <strong>${c.ask}</strong></span>
            <span class="type-count-pill pill-test" title="이학적 검사 (L2)">🔬 검사 <strong>${c.test}</strong></span>
            <span class="type-count-pill pill-dx" title="감별 진단 (L3)">🩺 감별 <strong>${c.dx}</strong></span>
            <span class="type-count-pill pill-treat" title="치료 술기 (L4)">💊 치료 <strong>${c.treat}</strong></span>
            <span class="type-count-pill pill-teach" title="환자 티칭 (L4)">🗣️ 티칭 <strong>${c.teach}</strong></span>
            <span class="type-count-pill pill-outcome" title="경과 판정·전원 (L5)">📊 결과 <strong>${c.outcome}</strong></span>
          </div>

          <!-- 환자 호소 양상(L0) 바로 진입 목록 -->
          <div class="hsc-l0-section">
            <div class="hsc-l0-heading">🗣️ 환자 호소 양상 (클릭 시 해당 호소 맞춤 문진으로 즉시 시작)</div>
            <div class="hsc-l0-list">${l0ListHtml}</div>
          </div>
        `;

        symCard.querySelector(".btn-open-sym-board").addEventListener("click", () => {
          chooseSymptomFromNav(code);
        });
        symCard.querySelectorAll(".home-l0-entry-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            chooseSymptomFromNav(btn.getAttribute("data-sym"), btn.getAttribute("data-node"));
          });
        });

        cardsGrid.appendChild(symCard);
      });

      catBlock.appendChild(cardsGrid);
      dirContainer.appendChild(catBlock);
    });
  }

  function renderHeaderSymptomTabs() {
    if (!mergedTreeData || !mergedTreeData["증상"]) return;
    const symptoms = mergedTreeData["증상"];
    const grouped = groupSymptomsByCategory(symptoms);
    gridEl.innerHTML = "";
    let totalNodes = 0;

    grouped.forEach(({ meta, items }) => {
      items.forEach((it) => {
        totalNodes += it.nodeCount;
      });
      const isCategoryActive = items.some((it) => it.code === activeSymptomCode);

      const groupEl = document.createElement("div");
      groupEl.className = `symptom-cat-group ${isCategoryActive ? "active" : ""}`;
      groupEl.setAttribute("role", "listitem");

      const triggerBtn = document.createElement("button");
      triggerBtn.type = "button";
      triggerBtn.className = `symptom-cat-trigger ${isCategoryActive ? "active" : ""}`;
      triggerBtn.setAttribute("aria-haspopup", "true");
      triggerBtn.setAttribute("aria-expanded", "false");
      triggerBtn.innerHTML = `
        <span>${meta.icon} ${escapeHtml(meta.label)}</span>
        <span class="cat-count">${items.length}</span>
        <span class="cat-caret">▾</span>
      `;
      triggerBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const wasOpen = groupEl.classList.contains("open");
        gridEl.querySelectorAll(".symptom-cat-group.open").forEach((g) => {
          g.classList.remove("open");
          const tb = g.querySelector(".symptom-cat-trigger");
          if (tb) tb.setAttribute("aria-expanded", "false");
        });
        if (!wasOpen) {
          groupEl.classList.add("open");
          triggerBtn.setAttribute("aria-expanded", "true");
        }
      });

      const dropdownEl = document.createElement("div");
      dropdownEl.className = "symptom-cat-dropdown";
      dropdownEl.setAttribute("role", "menu");

      const ddHeader = document.createElement("div");
      ddHeader.className = "cat-dropdown-head";
      ddHeader.textContent = `${meta.icon} ${meta.label} (${items.length}개 프로토콜)`;
      dropdownEl.appendChild(ddHeader);

      const ddList = document.createElement("div");
      ddList.className = "cat-dropdown-list";

      items.forEach(({ code, symObj, nodeCount }) => {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = `cat-dropdown-item ${code === activeSymptomCode ? "active" : ""}`;
        itemBtn.setAttribute("role", "menuitem");
        itemBtn.innerHTML = `
          <span class="cat-item-main">
            <span class="cat-item-name">${escapeHtml(symObj.name)}</span>
            <span class="cat-item-code">${escapeHtml(code)}</span>
          </span>
          <span class="cat-item-count">${nodeCount}카드</span>
        `;
        itemBtn.addEventListener("click", () => {
          groupEl.classList.remove("open");
          triggerBtn.setAttribute("aria-expanded", "false");
          chooseSymptomFromNav(code);
        });
        ddList.appendChild(itemBtn);
      });

      dropdownEl.appendChild(ddList);
      groupEl.appendChild(triggerBtn);
      groupEl.appendChild(dropdownEl);
      gridEl.appendChild(groupEl);
    });

    // 현재 선택된 증상 표시 배지 (데스크톱 헤더용 + 모바일 버튼 라벨 동기화)
    const activeSym = symptoms[activeSymptomCode];
    const activeCat = getSymptomCategoryMeta(activeSymptomCode);
    const activeIndicator = document.getElementById("active-symptom-indicator");
    if (activeIndicator && activeSym) {
      const nCount = Object.keys(activeSym.nodes || {}).length;
      activeIndicator.innerHTML = `
        <span class="active-sym-cat">${activeCat.icon}</span>
        <span class="active-sym-name">${escapeHtml(activeSym.name)}</span>
        <span class="active-sym-code">${escapeHtml(activeSymptomCode)} · ${nCount}</span>
      `;
    }

    const mobileLabel = document.getElementById("mobile-symptom-picker-label");
    if (mobileLabel && activeSym) {
      const nCount = Object.keys(activeSym.nodes || {}).length;
      mobileLabel.innerHTML = `${activeCat.icon} <strong>${escapeHtml(activeSym.name)}</strong> <span class="mobile-picker-code">${escapeHtml(activeSymptomCode)} · ${nCount}카드</span>`;
    }

    const sheetBackdrop = document.getElementById("mobile-symptom-sheet-backdrop");
    if (sheetBackdrop && !sheetBackdrop.hidden) {
      const sheetSearch = document.getElementById("mobile-sheet-search");
      renderMobileSymptomSheet(sheetSearch ? sheetSearch.value : "");
    }

    if (statsEl) statsEl.textContent = `증상 ${Object.keys(symptoms).length} · 카드 ${totalNodes}`;
  }

  function openMobileSymptomSheet() {
    const backdrop = document.getElementById("mobile-symptom-sheet-backdrop");
    const pickerBtn = document.getElementById("mobile-symptom-picker-btn");
    const searchInputEl = document.getElementById("mobile-sheet-search");
    if (!backdrop) return;
    if (searchInputEl) searchInputEl.value = "";
    renderMobileSymptomSheet("");
    backdrop.hidden = false;
    if (pickerBtn) pickerBtn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeMobileSymptomSheet() {
    const backdrop = document.getElementById("mobile-symptom-sheet-backdrop");
    const pickerBtn = document.getElementById("mobile-symptom-picker-btn");
    if (!backdrop) return;
    backdrop.hidden = true;
    if (pickerBtn) pickerBtn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  function renderMobileSymptomSheet(filterQuery) {
    const bodyEl = document.getElementById("mobile-sheet-body");
    if (!bodyEl || !mergedTreeData || !mergedTreeData["증상"]) return;

    const q = (filterQuery || "").trim().toLowerCase();
    const grouped = groupSymptomsByCategory(mergedTreeData["증상"]);
    bodyEl.innerHTML = "";
    let renderedCount = 0;

    grouped.forEach(({ meta, items }) => {
      const filteredItems = items.filter(({ code, symObj }) => {
        if (!q) return true;
        return (
          code.toLowerCase().includes(q) ||
          symObj.name.toLowerCase().includes(q) ||
          meta.label.toLowerCase().includes(q)
        );
      });
      if (filteredItems.length === 0) return;
      renderedCount += filteredItems.length;

      const secEl = document.createElement("section");
      secEl.className = "mobile-sheet-section";
      secEl.innerHTML = `
        <h3 class="mobile-sheet-cat-title">${meta.icon} ${escapeHtml(meta.label)} <span>(${filteredItems.length})</span></h3>
      `;

      const grid = document.createElement("div");
      grid.className = "mobile-sheet-grid";

      filteredItems.forEach(({ code, symObj, nodeCount }) => {
        const cardBtn = document.createElement("button");
        cardBtn.type = "button";
        cardBtn.className = `mobile-sheet-card ${code === activeSymptomCode ? "active" : ""}`;
        cardBtn.innerHTML = `
          <span class="ms-card-name">${escapeHtml(symObj.name)}</span>
          <span class="ms-card-meta">${escapeHtml(code)} · ${nodeCount}카드</span>
        `;
        cardBtn.addEventListener("click", () => {
          closeMobileSymptomSheet();
          chooseSymptomFromNav(code);
        });
        grid.appendChild(cardBtn);
      });

      secEl.appendChild(grid);
      bodyEl.appendChild(secEl);
    });

    if (renderedCount === 0) {
      bodyEl.innerHTML = `<p class="mobile-sheet-empty">일치하는 증상 프로토콜이 없습니다.</p>`;
    }
  }

  function renderRoutineDrawerCards() {
    const container = document.getElementById("clinic-routine-pills");
    if (!container) return;

    const availableRoutines = getAvailableRoutines();
    container.innerHTML = "";
    if (availableRoutines.length === 0) {
      container.innerHTML = "<p style='color:#94a3b8; font-size:0.84rem;'>저장된 루틴 덱이 없습니다.</p>";
      return;
    }

    availableRoutines.forEach((rt) => {
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
    recordRecentSymptom(symCode);
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
    // 현재 선택된 L0의 추천문진 단축 경로(L0 -> L1-01 -> 추천문진) 우선 반영
    const l0Node = nodesMap[entryId];
    const sc = getNodeSymptomCode(targetId || entryId);
    const l1RedflagId = `${sc}-L1-01`;
    if (l0Node && l0Node["추천문진"] === targetId && nodesMap[l1RedflagId] && targetId !== l1RedflagId) {
      return [entryId, l1RedflagId, targetId];
    }

    // 부모 링크 역추적으로 진입점부터 targetId까지의 경로를 찾는다
    const parentChain = [];
    let cur = targetId;
    const visited = new Set();
    while (cur && nodesMap[cur] && !visited.has(cur)) {
      visited.add(cur);
      if (getLayerFromNodeId(cur) === "L0") {
        parentChain.unshift(cur === entryId ? cur : entryId);
        break;
      }
      parentChain.unshift(cur);
      if (cur === entryId) break;
      if (l0Node && l0Node["추천문진"] === cur && nodesMap[l1RedflagId] && cur !== l1RedflagId) {
        parentChain.unshift(l1RedflagId);
        parentChain.unshift(entryId);
        break;
      }
      cur = nodesMap[cur]["상위"];
    }
    if (parentChain[0] !== entryId && nodesMap[entryId]) {
      if (getLayerFromNodeId(parentChain[0]) === "L0") {
        parentChain[0] = entryId;
      } else {
        parentChain.unshift(entryId);
      }
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
    syncMobileLayerJump();

    // 레이아웃 렌더링 직후 SVG 가지 연결선 그리기
    requestAnimationFrame(() => {
      drawSvgBranchLines(nodesMap);
    });
  }

  function syncMobileLayerJump() {
    const jumpBar = document.getElementById("mobile-layer-jump");
    if (!jumpBar) return;
    const activeLayer = getLayerFromNodeId(activeNodeId);
    jumpBar.querySelectorAll(".layer-jump-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-jump-layer") === activeLayer);
    });
  }

  function scrollBoardToLayer(layerKey) {
    const viewport = document.getElementById("board-scroll-viewport");
    const colEl = treeColumnsEl ? treeColumnsEl.querySelector(`.layer-column[data-layer="${layerKey}"]`) : null;
    if (!viewport || !colEl) return;
    viewport.scrollTo({
      left: Math.max(0, colEl.offsetLeft - 8),
      behavior: "smooth",
    });
  }

  function renderComboTrailBar(nodesMap) {
    pathwayChips.innerHTML = "";
    const comboBtn = document.getElementById("btn-copy-combo-orders");
    const treatCount = currentPath.filter((id) => nodesMap[id] && nodesMap[id]["유형"] === "treat").length;
    if (comboBtn) {
      comboBtn.hidden = treatCount === 0;
      comboBtn.textContent = `📋 선택 치료 콤보(${treatCount}종) 전체 복사`;
    }

    const layerShortTitle = {
      L0: "L0 호소",
      L1: "L1 문진",
      L2: "L2 검사",
      L3: "L3 진단",
      L4: "L4 처치",
      L5: "L5 경과",
    };

    const visitedLayers = new Set();

    currentPath.forEach((nid, idx) => {
      const node = nodesMap[nid];
      if (!node) return;
      const layer = getLayerFromNodeId(nid);
      visitedLayers.add(layer);

      if (idx > 0) {
        const prevId = currentPath[idx - 1];
        const dec = pathDecisions[prevId];
        const conn = document.createElement("span");
        const isPos = dec ? isPositiveBranchLabel(dec) : false;
        conn.className = `stepper-connector ${dec ? (isPos ? "conn-yes" : "conn-no") : ""}`;
        let shortDec = dec || "";
        if (shortDec.includes("안전 확인")) shortDec = "안전확인";
        else if (shortDec.length > 8) shortDec = shortDec.slice(0, 8) + "…";
        conn.innerHTML = shortDec
          ? `<span class="conn-dec-pill">${escapeHtml(shortDec)}</span><span class="conn-chevron">›</span>`
          : `<span class="conn-chevron">›</span>`;
        pathwayChips.appendChild(conn);
      }

      const stepBtn = document.createElement("button");
      stepBtn.type = "button";
      const isRF = node["레드플래그"] === true;
      const isActive = nid === activeNodeId;
      const ntype = node["유형"] || "ask";
      const cleanTitle = String(node["제목"] || "").replace(/^\[호소\]\s*/, "");

      stepBtn.className = [
        "stepper-node-card",
        `step-layer-${layer.toLowerCase()}`,
        `step-type-${ntype}`,
        isActive ? "active" : "",
        isRF ? "redflag" : "",
      ]
        .filter(Boolean)
        .join(" ");

      stepBtn.innerHTML = `
        <span class="step-layer-tag">${escapeHtml(layerShortTitle[layer] || layer)}</span>
        <span class="step-main-text">
          <span class="step-node-title">${escapeHtml(cleanTitle)}</span>
          <span class="step-node-id">${escapeHtml(node.id)}</span>
        </span>
      `;
      stepBtn.addEventListener("click", () => {
        activeNodeId = nid;
        if (getLayerFromNodeId(nid) !== "L4") {
          currentPath = currentPath.slice(0, idx + 1);
        }
        renderClinicBoardMode();
      });
      pathwayChips.appendChild(stepBtn);
    });

    // 아직 도달하지 않은 향후 임상 단계(L1~L4)를 은은한 가이드 스테퍼로 우측에 표시
    const futureOrder = [
      { key: "L1", label: "L1 문진" },
      { key: "L2", label: "L2 검사" },
      { key: "L3", label: "L3 감별진단" },
      { key: "L4", label: "L4 치료·티칭" },
    ];
    const maxReachedNum = Array.from(visitedLayers).reduce((acc, ly) => {
      const n = Number(String(ly).replace("L", ""));
      return Number.isNaN(n) ? acc : Math.max(acc, n);
    }, 0);

    futureOrder.forEach(({ key, label }) => {
      const lyNum = Number(key.replace("L", ""));
      if (lyNum > maxReachedNum) {
        const arrow = document.createElement("span");
        arrow.className = "stepper-connector conn-ghost";
        arrow.innerHTML = `<span class="conn-chevron">›</span>`;
        pathwayChips.appendChild(arrow);

        const ghost = document.createElement("button");
        ghost.type = "button";
        ghost.className = "stepper-ghost-pill";
        ghost.textContent = label;
        ghost.title = `${label} 열로 보드 스크롤`;
        ghost.addEventListener("click", () => {
          scrollBoardToLayer(key);
        });
        pathwayChips.appendChild(ghost);
      }
    });
  }

  function renderHorizontalCardBoard(nodesMap) {
    const activeNode = nodesMap[activeNodeId];
    const nextBranches = getEffectiveBranches(activeNode, nodesMap);
    // { targetId: "예" } 매핑
    const nextDecisionMap = {};
    nextBranches.forEach(({ label, targetId }) => {
      nextDecisionMap[targetId] = label;
    });

    const pathSet = new Set(currentPath);
    const evoStats = computeNodeEvolutionStats();
    const selectedL0Node =
      currentPath.length > 0 && getLayerFromNodeId(currentPath[0]) === "L0"
        ? nodesMap[currentPath[0]]
        : activeNode && getLayerFromNodeId(activeNode.id) === "L0"
        ? activeNode
        : null;
    const recInterviewId =
      selectedL0Node && selectedL0Node["추천문진"] && nodesMap[selectedL0Node["추천문진"]]
        ? selectedL0Node["추천문진"]
        : null;

    // L0~L5 그룹핑하되, 각 층에서 (1) 현재 경로 카드 (2) 다음 후보/추천 문진 카드 (3) 나머지 흐릿한 카드 순으로 정렬하면 시선이 자연스럽게 이어짐
    const grouped = { L0: [], L1: [], L2: [], L3: [], L4: [], L5: [] };
    Object.values(nodesMap).forEach((node) => {
      const layer = getLayerFromNodeId(node.id);
      if (grouped[layer]) grouped[layer].push(node);
      else grouped.L4.push(node);
    });

    treeColumnsEl.innerHTML = "";

    LAYER_META.forEach(({ key, title }) => {
      const colNodes = (grouped[key] || []).sort((a, b) => {
        const scoreA =
          a.id === activeNodeId
            ? 0
            : pathSet.has(a.id)
            ? 1
            : nextDecisionMap[a.id]
            ? 2
            : a.id === recInterviewId
            ? 2.5
            : 3;
        const scoreB =
          b.id === activeNodeId
            ? 0
            : pathSet.has(b.id)
            ? 1
            : nextDecisionMap[b.id]
            ? 2
            : b.id === recInterviewId
            ? 2.5
            : 3;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return String(a.id).localeCompare(String(b.id));
      });

      const colEl = document.createElement("div");
      colEl.className = "layer-column";
      colEl.setAttribute("data-layer", key);
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
        const isRecInterviewPreview =
          Boolean(recInterviewId) &&
          node.id === recInterviewId &&
          !isInPath &&
          !isPlayableNext &&
          activeNode &&
          getLayerFromNodeId(activeNode.id) === "L0";
        const isL0Choosing = currentPath.length <= 1 && key === "L0";
        const isDimmed = !isSelected && !isInPath && !isPlayableNext && !isRecInterviewPreview && !isL0Choosing;
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
          isRecInterviewPreview ? "recommended-interview-preview" : "",
          isDimmed ? "card-dimmed" : "",
          isRedflag ? "redflag-node" : "",
        ]
          .filter(Boolean)
          .join(" ");

        // 다음 선택 가능한 후보 카드 또는 L0 추천 문진 예고 리본 표시
        let ribbonHtml = "";
        if (isPlayableNext) {
          const isYes = isPositiveBranchLabel(decisionRibbonLabel);
          const isDanger = activeNode && activeNode["레드플래그"] === true && isYes;
          const rCls = isDanger ? "ribbon-danger" : isYes ? "" : "ribbon-no";
          const recSuffix =
            recInterviewId && node.id === recInterviewId && activeNode && String(activeNode.id).endsWith("-L1-01")
              ? " · 🎯 호소 맞춤"
              : "";
          ribbonHtml = `<span class="next-decision-ribbon ${rCls}">👉 [${escapeHtml(
            decisionRibbonLabel
          )}] 카드 뽑기${recSuffix}</span>`;
        } else if (isRecInterviewPreview && selectedL0Node) {
          ribbonHtml = `<span class="next-decision-ribbon ribbon-preview">🎯 [${escapeHtml(
            selectedL0Node.id
          )}] 추천 문진 예고</span>`;
        }

        let badgesHtml = "";
        if (key === "L0" && node["추천문진"] && nodesMap[node["추천문진"]]) {
          const recNode = nodesMap[node["추천문진"]];
          badgesHtml += `<span class="mini-badge badge-rec-l1" title="${escapeHtml(
            recNode["제목"] || ""
          )}">🎯 추천문진 → ${escapeHtml(node["추천문진"])}</span>`;
        }
        if (node["술기구분"]) {
          badgesHtml += `<span class="modality-pill">${escapeHtml(
            MODALITY_ICONS[node["술기구분"]] || node["술기구분"]
          )}</span>`;
        }
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
              const isYes = isPositiveBranchLabel(label);
              const isDanger = isRedflag && isYes;
              const bCls = isDanger ? "inline-danger" : isYes ? "inline-yes" : "inline-no";
              return `<button type="button" class="btn-inline-choice ${bCls}" data-branch-label="${escapeHtml(
                label
              )}" data-branch-target="${escapeHtml(targetId)}">${escapeHtml(label)} →</button>`;
            })
            .join("");
          inlineChoicesHtml = `<div class="card-inline-choices">${btns}</div>`;
        }

        // L4 카드(치료·티칭)를 여러 개 조합할 수 있는 [+ 콤보에 추가/해제] 버튼 (진료 보드가 L3 이상이거나 이미 L4가 켜져 있을 때)
        const hasReachedL3OrL4 = currentPath.some((pid) => {
          const ly = getLayerFromNodeId(pid);
          return ly === "L3" || ly === "L4";
        });
        let stackBtnHtml = "";
        if (getLayerFromNodeId(node.id) === "L4" && hasReachedL3OrL4) {
          stackBtnHtml = `<button type="button" class="btn-stack-l4 ${isInPath ? "stacked" : ""}" data-stack-id="${escapeHtml(
            node.id
          )}">${isInPath ? "✔ 콤보 포함됨 (클릭해 제외)" : "+ 이 술기 콤보에 함께 담기"}</button>`;
        }

        const displayTypeLabel = key === "L0" ? "🗣️ 호소 양상" : TYPE_KOREAN[ntype] || ntype;
        card.innerHTML = `
          ${ribbonHtml}
          <div class="node-card-top">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
              displayTypeLabel
            )}</span>
          </div>
          <div class="node-card-title">${escapeHtml(node["제목"])}</div>
          ${previewText ? `<div class="node-card-preview">${escapeHtml(previewText)}</div>` : ""}
          ${badgesHtml ? `<div class="node-card-badges">${badgesHtml}</div>` : ""}
          ${inlineChoicesHtml}
          ${stackBtnHtml}
        `;

        // L4 다중 술기 조합 토글 버튼 클릭
        card.querySelectorAll(".btn-stack-l4").forEach((sb) => {
          sb.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const sid = sb.getAttribute("data-stack-id");
            const idx = currentPath.indexOf(sid);
            if (idx >= 0) {
              if (currentPath.length > 1) {
                currentPath.splice(idx, 1);
                if (activeNodeId === sid) activeNodeId = currentPath[currentPath.length - 1];
              }
            } else {
              currentPath.push(sid);
              activeNodeId = sid;
            }
            renderClinicBoardMode();
          });
        });

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
          } else if (getLayerFromNodeId(node.id) === "L0") {
            activeNodeId = node.id;
            currentPath = [node.id];
            pathDecisions = {};
            renderClinicBoardMode();
          } else {
            const idxInPath = currentPath.indexOf(node.id);
            if (idxInPath !== -1) {
              activeNodeId = node.id;
              currentPath = currentPath.slice(0, idxInPath + 1);
            } else {
              // 흐릿한 비선택 카드를 클릭했을 때도 그 카드로 자연스럽게 경로 재구성
              const entryId =
                (currentPath.length > 0 && getLayerFromNodeId(currentPath[0]) === "L0"
                  ? currentPath[0]
                  : mergedTreeData["증상"][activeSymptomCode].entry);
              activeNodeId = node.id;
              currentPath = buildPathToNode(nodesMap, entryId, node.id);
            }
            renderClinicBoardMode();
          }
          if (window.innerWidth <= 768 && nodeDetailPanel) {
            nodeDetailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        });

        colEl.appendChild(card);
      });

      treeColumnsEl.appendChild(colEl);
    });
  }

  function playCardTransition(fromId, decisionLabel, toId) {
    pathDecisions[fromId] = decisionLabel;
    let actualTarget = toId;
    const symNodes =
      mergedTreeData && mergedTreeData["증상"] && mergedTreeData["증상"][activeSymptomCode]
        ? mergedTreeData["증상"][activeSymptomCode].nodes
        : {};
    if (String(fromId).endsWith("-L1-01") && String(decisionLabel).includes("아니오")) {
      const startNode = currentPath.length > 0 ? symNodes[currentPath[0]] : null;
      const recId = startNode && startNode["추천문진"];
      if (recId && symNodes[recId] && recId !== fromId) {
        actualTarget = recId;
        if (actualTarget !== toId) {
          showToast(`🎯 선택한 호소 양상에 맞춰 [${actualTarget}] 문진으로 연결되었습니다.`);
        }
      }
    }
    const existingIdx = currentPath.indexOf(actualTarget);
    if (existingIdx !== -1) {
      currentPath = currentPath.slice(0, existingIdx + 1);
    } else {
      currentPath.push(actualTarget);
    }
    activeNodeId = actualTarget;
    renderClinicBoardMode();
    triggerSmoothEnter(nodeDetailContent, "dock-morph-enter");
    autoPanBoardToActiveLayer();
  }

  function autoPanBoardToActiveLayer() {
    const viewport = document.getElementById("board-scroll-viewport");
    const activeLayer = getLayerFromNodeId(activeNodeId);
    const colEl = treeColumnsEl ? treeColumnsEl.querySelector(`.layer-column[data-layer="${activeLayer}"]`) : null;
    if (!viewport || !colEl) return;
    if (window.innerWidth <= 768) {
      viewport.scrollTo({ left: Math.max(0, colEl.offsetLeft - 8), behavior: "smooth" });
      return;
    }
    // 데스크톱에서 보드가 가로 스크롤 중일 때 현재 층이 화면 중앙 부근에 오도록 부드럽게 패닝
    const targetLeft = Math.max(0, colEl.offsetLeft - Math.round(viewport.clientWidth * 0.22));
    viewport.scrollTo({ left: targetLeft, behavior: "smooth" });
  }

  /* ==================== 카드 간 SVG 베지어 곡선 연결선 렌더링 ==================== */
  function drawSvgBranchLines(nodesMap) {
    if (!branchSvgLayer || !boardCanvas) return;
    const canvasRect = boardCanvas.getBoundingClientRect();
    branchSvgLayer.setAttribute("width", String(boardCanvas.scrollWidth));
    branchSvgLayer.setAttribute("height", String(boardCanvas.scrollHeight));
    branchSvgLayer.innerHTML = "";

    const pathSet = new Set(currentPath);
    const activeEdges = new Set();
    for (let i = 0; i < currentPath.length - 1; i++) {
      activeEdges.add(`${currentPath[i]}->${currentPath[i + 1]}`);
    }
    // 다중 술기 콤보가 켜져 있을 때(예: L3→[전침, 추나, 한약]) 경로에 포함된 모든 부모→자식 연결선도 함께 점등
    Object.values(nodesMap).forEach((sn) => {
      if (!pathSet.has(sn.id)) return;
      getEffectiveBranches(sn, nodesMap).forEach(({ targetId }) => {
        if (pathSet.has(targetId)) {
          activeEdges.add(`${sn.id}->${targetId}`);
        }
      });
    });

    const activeNode = nodesMap[activeNodeId];
    const nextBranches = getEffectiveBranches(activeNode, nodesMap);
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

      const branches = getEffectiveBranches(srcNode, nodesMap);
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
    const isL0Node = getLayerFromNodeId(node.id) === "L0";
    const prof = typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4;
    const branches = getEffectiveBranches(node, nodesMap);
    const evoStats = computeNodeEvolutionStats();
    const nodeStat = evoStats[node.id];

    let html = `
      <div class="dock-card-frame">
        <div class="node-card-top">
          <div style="display:flex; gap:0.35rem; align-items:center;">
            <span class="node-id-badge">${escapeHtml(node.id)}</span>
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
              isL0Node ? "🗣️ 호소 양상" : TYPE_KOREAN[ntype] || ntype
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
                • 전원 기준: ${linkifyCitationsHtml(node["전원기준"] || "양성 시 지체 없이 응급 전원")}
               </div>`
            : ""
        }
    `;

    // 유형별 메인 카드 효과 영역
    const selectedL0Node =
      currentPath.length > 0 && getLayerFromNodeId(currentPath[0]) === "L0"
        ? nodesMap[currentPath[0]]
        : isL0Node
        ? node
        : null;
    const l0RecId = selectedL0Node && selectedL0Node["추천문진"];
    const l0RecNode = l0RecId && nodesMap[l0RecId] ? nodesMap[l0RecId] : null;
    const isL1Redflag = String(node.id || "").endsWith("-L1-01");

    if (ntype === "ask") {
      html += `
        <div class="hero-question-box">
          <div class="hero-question-text">${isL0Node ? "🗣️ 환자 호소:" : "Q."} “${escapeHtml(node["질문"] || node["제목"])}”</div>
          <div class="hero-why-text"><strong>${isL0Node ? "🎯 임상 의미·타겟:" : "💡 왜 묻는가:"}</strong> ${linkifyCitationsHtml(
            node["왜"] || "임상 분기 판정"
          )}</div>
        </div>
      `;
      if (isL0Node && l0RecNode) {
        const sc = getNodeSymptomCode(node.id);
        const rfId = `${sc}-L1-01`;
        const rfNode = nodesMap[rfId];
        html += `
          <div class="l0-routing-preview">
            <div class="l0-routing-head">🎯 이 호소 양상 선택 시 맞춤 연결 경로</div>
            <div class="l0-routing-flow">
              <span>1️⃣ <strong>${escapeHtml(rfId)}</strong> ${escapeHtml(rfNode ? rfNode["제목"] : "응급 레드플래그 확인")}</span>
              <span class="l0-routing-arrow">→ (음성 시)</span>
              <span>2️⃣ <strong>${escapeHtml(l0RecId)}</strong> ${escapeHtml(l0RecNode["제목"])}</span>
            </div>
          </div>
        `;
      } else if (isL1Redflag && selectedL0Node && l0RecNode) {
        html += `
          <div class="l0-routing-preview">
            <div class="l0-routing-head">🎯 호소 양상(${escapeHtml(selectedL0Node.id)}) 맞춤 문진 연결 활성</div>
            <div class="l0-routing-flow">
              <span>아래 <strong>[아니오]</strong> 선택 시 <strong>${escapeHtml(l0RecId)}</strong> (${escapeHtml(
                l0RecNode["제목"]
              )}) 문진으로 이어집니다.</span>
            </div>
          </div>
        `;
      }
    } else if (ntype === "test") {
      html += `
        <div class="hero-question-box" style="background:#faf5ff; border-left-color:#7c3aed;">
          <div class="hero-question-text" style="color:#4c1d95;">🔬 ${escapeHtml(
            node["검사명"] || node["제목"]
          )}</div>
          <div class="hero-why-text"><strong>🎯 배제 대상:</strong> ${linkifyCitationsHtml(
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
              ? `<div class="hero-why-text" style="color:#dc2626; font-weight:700;">🚨 위험 감별: ${linkifyCitationsHtml(
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
          const isYes = isPositiveBranchLabel(label);
          const cls = isRedflag && isYes ? "choice-danger" : isYes ? "choice-yes" : "choice-no";
          const customRecTag =
            isL1Redflag && !isYes && l0RecId && targetId === l0RecId ? " · 🎯 맞춤 문진" : "";
          return `
            <button type="button" class="dock-choice-btn ${cls} btn-dock-branch" data-label="${escapeHtml(
            label
          )}" data-target="${escapeHtml(targetId)}">
              <span>👉 [${escapeHtml(label)}${customRecTag}]</span>
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
            <span>${linkifyCitationsHtml(v)}</span>
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

    const availableRoutines = getAvailableRoutines();
    const mgrRtEl = document.getElementById("routine-manager-count");
    if (mgrRtEl) mgrRtEl.textContent = `${availableRoutines.length}개`;

    if (availableRoutines.length === 0) {
      container.innerHTML = "<p>저장된 루틴 덱이 없습니다.</p>";
      return;
    }

    container.innerHTML = "";
    availableRoutines.forEach((rt) => {
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
  function getNodeSymptomCode(nodeId) {
    const m = String(nodeId || "").match(/^([A-Z]{2,4})-/);
    return m ? m[1] : "";
  }

  function renderSkillRegistry() {
    const container = document.getElementById("skill-list-grid");
    const protoGrid = document.getElementById("protocol-skill-cards-grid");
    const symFilterWrap = document.getElementById("skill-symptom-filters");
    const protoCountBadge = document.getElementById("protocol-skill-cards-count");
    if (!container) return;

    // 1. 증상 필터 버튼 렌더링
    if (symFilterWrap && mergedTreeData && mergedTreeData["증상"]) {
      const syms = Object.entries(mergedTreeData["증상"]);
      let filterHtml = `<button type="button" class="filter-pill ${
        skillFilterSymptom === "ALL" ? "active" : ""
      }" data-sym="ALL">전체 증상</button>`;
      syms.forEach(([code, obj]) => {
        filterHtml += `<button type="button" class="filter-pill ${
          skillFilterSymptom === code ? "active" : ""
        }" data-sym="${escapeHtml(code)}">${escapeHtml(obj.name)} (${escapeHtml(code)})</button>`;
      });
      symFilterWrap.innerHTML = filterHtml;

      symFilterWrap.querySelectorAll(".filter-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          skillFilterSymptom = btn.getAttribute("data-sym");
          renderSkillRegistry();
        });
      });
    }

    // 2. 섹션 1: 내 공용/등록 스킬 (증상 필터 적용, 실제 존재하는 노드 기준)
    const regCountBadge = document.getElementById("registered-skill-cards-count");
    const filteredSkills = skillsList.filter((sk) => {
      if (skillFilterSymptom === "ALL") return true;
      return getActiveLinkedNodeIds(sk).some((nid) => getNodeSymptomCode(nid) === skillFilterSymptom);
    });
    if (regCountBadge) {
      regCountBadge.textContent =
        skillFilterSymptom === "ALL"
          ? `${filteredSkills.length}개`
          : `${filteredSkills.length}/${skillsList.length}개`;
    }

    container.innerHTML = "";
    if (filteredSkills.length === 0) {
      container.innerHTML =
        '<p style="font-size:0.84rem; color:var(--text-muted);">해당 증상에 연결된 공용 스킬이 없습니다. 아래 프로토콜 카드에서 [+ 내 스킬로 연결]을 누르거나 위 폼에서 추가하세요.</p>';
    } else {
      filteredSkills.forEach((sk) => {
        const lv = Number(sk.level) || 0;
        const stars = "★".repeat(lv) + "☆".repeat(Math.max(0, 5 - lv));
        const activeLinkedIds = getActiveLinkedNodeIds(sk);

        // 연결된 증상 목록 추출
        const linkedSyms = Array.from(
          new Set(
            activeLinkedIds
              .map((nid) => {
                const sc = getNodeSymptomCode(nid);
                const sObj = mergedTreeData && mergedTreeData["증상"] ? mergedTreeData["증상"][sc] : null;
                return sObj ? `${sObj.name}(${sc})` : sc;
              })
              .filter(Boolean)
          )
        );

        const symBadgesHtml = linkedSyms
          .map((s) => `<span class="skill-sym-badge">${escapeHtml(s)}</span>`)
          .join(" ");

        const nodeChipsHtml = activeLinkedIds
          .map(
            (nid) =>
              `<button type="button" class="btn-node-jump-chip" data-jump-node="${escapeHtml(
                nid
              )}" title="진료 보드에서 이 카드 보기">${escapeHtml(nid)} →</button>`
          )
          .join(" ");

        const card = document.createElement("div");
        card.className = "skill-card";
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
            <div>
              <div style="display:flex; flex-wrap:wrap; gap:0.3rem; align-items:center;">
                <span class="node-id-badge">${escapeHtml(sk.id)} · ${escapeHtml(sk.category)}</span>
                ${symBadgesHtml}
              </div>
              <h3 style="font-size:0.95rem; font-weight:900; margin-top:0.3rem;">${escapeHtml(sk.name)}</h3>
            </div>
            <span class="prof-chip prof-${lv}">Lv.${lv} ${stars}</span>
          </div>
          <div style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(sk.notes || "")}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.3rem; align-items:center;">
            <span style="font-size:0.74rem; color:#0369a1; font-weight:800;">연결 카드:</span>
            ${nodeChipsHtml || '<span style="font-size:0.74rem; color:var(--text-muted);">미연결</span>'}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.4rem; padding-top:0.4rem; border-top:1px solid var(--border-light);">
            <select class="select-input skill-lv-change" data-id="${escapeHtml(
              sk.id
            )}" style="font-size:0.78rem; padding:0.2rem 0.45rem;">
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
    }

    container.querySelectorAll(".btn-node-jump-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nid = btn.getAttribute("data-jump-node");
        const sc = getNodeSymptomCode(nid);
        if (sc) {
          switchMode("clinic");
          selectSymptom(sc, nid);
        }
      });
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

    // 3. 섹션 2: 프로토콜 트리 안의 모든 치료(treat) · 검사(test) · 티칭(teach) 카드 자동 동기화 표시
    if (!protoGrid || !mergedTreeData || !mergedTreeData["증상"]) return;

    const totalProtoCount = getProtocolSkillCards("ALL", "all").length;
    const protoCards = getProtocolSkillCards(skillFilterSymptom, skillFilterType);

    if (protoCountBadge) {
      protoCountBadge.textContent =
        skillFilterSymptom === "ALL" && skillFilterType === "all"
          ? `${protoCards.length}장`
          : `${protoCards.length}/${totalProtoCount}장`;
    }

    protoGrid.innerHTML = "";
    if (protoCards.length === 0) {
      protoGrid.innerHTML = '<p style="font-size:0.84rem; color:var(--text-muted);">표시할 카드가 없습니다.</p>';
      return;
    }

    protoCards.forEach(({ symCode, symName, node }) => {
      const lv = typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4;
      const ntype = node["유형"];
      const linkedSkill = skillsList.find((sk) => (sk.linkedNodes || []).includes(node.id));
      const summary =
        node["술기세트"] || node["검사명"] || node["환자설명"] || node["제목"];

      const card = document.createElement("div");
      card.className = "skill-card";
      card.setAttribute("data-card-type", ntype);
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
          <div>
            <div style="display:flex; flex-wrap:wrap; gap:0.25rem; align-items:center;">
              <span class="skill-sym-badge">${escapeHtml(symName)} (${escapeHtml(symCode)})</span>
              <span class="node-id-badge">${escapeHtml(node.id)}</span>
              <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
                TYPE_KOREAN[ntype] || ntype
              )}</span>
            </div>
            <h3 style="font-size:0.92rem; font-weight:900; margin-top:0.28rem;">${escapeHtml(node["제목"])}</h3>
          </div>
          <span class="prof-chip prof-${lv}">Lv.${lv}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(summary)}</div>
        <div style="font-size:0.75rem; font-weight:700; color:${linkedSkill ? "#15803d" : "#64748b"};">
          ${
            linkedSkill
              ? `🔗 장착 스킬: ${escapeHtml(linkedSkill.id)} (${escapeHtml(linkedSkill.name)})`
              : "연결된 공용 스킬 없음 (개별 카드 숙련도 관리)"
          }
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.35rem; padding-top:0.35rem; border-top:1px solid var(--border-light);">
          <select class="select-input proto-card-lv-change" data-sym="${escapeHtml(symCode)}" data-nid="${escapeHtml(
        node.id
      )}" style="font-size:0.76rem; padding:0.2rem 0.4rem;">
            <option value="0" ${lv === 0 ? "selected" : ""}>Lv.0 미경험(⛔)</option>
            <option value="1" ${lv === 1 ? "selected" : ""}>Lv.1 관찰(⚠️)</option>
            <option value="2" ${lv === 2 ? "selected" : ""}>Lv.2 부분시행(⚠️)</option>
            <option value="3" ${lv === 3 ? "selected" : ""}>Lv.3 지도하완수(🔶)</option>
            <option value="4" ${lv === 4 ? "selected" : ""}>Lv.4 단독숙련(✅)</option>
            <option value="5" ${lv === 5 ? "selected" : ""}>Lv.5 마스터(🌟)</option>
          </select>
          <div class="btn-row">
            ${
              !linkedSkill
                ? `<button type="button" class="btn btn-sm btn-outline btn-promote-to-skill" data-sym="${escapeHtml(
                    symCode
                  )}" data-nid="${escapeHtml(node.id)}">+ 내 스킬로 등록</button>`
                : ""
            }
            <button type="button" class="btn btn-sm btn-secondary btn-jump-proto-card" data-sym="${escapeHtml(
              symCode
            )}" data-nid="${escapeHtml(node.id)}">🩺 보드 보기</button>
          </div>
        </div>
      `;
      protoGrid.appendChild(card);
    });

    protoGrid.querySelectorAll(".proto-card-lv-change").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        const symCode = sel.getAttribute("data-sym");
        const nid = sel.getAttribute("data-nid");
        const newLv = Number(e.target.value);
        const sym = mergedTreeData["증상"][symCode];
        const node = sym && sym.nodes ? sym.nodes[nid] : null;
        if (!node) return;

        node["내숙련도"] = newLv;
        const entryItem = {
          id: node.id,
          symCode,
          symName: sym.name,
          parentBranch: "",
          node: JSON.parse(JSON.stringify(node)),
        };
        const idx = customNodesList.findIndex((x) => x.id === node.id);
        if (idx >= 0) customNodesList[idx] = entryItem;
        else customNodesList.push(entryItem);
        await dbPut("custom_nodes", entryItem);

        // 연결된 스킬이 있으면 함께 동기화
        for (const sk of skillsList) {
          if ((sk.linkedNodes || []).includes(node.id)) {
            sk.level = newLv;
            await dbPut("skills", sk);
          }
        }

        rebuildMergedTree();
        renderSkillRegistry();
        showToast(`🎯 ${nid} 카드 숙련도가 Lv.${newLv}(으)로 동기화되었습니다.`);
      });
    });

    protoGrid.querySelectorAll(".btn-promote-to-skill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const symCode = btn.getAttribute("data-sym");
        const nid = btn.getAttribute("data-nid");
        const sym = mergedTreeData["증상"][symCode];
        const node = sym && sym.nodes ? sym.nodes[nid] : null;
        if (!node) return;

        const drawer = document.getElementById("skill-form-drawer");
        if (drawer) drawer.hidden = false;
        const nextSkNum = skillsList.length + 1;
        document.getElementById("skill-id-input").value = `SK-${String(nextSkNum).padStart(3, "0")}`;
        document.getElementById("skill-name-input").value = node["제목"];
        document.getElementById("skill-linked-nodes").value = node.id;
        document.getElementById("skill-level-input").value = String(
          typeof node["내숙련도"] === "number" ? node["내숙련도"] : 4
        );
        document.getElementById("skill-notes-input").value =
          node["자침점용량"] || node["술기세트"] || node["검사명"] || "";
        document.getElementById("skill-name-input").focus();
        showToast(`📝 ${nid} 정보가 등록 폼에 채워졌습니다.`);
      });
    });

    protoGrid.querySelectorAll(".btn-jump-proto-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const symCode = btn.getAttribute("data-sym");
        const nid = btn.getAttribute("data-nid");
        switchMode("clinic");
        selectSymptom(symCode, nid);
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
      `# [차트나무 진료 카드 콤보 AI 3줄 점검 요청]`,
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
      `# [차트나무 프로토콜 진화 & 신규 카드 공동 설계 브리프]`,
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

  /* ==================== 한방병원·한의원 표준 EMR 자동 의무기록 생성기 ==================== */
  let currentEmrFormat = "hospital";

  function collectConsultContextForEmr() {
    if (!mergedTreeData || !mergedTreeData["증상"][activeSymptomCode]) return null;
    const sym = mergedTreeData["증상"][activeSymptomCode];
    const nodesMap = sym.nodes || {};

    const visitTypeEl = document.getElementById("qc-visit-type");
    const nrsBeforeEl = document.getElementById("qc-nrs-before");
    const nrsAfterEl = document.getElementById("qc-nrs-after");
    const memoEl = document.getElementById("qc-memo");

    const visitType = visitTypeEl ? visitTypeEl.value : "초진";
    const nrsBefore = nrsBeforeEl ? Number(nrsBeforeEl.value) : 7;
    const nrsAfter = nrsAfterEl ? Number(nrsAfterEl.value) : 3;
    const memo = memoEl ? memoEl.value.trim() : "";

    const pathNodes = currentPath.map((nid) => nodesMap[nid]).filter(Boolean);
    const l0Nodes = pathNodes.filter((n) => getLayerFromNodeId(n.id) === "L0");
    const l1Nodes = pathNodes.filter((n) => getLayerFromNodeId(n.id) !== "L0" && n["유형"] === "ask");
    const l2Nodes = pathNodes.filter((n) => n["유형"] === "test");
    const l3Nodes = pathNodes.filter((n) => n["유형"] === "dx");
    const l4TreatNodes = pathNodes.filter((n) => n["유형"] === "treat");
    const l4TeachNodes = pathNodes.filter((n) => n["유형"] === "teach");
    const l5Nodes = pathNodes.filter((n) => n["유형"] === "outcome");

    // 아직 L3나 L4까지 클릭하지 않은 상태에서 차트 생성을 눌렀을 때도 연결된 추천 감별·치료 카드를 자동 보완
    let inferredDx = l3Nodes.slice();
    let inferredTreats = l4TreatNodes.slice();
    let inferredTeaches = l4TeachNodes.slice();

    if (inferredDx.length === 0 || inferredTreats.length === 0) {
      const visitedIds = new Set(currentPath);
      const queue = [activeNodeId];
      while (queue.length > 0 && (inferredDx.length === 0 || inferredTreats.length < 2)) {
        const curId = queue.shift();
        const curNode = nodesMap[curId];
        if (!curNode) continue;
        const brs = getEffectiveBranches(curNode, nodesMap);
        brs.forEach(({ label, targetId }) => {
          if (visitedIds.has(targetId)) return;
          // 레드플래그 응급 전원 분기는 자동 추론에서 제외
          if (curNode["레드플래그"] === true && isPositiveBranchLabel(label)) return;
          visitedIds.add(targetId);
          const tn = nodesMap[targetId];
          if (!tn) return;
          if (tn["유형"] === "dx" && inferredDx.length === 0) inferredDx.push(tn);
          else if (tn["유형"] === "treat" && inferredTreats.length < 3) inferredTreats.push(tn);
          else if (tn["유형"] === "teach" && inferredTeaches.length < 1) inferredTeaches.push(tn);
          queue.push(targetId);
        });
      }
    }

    const primaryDxNode = inferredDx[0] || null;
    const primaryDxTitle = primaryDxNode
      ? String(primaryDxNode["제목"] || "").replace(/\s*감별$/, "")
      : `${sym.name} 상세불명`;

    return {
      sym,
      nodesMap,
      visitType,
      nrsBefore,
      nrsAfter,
      memo,
      l0Nodes,
      l1Nodes,
      l2Nodes,
      l3Nodes: inferredDx,
      l4TreatNodes: inferredTreats,
      l4TeachNodes: inferredTeaches,
      l5Nodes,
      primaryDxTitle,
      isAutoInferredTreat: l4TreatNodes.length === 0 && inferredTreats.length > 0,
    };
  }

  function generateStandardEmrChart(formatType = "hospital") {
    const ctx = collectConsultContextForEmr();
    if (!ctx) return "";
    const today = new Date().toISOString().slice(0, 10);
    const {
      sym,
      visitType,
      nrsBefore,
      nrsAfter,
      memo,
      l0Nodes,
      l1Nodes,
      l2Nodes,
      l3Nodes,
      l4TreatNodes,
      l4TeachNodes,
      l5Nodes,
      primaryDxTitle,
      isAutoInferredTreat,
    } = ctx;

    const ccNode = l0Nodes[0] || null;
    const ccTitle = ccNode ? String(ccNode["제목"] || "").replace(/^\[호소\]\s*/, "") : sym.name;
    const ccQuote = ccNode && ccNode["질문"] ? `“${ccNode["질문"]}”` : ccTitle;

    // 1) 한방병원 표준 외래 의무기록지 (Full Hospital EMR)
    if (formatType === "hospital") {
      const lines = [
        "================================================================",
        `[한방병원·한의원 표준 외래 의무기록지 (${visitType})]`,
        `작성일자: ${today} | 진료분야: 한방내과·침구의학과 | 프로토콜: ${sym.name}(${activeSymptomCode})`,
        `임상경로: ${currentPath.join(" → ")}`,
        "================================================================",
        "",
        "■ 1. C.C (Chief Complaint · 주소증)",
        `  • 주호소: ${ccTitle} ${ccNode ? `[${ccNode.id}]` : ""}`,
        `  • 환자 진술: ${ccQuote}`,
        `  • 통증/증상 강도(NRS): 내원 시 NRS ${nrsBefore} / 10 → 시술 후(목표) NRS ${nrsAfter} / 10`,
        "",
        "■ 2. P.I & R.O.S (Present Illness & Red Flag Screening · 현병력 및 문진)",
      ];

      if (l1Nodes.length === 0) {
        lines.push(`  • [초기 호소 평가] ${ccNode && ccNode["왜"] ? ccNode["왜"] : "주호소 양상 확인"}`);
      } else {
        l1Nodes.forEach((n) => {
          const dec = pathDecisions[n.id] || "확인";
          const tag = n["레드플래그"] ? "[Red Flag 배제]" : "[감별 문진]";
          lines.push(`  • ${tag} ${n["제목"]} [${n.id}] → 판정: ${dec}`);
          if (n["질문"]) lines.push(`    - 문진 내용: ${n["질문"]}`);
        });
      }
      if (memo) {
        lines.push(`  • [임상·변증 특이소견] ${memo}`);
      }

      lines.push("", "■ 3. P.E (Physical Examination · 이학적 검사 및 진찰 소견)");
      if (l2Nodes.length === 0) {
        lines.push("  • 이학적 검사: 국소 압통·관절가동범위(ROM) 및 신경학적 기본 진찰 시행");
      } else {
        l2Nodes.forEach((n) => {
          const dec = pathDecisions[n.id] || "시행";
          const acc = n["민감도"] ? ` (민감도 ${n["민감도"]} / 특이도 ${n["특이도"] || "-"} / LR+ ${n["LR+"] || "-"})` : "";
          lines.push(`  • [${n.id}] ${n["검사명"] || n["제목"]} → 결과: ${dec}${acc}`);
          if (n["배제대상"]) lines.push(`    - 임상 의의: ${n["배제대상"]}`);
        });
      }

      lines.push("", "■ 4. Assessment (임상 추정 진단 · 감별진단 · 변증)");
      lines.push(`  • 주진단(추정): ${primaryDxTitle}`);
      l3Nodes.forEach((n) => {
        const cands = Array.isArray(n["후보"]) ? n["후보"].join(", ") : n["제목"];
        lines.push(`  • 감별 후보군 [${n.id}]: ${cands}`);
        if (n["올리는소견"]) lines.push(`    - 부합 소견(+): ${n["올리는소견"]}`);
        if (n["위험감별"]) lines.push(`    - 배제 필수 위험감별(!): ${n["위험감별"]}`);
      });
      if (memo) {
        lines.push(`  • 한의 변증/진찰 메모: ${memo}`);
      }

      lines.push(
        "",
        `■ 5. Plan & Order (한방 처치·시술 오더 및 환자 지도)${isAutoInferredTreat ? " [경로 기반 추천 오더]" : ""}`
      );
      if (l4TreatNodes.length === 0) {
        lines.push("  • [처치 오더] 경혈 침구치료 및 변증 약물·이학요법 시행");
      } else {
        l4TreatNodes.forEach((n, idx) => {
          const mod = n["술기구분"] ? `[${n["술기구분"]}] ` : "";
          lines.push(`  ${idx + 1}. ${mod}${n["제목"]} [${n.id}]`);
          if (n["술기세트"]) lines.push(`     - 술기 프로토콜: ${n["술기세트"]}`);
          if (n["자침점용량"]) lines.push(`     - 자침점·용량·규격: ${n["자침점용량"]}`);
          if (n["빈도"] || n["기간"]) lines.push(`     - 시술 빈도·기간: ${n["빈도"] || "-"} / ${n["기간"] || "-"}`);
          if (n["금기"]) lines.push(`     - 금기 및 주의: ${n["금기"]}`);
        });
      }

      if (l4TeachNodes.length > 0) {
        lines.push("", "■ 6. Patient Education & Follow-up (환자 교육 · 재평가 · 전원 기준)");
        l4TeachNodes.forEach((n) => {
          lines.push(`  • [환자 티칭 (${n.id})] ${n["제목"]}`);
          if (n["환자설명"]) lines.push(`    - 환자 설명: ${n["환자설명"]}`);
          if (n["생활지도"]) lines.push(`    - 생활 수칙: ${n["생활지도"]}`);
        });
      }

      const refCriteria =
        (l4TreatNodes[0] && l4TreatNodes[0]["전원기준"]) ||
        (l1Nodes[0] && l1Nodes[0]["전원기준"]) ||
        "신경학적 결손 진행 또는 보존적 치료 무반응 시 상급병원 전원";
      const reEval =
        (l4TreatNodes[0] && l4TreatNodes[0]["재평가시점"]) ||
        (l5Nodes[0] && l5Nodes[0]["측정지점"]) ||
        "시술 직후 및 1~2주 후 NRS·기능지표 재평가";
      lines.push(`  • [재평가 계획] ${reEval}`);
      lines.push(`  • [전원 기준] ${refCriteria}`);
      lines.push("================================================================");
      return lines.join("\n");
    }

    // 2) 로컬 한의원 차트 (한의맥 · OK차트 붙여넣기용 간결한 SOAP 서식)
    if (formatType === "clinic") {
      const sBullets = [
        `[${visitType}] C/C: ${ccTitle} (${ccQuote})`,
        `• 통증 척도: NRS ${nrsBefore} → ${nrsAfter}`,
      ];
      l1Nodes.forEach((n) => {
        const dec = pathDecisions[n.id] || "확인";
        sBullets.push(`• ${n["레드플래그"] ? "[RF배제]" : "[문진]"} ${n["제목"]}: ${dec}`);
      });
      if (memo) sBullets.push(`• 변증/특이사항: ${memo}`);

      const oBullets =
        l2Nodes.length > 0
          ? l2Nodes.map((n) => `• ${n["검사명"] || n["제목"]}: ${pathDecisions[n.id] || "양성/확인"} (${n["배제대상"] || "-"})`)
          : ["• 국소 압통 및 가동범위(ROM) 평가 시행"];

      const aBullets = [`• 추정 진단: ${primaryDxTitle}`];
      l3Nodes.forEach((n) => {
        const cands = Array.isArray(n["후보"]) ? n["후보"].join(", ") : n["제목"];
        aBullets.push(`• 감별: ${cands}`);
      });

      const pBullets = [];
      l4TreatNodes.forEach((n) => {
        const mod = n["술기구분"] ? `[${n["술기구분"]}]` : "[처치]";
        pBullets.push(`• ${mod} ${n["제목"]}: ${n["자침점용량"] || n["술기세트"] || "-"} (${n["빈도"] || "주 2~3회"})`);
      });
      l4TeachNodes.forEach((n) => {
        pBullets.push(`• [생활지도] ${n["생활지도"] || n["환자설명"] || n["제목"]}`);
      });

      return [
        `[S]`,
        sBullets.join("\n"),
        "",
        `[O]`,
        oBullets.join("\n"),
        "",
        `[A]`,
        aBullets.join("\n"),
        "",
        `[P]`,
        pBullets.length > 0 ? pBullets.join("\n") : "• 침구치료 및 경과 관찰",
      ].join("\n");
    }

    // 3) 처치·시술 오더 및 환자 안내문 요약 (Order Sheet)
    const orderLines = [
      `# [${sym.name} (${activeSymptomCode}) 처치 오더 & 환자 티칭 시트] · ${today}`,
      `• 추정 진단: ${primaryDxTitle} | NRS ${nrsBefore} → ${nrsAfter}`,
      "",
      "## 1. 시술 · 처방 오더",
    ];
    if (l4TreatNodes.length === 0) {
      orderLines.push("- 선택된 L4 치료 카드가 없습니다.");
    } else {
      l4TreatNodes.forEach((n, idx) => {
        orderLines.push(`${idx + 1}) [${n["술기구분"] || "치료"} · ${n.id}] ${n["제목"]}`);
        orderLines.push(`   - 술기 세트: ${n["술기세트"] || "-"}`);
        orderLines.push(`   - 자침점·용량: ${n["자침점용량"] || "-"}`);
        orderLines.push(`   - 빈도·기간: ${n["빈도"] || "-"} / ${n["기간"] || "-"}`);
        orderLines.push(`   - 주의/금기: ${n["금기"] || "-"}`);
      });
    }
    orderLines.push("", "## 2. 환자 설명 및 생활 수칙");
    if (l4TeachNodes.length === 0) {
      const fallbackExplain = (l4TreatNodes[0] && l4TreatNodes[0]["환자설명"]) || "꾸준한 침구·한약 치료와 바른 생활 습관이 중요합니다.";
      orderLines.push(`- ${fallbackExplain}`);
    } else {
      l4TeachNodes.forEach((n) => {
        orderLines.push(`- [${n.id} ${n["제목"]}] ${n["환자설명"] || ""}`);
        if (n["생활지도"]) orderLines.push(`  • 생활 수칙: ${n["생활지도"]}`);
      });
    }
    return orderLines.join("\n");
  }

  function openEmrChartModal(defaultFmt = "hospital") {
    const memoEl = document.getElementById("qc-memo");
    const memo = memoEl ? memoEl.value.trim() : "";
    if (PHONE_REGEX.test(memo) || RRN_REGEX.test(memo)) {
      showToast("⛔ 전화번호·주민번호 등 환자 식별정보는 입력할 수 없습니다.");
      return;
    }

    currentEmrFormat = defaultFmt;
    const modal = document.getElementById("emr-chart-modal");
    const textarea = document.getElementById("emr-chart-textarea");
    if (!modal || !textarea) return;

    document.querySelectorAll(".emr-fmt-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-emr-fmt") === currentEmrFormat);
    });

    const chartText = generateStandardEmrChart(currentEmrFormat);
    textarea.value = chartText;
    modal.hidden = false;
    copyToClipboard(chartText, "한방병원·한의원 표준 EMR 의무기록");
  }

  async function saveCurrentConsultToCaseLog() {
    const ctx = collectConsultContextForEmr();
    if (!ctx) return;
    const { nrsBefore, nrsAfter, memo, primaryDxTitle } = ctx;
    if (PHONE_REGEX.test(memo) || RRN_REGEX.test(memo)) {
      showToast("⛔ 전화번호·주민번호 등 환자 식별정보는 저장할 수 없습니다.");
      return;
    }

    const caseId = `C-${String(casesList.length + 1).padStart(4, "0")}`;
    const caseObj = {
      caseId,
      date: new Date().toISOString().slice(0, 10),
      symptom: activeSymptomCode,
      path: currentPath.slice(),
      nrsBefore,
      nrsAfter,
      timepoint: "1주",
      finalDx: primaryDxTitle,
      memo,
    };

    casesList.push(caseObj);
    await dbPut("cases", caseObj);
    updateBadges();
    renderClinicBoardMode();
    showToast(`📈 ${caseId} (${primaryDxTitle}, NRS ${nrsBefore}→${nrsAfter}) 케이스가 진화 통계에 기록되었습니다.`);
  }

  function searchNodesWithL0Priority(rawQuery) {
    const q = (rawQuery || "").trim().toLowerCase();
    if (!q || !mergedTreeData || !mergedTreeData["증상"]) {
      return { l0Matches: [], otherMatches: [] };
    }

    const directL0 = [];
    const directOther = [];
    const matchedSymptomCodes = new Set();

    Object.entries(mergedTreeData["증상"]).forEach(([code, sym]) => {
      const symNodes = sym.nodes || {};
      Object.values(symNodes).forEach((node) => {
        const layer = getLayerFromNodeId(node.id);
        const recId = node["추천문진"];
        const recTitle = recId && symNodes[recId] ? symNodes[recId]["제목"] : "";
        const hay = [
          code,
          sym.name,
          node.id,
          node["제목"],
          node["질문"],
          node["왜"],
          node["술기세트"],
          node["자침점용량"],
          node["검사명"],
          node["배제대상"],
          Array.isArray(node["후보"]) ? node["후보"].join(" ") : "",
          node["환자설명"],
          node["근거"],
          recId,
          recTitle,
        ]
          .join(" ")
          .toLowerCase();

        if (hay.includes(q)) {
          matchedSymptomCodes.add(code);
          if (layer === "L0") {
            directL0.push({ symCode: code, symName: sym.name, node, isDirect: true });
          } else {
            directOther.push({ symCode: code, symName: sym.name, node });
          }
        }
      });
    });

    // 만약 세부 검사/치료 키워드(예: 신바로, Ottawa)로 검색해 직접 매칭된 L0가 적다면, 매칭된 증상의 대표 호소 양상(L0) 카드도 상단에 함께 제시
    const seenL0Ids = new Set(directL0.map((x) => x.node.id));
    if (directL0.length === 0 && matchedSymptomCodes.size > 0) {
      matchedSymptomCodes.forEach((code) => {
        const sym = mergedTreeData["증상"][code];
        if (!sym || !sym.nodes) return;
        Object.values(sym.nodes)
          .filter((n) => getLayerFromNodeId(n.id) === "L0")
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .slice(0, 3)
          .forEach((l0Node) => {
            if (!seenL0Ids.has(l0Node.id)) {
              seenL0Ids.add(l0Node.id);
              directL0.push({ symCode: code, symName: sym.name, node: l0Node, isDirect: false });
            }
          });
      });
    }

    directL0.sort((a, b) => {
      if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
      return String(a.node.id).localeCompare(String(b.node.id));
    });

    directOther.sort((a, b) => String(a.node.id).localeCompare(String(b.node.id)));

    return { l0Matches: directL0, otherMatches: directOther };
  }

  function handleHomeHeroSearch(query) {
    const wrapEl = document.getElementById("home-search-results-wrap");
    const clearBtn = document.getElementById("btn-clear-home-search");
    const l0ListEl = document.getElementById("home-search-l0-list");
    const otherListEl = document.getElementById("home-search-other-list");
    const l0CountEl = document.getElementById("home-search-l0-count");
    const otherCountEl = document.getElementById("home-search-other-count");
    if (!wrapEl || !l0ListEl || !otherListEl) return;

    const q = (query || "").trim();
    if (clearBtn) clearBtn.hidden = q.length === 0;
    if (!q) {
      wrapEl.hidden = true;
      return;
    }

    const { l0Matches, otherMatches } = searchNodesWithL0Priority(q);
    wrapEl.hidden = false;
    if (l0CountEl) l0CountEl.textContent = `${l0Matches.length}건`;
    if (otherCountEl) otherCountEl.textContent = `${otherMatches.length}건`;

    l0ListEl.innerHTML = "";
    if (l0Matches.length === 0) {
      l0ListEl.innerHTML = `<p class="search-empty-msg">일치하는 호소 양상(L0) 카드가 없습니다.</p>`;
    } else {
      l0Matches.slice(0, 8).forEach(({ symCode, symName, node, isDirect }) => {
        const symNodes = mergedTreeData["증상"][symCode] ? mergedTreeData["증상"][symCode].nodes : {};
        const recId = node["추천문진"];
        const recNode = recId && symNodes[recId] ? symNodes[recId] : null;
        const cleanTitle = String(node["제목"] || "").replace(/^\[호소\]\s*/, "");

        const card = document.createElement("button");
        card.type = "button";
        card.className = "home-search-l0-card";
        card.innerHTML = `
          <div class="hsl0-top">
            <span class="hsl0-badge">🗣️ 호소 양상 (L0) ${isDirect ? "" : "· 연관 증상 진입"}</span>
            <span class="hsl0-sym">${escapeHtml(symName)} · ${escapeHtml(node.id)}</span>
          </div>
          <div class="hsl0-title">${escapeHtml(cleanTitle)}</div>
          ${node["질문"] ? `<div class="hsl0-quote">“${escapeHtml(node["질문"])}”</div>` : ""}
          <div class="hsl0-footer">
            <span>${
              recNode
                ? `🎯 맞춤 추천문진: ${escapeHtml(recId)} (${escapeHtml(recNode["제목"])})`
                : "🛡️ L1-01 레드플래그 확인 후 문진 시작"
            }</span>
            <span class="hsl0-go">이 호소로 진료 시작 →</span>
          </div>
        `;
        card.addEventListener("click", () => {
          chooseSymptomFromNav(symCode, node.id);
        });
        l0ListEl.appendChild(card);
      });
    }

    otherListEl.innerHTML = "";
    if (otherMatches.length === 0) {
      otherListEl.innerHTML = `<p class="search-empty-msg">일치하는 하위 문진·검사·감별·치료 카드가 없습니다.</p>`;
    } else {
      otherMatches.slice(0, 12).forEach(({ symCode, symName, node }) => {
        const ntype = node["유형"] || "ask";
        const summary =
          node["질문"] ||
          node["검사명"] ||
          node["술기세트"] ||
          node["환자설명"] ||
          (Array.isArray(node["후보"]) ? node["후보"].join(", ") : "") ||
          node["왜"] ||
          "";
        const card = document.createElement("button");
        card.type = "button";
        card.className = "home-search-other-card";
        card.innerHTML = `
          <div class="hso-top">
            <span class="node-type-badge type-${escapeHtml(ntype)}">${escapeHtml(
          TYPE_KOREAN[ntype] || ntype
        )}</span>
            <span class="hso-id">${escapeHtml(symName)} · ${escapeHtml(node.id)}</span>
          </div>
          <div class="hso-title">${escapeHtml(node["제목"])}</div>
          ${summary ? `<div class="hso-desc">${escapeHtml(summary)}</div>` : ""}
        `;
        card.addEventListener("click", () => {
          chooseSymptomFromNav(symCode, node.id);
        });
        otherListEl.appendChild(card);
      });
    }
  }

  /* ==================== 상단 빠른 검색 팝오버 (L0 최우선 정렬) ==================== */
  function handleQuickSearch(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q || !mergedTreeData) {
      nodeSearchSection.hidden = true;
      return;
    }

    const { l0Matches, otherMatches } = searchNodesWithL0Priority(q);
    const combined = [
      ...l0Matches.map((x) => Object.assign({}, x, { isL0: true })),
      ...otherMatches.map((x) => Object.assign({}, x, { isL0: false })),
    ];

    nodeSearchSection.hidden = false;
    nodeSearchGrid.innerHTML = "";
    if (combined.length === 0) {
      nodeSearchGrid.innerHTML = "<p style='color:#94a3b8; font-size:0.84rem;'>일치하는 카드가 없습니다.</p>";
      return;
    }

    combined.slice(0, 10).forEach(({ symCode, symName, node, isL0 }) => {
      const card = document.createElement("div");
      card.className = `routine-deck-item ${isL0 ? "search-item-l0-priority" : ""}`;
      const typeLabel = isL0 ? "🗣️ 호소 양상 (1순위 진입)" : TYPE_KOREAN[node["유형"]] || node["유형"];
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.74rem; color:#38bdf8; font-weight:800;">${escapeHtml(symName)} · ${escapeHtml(
            node.id
          )}</span>
          <span style="font-size:0.72rem; font-weight:800; color:${isL0 ? "#c4b5fd" : "#cbd5e1"};">${escapeHtml(
        typeLabel
      )}</span>
        </div>
        <strong style="font-size:0.9rem;">${escapeHtml(node["제목"])}</strong>
      `;
      card.addEventListener("click", () => {
        nodeSearchSection.hidden = true;
        searchInput.value = "";
        chooseSymptomFromNav(symCode, node.id);
      });
      nodeSearchGrid.appendChild(card);
    });
  }

  /* ==================== 이벤트 바인딩 ==================== */
  function bindEvents() {
    const btnModeHome = document.getElementById("btn-mode-home");
    const btnBrandHome = document.getElementById("btn-brand-home");
    if (btnModeHome) btnModeHome.addEventListener("click", () => switchMode("home"));
    if (btnBrandHome) btnBrandHome.addEventListener("click", () => switchMode("home"));

    document.getElementById("btn-mode-clinic").addEventListener("click", () => switchMode("clinic"));
    document.getElementById("btn-mode-setup").addEventListener("click", () => switchMode("setup"));

    // 홈 허브 중앙 검색창 & 추천 키워드 칩
    const homeHeroSearch = document.getElementById("home-hero-search");
    const btnClearHomeSearch = document.getElementById("btn-clear-home-search");
    if (homeHeroSearch) {
      homeHeroSearch.addEventListener("input", (e) => handleHomeHeroSearch(e.target.value));
    }
    if (btnClearHomeSearch && homeHeroSearch) {
      btnClearHomeSearch.addEventListener("click", () => {
        homeHeroSearch.value = "";
        handleHomeHeroSearch("");
        homeHeroSearch.focus();
      });
    }
    document.querySelectorAll(".quick-kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const kw = chip.getAttribute("data-kw") || "";
        if (homeHeroSearch) {
          homeHeroSearch.value = kw;
          handleHomeHeroSearch(kw);
          homeHeroSearch.focus();
        }
      });
    });

    // 표준 EMR 차트 모달 열기 버튼 (상단 컨트롤 바)
    const soapBtn = document.getElementById("btn-copy-soap-summary");
    if (soapBtn) {
      soapBtn.addEventListener("click", () => {
        openEmrChartModal("hospital");
      });
    }

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
    const copyComboBtn = document.getElementById("btn-copy-combo-orders");
    if (copyComboBtn) {
      copyComboBtn.addEventListener("click", () => {
        const sym = mergedTreeData["증상"][activeSymptomCode];
        const nodesMap = sym ? sym.nodes || {} : {};
        const selectedTreats = currentPath
          .map((id) => nodesMap[id])
          .filter((n) => n && (n["유형"] === "treat" || n["유형"] === "teach"));
        if (selectedTreats.length === 0) return;

        const lines = [`# [${sym.name}] 선택 진료 콤보 오더 (${selectedTreats.length}종)`];
        selectedTreats.forEach((n) => {
          if (n["유형"] === "treat") {
            lines.push(`\n## ${n.id} ${n["제목"]}`);
            lines.push(`- 술기 세트: ${n["술기세트"] || "-"}`);
            lines.push(`- 자침점·용량: ${n["자침점용량"] || "-"}`);
            lines.push(`- 빈도·기간: ${n["빈도"] || "-"} / ${n["기간"] || "-"}`);
            lines.push(`- 주의/금기: ${n["금기"] || "-"}`);
          } else {
            lines.push(`\n## ${n.id} [티칭] ${n["제목"]}`);
            lines.push(`- 환자 설명: ${n["환자설명"] || "-"}`);
            if (n["생활지도"]) lines.push(`- 생활 지도: ${n["생활지도"]}`);
          }
        });
        copyToClipboard(lines.join("\n"), `선택 치료 콤보 ${selectedTreats.length}종 전체 오더`);
      });
    }

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

    // 표준 EMR 의무기록 자동 작성 & 모달 이벤트
    document.getElementById("btn-clinic-ai-prompt").addEventListener("click", () => {
      copyToClipboard(generateAiPathConsultBrief(), "현재 카드 콤보 AI 3줄 점검 프롬프트");
    });

    document.getElementById("btn-qc-save").addEventListener("click", () => {
      openEmrChartModal("hospital");
    });

    const emrModal = document.getElementById("emr-chart-modal");
    const emrTextarea = document.getElementById("emr-chart-textarea");
    const btnCloseEmr = document.getElementById("btn-close-emr-modal");
    const btnEmrCopy = document.getElementById("btn-emr-copy");
    const btnEmrSaveCase = document.getElementById("btn-emr-save-case");

    if (btnCloseEmr && emrModal) {
      btnCloseEmr.addEventListener("click", () => {
        emrModal.hidden = true;
      });
    }
    if (emrModal) {
      emrModal.addEventListener("click", (ev) => {
        if (ev.target === emrModal) emrModal.hidden = true;
      });
    }
    document.querySelectorAll(".emr-fmt-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        currentEmrFormat = tab.getAttribute("data-emr-fmt") || "hospital";
        document.querySelectorAll(".emr-fmt-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const txt = generateStandardEmrChart(currentEmrFormat);
        if (emrTextarea) emrTextarea.value = txt;
        copyToClipboard(txt, "선택한 EMR 차트 양식");
      });
    });
    if (btnEmrCopy && emrTextarea) {
      btnEmrCopy.addEventListener("click", () => {
        copyToClipboard(emrTextarea.value, "편집된 EMR 의무기록");
      });
    }
    if (btnEmrSaveCase) {
      btnEmrSaveCase.addEventListener("click", async () => {
        await saveCurrentConsultToCaseLog();
      });
    }

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

      const maxRtNum = routinesList.reduce((acc, r) => {
        const m = String(r.id || "").match(/^RT-(\d+)$/);
        return m ? Math.max(acc, Number(m[1])) : acc;
      }, 0);
      const id = `RT-${String(maxRtNum + 1).padStart(2, "0")}`;
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
      const exportRoutines = getAvailableRoutines();
      const lines = ["# 내 진료 루틴 덱 모음", ""];
      exportRoutines.forEach((r) => {
        lines.push(`## ${r.id} [${r.symptom}] ${r.name}`);
        lines.push(`- **카드 콤보**: \`${(r.path || []).join(" → ")}\``);
        lines.push(`- **오더 메모**: ${r.orderMemo || "-"}`);
        lines.push("");
      });
      copyToClipboard(lines.join("\n"), `내 진료 루틴 덱 ${exportRoutines.length}개 md`);
    });

    // 스킬 등록 폼 드로어 토글
    const skillDrawer = document.getElementById("skill-form-drawer");
    const btnToggleSkillForm = document.getElementById("btn-toggle-skill-form");
    const btnCloseSkillForm = document.getElementById("btn-close-skill-form");
    if (btnToggleSkillForm && skillDrawer) {
      btnToggleSkillForm.addEventListener("click", () => {
        skillDrawer.hidden = !skillDrawer.hidden;
      });
    }
    if (btnCloseSkillForm && skillDrawer) {
      btnCloseSkillForm.addEventListener("click", () => {
        skillDrawer.hidden = true;
      });
    }

    // 스킬 도감 유형 필터
    document.querySelectorAll("#skill-type-filters .filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#skill-type-filters .filter-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        skillFilterType = btn.getAttribute("data-skill-type");
        renderSkillRegistry();
      });
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

    // 모바일 층별 빠른 이동 버튼
    const layerJumpBar = document.getElementById("mobile-layer-jump");
    if (layerJumpBar) {
      layerJumpBar.querySelectorAll(".layer-jump-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetLayer = btn.getAttribute("data-jump-layer");
          layerJumpBar.querySelectorAll(".layer-jump-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          scrollBoardToLayer(targetLayer);
        });
      });
    }

    // 모바일 증상 카테고리 바텀 시트 & 데스크톱 드롭다운 외부 클릭 닫기
    const mobilePickerBtn = document.getElementById("mobile-symptom-picker-btn");
    if (mobilePickerBtn) {
      mobilePickerBtn.addEventListener("click", openMobileSymptomSheet);
    }
    const closeSheetBtn = document.getElementById("btn-close-symptom-sheet");
    if (closeSheetBtn) {
      closeSheetBtn.addEventListener("click", closeMobileSymptomSheet);
    }
    const sheetBackdrop = document.getElementById("mobile-symptom-sheet-backdrop");
    if (sheetBackdrop) {
      sheetBackdrop.addEventListener("click", (ev) => {
        if (ev.target === sheetBackdrop) closeMobileSymptomSheet();
      });
    }
    const sheetSearch = document.getElementById("mobile-sheet-search");
    if (sheetSearch) {
      sheetSearch.addEventListener("input", (ev) => {
        renderMobileSymptomSheet(ev.target.value);
      });
    }
    document.addEventListener("click", () => {
      if (!gridEl) return;
      gridEl.querySelectorAll(".symptom-cat-group.open").forEach((g) => {
        g.classList.remove("open");
        const tb = g.querySelector(".symptom-cat-trigger");
        if (tb) tb.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeMobileSymptomSheet();
        if (nodeSearchSection) nodeSearchSection.hidden = true;
        return;
      }

      const tag = (ev.target && ev.target.tagName ? ev.target.tagName : "").toUpperCase();
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ev.target && ev.target.isContentEditable);
      if (isTyping) return;

      // '/' 또는 Ctrl+K 로 즉시 검색창 포커스
      if (ev.key === "/" || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k")) {
        ev.preventDefault();
        const homeSearch = document.getElementById("home-hero-search");
        if (currentMode === "home" && homeSearch) {
          homeSearch.focus();
        } else if (searchInput) {
          searchInput.focus();
        }
        return;
      }

      // 진료 보드 단축키: 1/2로 첫 번째·두 번째 분기 선택, Backspace로 한 칸 뒤로
      if (currentMode === "clinic" && teachModal && teachModal.hidden) {
        if (ev.key === "1" || ev.key === "2") {
          const branchBtns = nodeDetailContent ? nodeDetailContent.querySelectorAll(".btn-dock-branch") : [];
          const idx = ev.key === "1" ? 0 : 1;
          if (branchBtns[idx]) {
            ev.preventDefault();
            branchBtns[idx].click();
          }
        } else if (ev.key === "Backspace") {
          const undoBtn = document.getElementById("btn-path-undo");
          if (undoBtn && currentPath.length > 1) {
            ev.preventDefault();
            undoBtn.click();
          }
        }
      }
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

    const seedFlag = localStorage.getItem("clin7_seed_v16");
    if (savedSkills.length === 0 || seedFlag !== "done") {
      const skillMap = new Map(savedSkills.map((s) => [s.id, s]));
      for (const sk of DEFAULT_SKILLS) {
        if (!skillMap.has(sk.id) || seedFlag !== "done") {
          const existing = skillMap.get(sk.id);
          const mergedSk = Object.assign({}, sk, {
            level: existing && typeof existing.level === "number" ? existing.level : sk.level,
            count: existing && typeof existing.count === "number" ? existing.count : sk.count,
            linkedNodes: Array.from(
              new Set([...(sk.linkedNodes || []), ...(existing ? existing.linkedNodes || [] : [])])
            ),
          });
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
      localStorage.setItem("clin7_seed_v16", "done");
    } else {
      routinesList = savedRoutines;
    }

    casesList = savedCases;
    customNodesList = savedCustomNodes;

    try {
      const res = await fetch("./tree.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      baseTreeData = await res.json();
      rebuildMergedTree();

      if (generatedEl) generatedEl.textContent = baseTreeData.generated || "OK";

      populateSymptomSelects();
      renderClinicBoardMode();
      renderHomeHubMode();

      const sym = mergedTreeData["증상"][activeSymptomCode];
      if (sym && sym.entry && sym.nodes[sym.entry]) {
        loadNodeIntoEditor(activeSymptomCode, sym.nodes[sym.entry], false, "");
      }
    } catch (err) {
      gridEl.innerHTML = `<p style="color:red;">tree.json 로드 실패: ${escapeHtml(err.message || String(err))}</p>`;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    }
  }

  init();
})();
