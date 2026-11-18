#!/usr/bin/env python3
"""
build_tree.py — CLIN-7 진료 프로토콜 파서 및 무결성 검사기 (M0)

입력:
  1순위: C:\\Simbio\\_임상\\프로토콜\\**\\*.md (00_스키마.md 등 허브/스키마 제외, 노드 포함 파일)
  2순위(폴백): 볼트에 노드가 0개일 때 scratch/fixture/**/*.md

출력:
  tree.json (지시서 §2 고정 계약 v1)

옵션:
  --check : id 중복·형식, 참조 무결성, 증상별 레드플래그 ask 노드 존재,
            dx 질환링크 볼트 파일 존재, 정본 근거/전원기준/환자설명,
            treat 전원기준, 환자 식별정보(전화번호·주민번호) 패턴 검사.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import re
import sys
from typing import Any

WORKSPACE_ROOT = Path(__file__).resolve().parent
VAULT_ROOT = Path(r"C:\Simbio")
VAULT_PROTOCOL_DIR = VAULT_ROOT / "_임상" / "프로토콜"
FIXTURE_DIR = WORKSPACE_ROOT / "scratch" / "fixture"
OUTPUT_JSON = WORKSPACE_ROOT / "tree.json"

SYMPTOM_NAMES: dict[str, str] = {
    # 기존·시범 구축 완료
    "HA": "두통",
    "DZ": "어지럼",
    "SH": "어깨 통증",
    # Tier 1: 한의원 외래 최다빈도 척추·관절 통증
    "LBP": "요통·허리통증",
    "NP": "목통증·항강",
    "KN": "무릎 통증",
    "AN": "발목 염좌·통증",
    "EL": "팔꿈치·손목 통증",
    "HN": "손저림·상지 방사통",
    "FTL": "발바닥·족부 통증",
    # Tier 2: 소화기·신경계 다빈도
    "DY": "소화불량",
    "AB": "복통",
    "FP": "안면마비(구안와사)",
    "TMJ": "턱관절 통증",
    # Tier 3: 수면·피로·이비인후·부인과·혈관/대사
    "SL": "불면",
    "FT": "만성 피로",
    "RH": "비염·기침",
    "TIN": "이명·난청",
    "DM": "월경통·갱년기",
    "ED": "부종",
}

NODE_ID_RE = re.compile(r"^([A-Z]{2,4})-(L[0-5]|S)-(\d{2,3})$")
HEADING_RE = re.compile(r"^##\s+([A-Z]{2,4}-(?:L[0-5]|S)-\d{2,3})(?:\s+(.*))?$")
YAML_BLOCK_RE = re.compile(r"```ya?ml\s*\n(.*?)\n```", re.DOTALL)

VALID_TYPES = {"ask", "test", "dx", "treat", "teach", "outcome", "skill"}
VALID_STATUS = {"초안", "검토", "정본"}
VALID_TRUST = {"상", "중", "하"}

# 비식별 검사: 전화번호(010-xxxx-xxxx) 및 주민등록번호(6자리-7자리)
PHONE_RE = re.compile(r"\b01[016789]-\d{3,4}-\d{4}\b")
RRN_RE = re.compile(r"\b\d{6}-[1-4]\d{6}\b")


def strip_inline_comment(line: str) -> str:
    """따옴표 밖의 # 주석을 제거한다."""
    in_single = False
    in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            if i == 0 or line[i - 1].isspace():
                return line[:i].rstrip()
    return line.rstrip()


def parse_scalar(val: str) -> Any:
    """YAML 스칼라/인라인 리스트/인라인 딕셔너리 파서 (표준 라이브러리 전용)."""
    val = val.strip()
    if val == "" or val in ("null", "~", "None"):
        return None
    if val == "true" or val == "True":
        return True
    if val == "false" or val == "False":
        return False
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1]
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        items = split_top_level(inner, ",")
        return [parse_scalar(x) for x in items]
    if val.startswith("{") and val.endswith("}"):
        inner = val[1:-1].strip()
        if not inner:
            return {}
        out: dict[str, Any] = {}
        for part in split_top_level(inner, ","):
            if ":" in part:
                k, v = part.split(":", 1)
                out[str(parse_scalar(k)).strip()] = parse_scalar(v)
        return out
    if re.fullmatch(r"-?\d+", val):
        return int(val)
    if re.fullmatch(r"-?\d+\.\d+", val):
        return float(val)
    return val


def split_top_level(text: str, sep: str = ",") -> list[str]:
    """괄호·따옴표 깊이를 고려해 최상위 구분자로 분리한다."""
    res: list[str] = []
    buf: list[str] = []
    depth = 0
    in_single = False
    in_double = False
    for ch in text:
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
            elif ch == sep and depth == 0:
                res.append("".join(buf).strip())
                buf = []
                continue
        buf.append(ch)
    if buf:
        res.append("".join(buf).strip())
    return res


def parse_simple_yaml(yaml_str: str) -> dict[str, Any]:
    """노드 frontmatter용 경량 YAML 파서 (1~2단계 들여쓰기 dict/list 지원)."""
    lines = yaml_str.splitlines()
    result: dict[str, Any] = {}
    i = 0
    n = len(lines)

    while i < n:
        raw_line = lines[i]
        cleaned = strip_inline_comment(raw_line)
        if not cleaned.strip():
            i += 1
            continue

        indent = len(cleaned) - len(cleaned.lstrip(" "))
        if indent != 0 or ":" not in cleaned:
            i += 1
            continue

        key, rest = cleaned.split(":", 1)
        key = key.strip()
        rest = rest.strip()

        if rest:
            result[key] = parse_scalar(rest)
            i += 1
            continue

        # 하위 블록 수집
        i += 1
        sub_list: list[Any] = []
        sub_dict: dict[str, Any] = {}
        mode: str | None = None

        while i < n:
            sub_raw = lines[i]
            sub_clean = strip_inline_comment(sub_raw)
            if not sub_clean.strip():
                i += 1
                continue
            sub_indent = len(sub_clean) - len(sub_clean.lstrip(" "))
            if sub_indent <= indent:
                break
            sub_stripped = sub_clean.strip()
            if sub_stripped.startswith("- "):
                mode = "list"
                sub_list.append(parse_scalar(sub_stripped[2:]))
            elif ":" in sub_stripped:
                mode = "dict"
                sk, sv = sub_stripped.split(":", 1)
                sub_dict[str(parse_scalar(sk)).strip()] = parse_scalar(sv)
            i += 1

        if mode == "list":
            result[key] = sub_list
        elif mode == "dict":
            result[key] = sub_dict
        else:
            result[key] = None

    return result


def build_vault_note_index(vault_root: Path) -> set[str]:
    """볼트 내 모든 .md 파일의 stem(파일명) 집합을 만든다 (질환링크 실존 확인용)."""
    stems: set[str] = set()
    if not vault_root.exists():
        return stems
    for md_path in vault_root.rglob("*.md"):
        stems.add(md_path.stem)
    return stems


def parse_markdown_file(md_path: Path, base_dir: Path) -> tuple[list[tuple[dict[str, Any], Path, int]], list[str]]:
    """
    단일 md 파일에서 `## <ID> <제목>` 섹션과 그 아래 yaml 블록을 추출한다.
    반환: ([(node_dict, md_path, line_no), ...], errors)
    """
    errors: list[str] = []
    text = md_path.read_text(encoding="utf-8")

    # PHI 패턴 검사 (파일 전체)
    if PHONE_RE.search(text):
        errors.append(f"[{md_path}] 식별정보(전화번호 패턴) 검출")
    if RRN_RE.search(text):
        errors.append(f"[{md_path}] 식별정보(주민등록번호 패턴) 검출")

    lines = text.splitlines()
    heading_positions: list[tuple[int, str, str]] = []

    in_code_block = False
    for idx, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        m = HEADING_RE.match(line.strip())
        if m:
            node_id = m.group(1).strip()
            heading_title = (m.group(2) or "").strip()
            heading_positions.append((idx, node_id, heading_title))

    nodes: list[tuple[dict[str, Any], Path, int]] = []
    rel_file = md_path.relative_to(base_dir).as_posix()

    for pos_idx, (start_line, heading_id, heading_title) in enumerate(heading_positions):
        end_line = heading_positions[pos_idx + 1][0] if pos_idx + 1 < len(heading_positions) else len(lines)
        section_lines = lines[start_line + 1 : end_line]
        section_text = "\n".join(section_lines).strip()

        ym = YAML_BLOCK_RE.search(section_text)
        if not ym:
            errors.append(f"[{rel_file}:{start_line + 1}] 노드 {heading_id} 아래에 yaml 코드블록이 없습니다.")
            continue

        yaml_content = ym.group(1)
        data = parse_simple_yaml(yaml_content)

        # yaml 블록을 제외한 나머지 마크다운 원문을 본문으로 저장
        body_text = (section_text[: ym.start()] + "\n" + section_text[ym.end() :]).strip()

        yaml_id = data.get("id")
        if not yaml_id:
            data["id"] = heading_id
        elif yaml_id != heading_id:
            errors.append(
                f"[{rel_file}:{start_line + 1}] 헤딩 ID({heading_id})와 YAML id({yaml_id})가 일치하지 않습니다."
            )

        if not data.get("제목") and heading_title:
            data["제목"] = heading_title

        data["본문"] = body_text
        data["파일"] = f"{rel_file}#{data['id']}"
        nodes.append((data, md_path, start_line + 1))

    return nodes, errors


def collect_target_files() -> tuple[Path, list[Path], bool]:
    """
    볼트 프로토콜 폴더에 노드 파일이 있으면 볼트를 읽고,
    없으면 scratch/fixture/를 읽는다.
    반환: (base_dir, md_files, using_fixture)
    """
    vault_files: list[Path] = []
    if VAULT_PROTOCOL_DIR.exists():
        for p in sorted(VAULT_PROTOCOL_DIR.rglob("*.md")):
            if p.name in ("00_스키마.md", "00_프로토콜_허브.md", "00_트리.md", "90_개정이력.md"):
                continue
            vault_files.append(p)

    if vault_files:
        return VAULT_PROTOCOL_DIR, vault_files, False

    fixture_files = sorted(FIXTURE_DIR.rglob("*.md")) if FIXTURE_DIR.exists() else []
    return FIXTURE_DIR, fixture_files, True


def extract_referenced_ids(next_field: Any) -> list[str]:
    """다음(다음 노드) 필드에서 참조된 모든 노드 ID 리스트를 추출한다."""
    if not next_field:
        return []
    if isinstance(next_field, list):
        return [str(x).strip() for x in next_field if x]
    if isinstance(next_field, dict):
        refs: list[str] = []
        for v in next_field.values():
            if isinstance(v, list):
                refs.extend(str(x).strip() for x in v if x)
            elif isinstance(v, str) and v.strip():
                refs.append(v.strip())
        return refs
    if isinstance(next_field, str) and next_field.strip():
        return [next_field.strip()]
    return []


def has_content(node: dict[str, Any], keys: list[str], body_keywords: list[str]) -> bool:
    """YAML 키 중 하나에 값이 있거나 본문에 키워드가 포함되어 있는지 확인한다."""
    for k in keys:
        val = node.get(k)
        if val is not None and str(val).strip() != "" and val != []:
            return True
    body = str(node.get("본문") or "")
    for kw in body_keywords:
        if kw in body:
            return True
    return False


def validate_nodes(
    all_nodes: list[tuple[dict[str, Any], Path, int]],
    vault_stems: set[str],
) -> list[str]:
    """00_스키마.md §3, §4, §8 및 지시서 §6의 lint 규칙을 모두 검사한다."""
    errors: list[str] = []
    seen_ids: dict[str, str] = {}
    nodes_by_id: dict[str, dict[str, Any]] = {}
    symptom_redflags: dict[str, int] = {}

    if not all_nodes:
        errors.append("파싱된 노드가 0개입니다.")
        return errors

    for node, md_path, line_no in all_nodes:
        loc = f"{md_path.name}:{line_no}"
        nid = str(node.get("id") or "").strip()

        # 1. id 중복 · 형식 위반
        m = NODE_ID_RE.match(nid)
        if not m:
            errors.append(f"[{loc}] 잘못된 노드 ID 형식: '{nid}' (규격: <증상코드>-L<0~5>-<번호>)")
            continue

        if nid in seen_ids:
            errors.append(f"[{loc}] 중복된 노드 ID: '{nid}' (기존 정의: {seen_ids[nid]})")
            continue

        seen_ids[nid] = loc
        nodes_by_id[nid] = node

        sym_code = m.group(1)
        symptom_redflags.setdefault(sym_code, 0)

        ntype = node.get("유형")
        if ntype not in VALID_TYPES:
            errors.append(f"[{loc} ({nid})] 유효하지 않은 유형: '{ntype}'")

        if not str(node.get("제목") or "").strip():
            errors.append(f"[{loc} ({nid})] '제목' 필드가 비어 있습니다.")

        status = node.get("상태", "초안")
        if status not in VALID_STATUS:
            errors.append(f"[{loc} ({nid})] 유효하지 않은 상태: '{status}'")

        trust = node.get("신뢰도", "상")
        if trust not in VALID_TRUST:
            errors.append(f"[{loc} ({nid})] 유효하지 않은 신뢰도: '{trust}'")

        # 유형별 필수 필드 검사 (00_스키마.md §3 & §8)
        if ntype == "ask":
            if not isinstance(node.get("레드플래그"), bool):
                errors.append(f"[{loc} ({nid})] ask 노드에 '레드플래그' (true/false) 필드가 없습니다.")
            elif node.get("레드플래그") is True:
                symptom_redflags[sym_code] += 1

            if not has_content(node, ["질문"], ["질문"]):
                errors.append(f"[{loc} ({nid})] ask 노드에 '질문'이 없습니다.")
            if not has_content(node, ["왜", "왜묻는가"], ["왜 묻는가", "왜:"]):
                errors.append(f"[{loc} ({nid})] ask 노드에 '왜(왜 묻는가)' 설명이 없습니다.")
            if not extract_referenced_ids(node.get("다음")):
                errors.append(f"[{loc} ({nid})] ask 노드에 예/아니오 '다음' 노드가 없습니다.")
            elif isinstance(node.get("다음"), dict):
                for b_key, b_val in node["다음"].items():
                    if isinstance(b_val, list) and len(b_val) > 1:
                        errors.append(
                            f"[{loc} ({nid})] ask 노드 분기 '{b_key}'에 다중 타겟({b_val})이 지정되어 중복 선택지가 생성됩니다. 분기당 1개 타겟만 지정하세요."
                        )

        elif ntype == "test":
            if "민감도특이도" in node:
                errors.append(f"[{loc} ({nid})] test 노드에 구식 키 '민감도특이도'가 있습니다. '민감도', '특이도', 'LR+', '대안검사'로 분리하세요.")
            if not has_content(node, ["검사명"], ["검사명"]):
                errors.append(f"[{loc} ({nid})] test 노드에 '검사명'이 없습니다.")
            if not has_content(node, ["배제대상", "배제"], ["무엇을 배제하는가", "배제"]):
                errors.append(f"[{loc} ({nid})] test 노드에 '무엇을 배제하는가(배제대상)'가 없습니다.")
            if not has_content(node, ["민감도"], []):
                errors.append(f"[{loc} ({nid})] test 노드에 '민감도'가 누락되었습니다.")
            if not has_content(node, ["특이도"], []):
                errors.append(f"[{loc} ({nid})] test 노드에 '특이도'가 누락되었습니다.")
            if not has_content(node, ["LR+"], []):
                errors.append(f"[{loc} ({nid})] test 노드에 'LR+'가 누락되었습니다.")
            if not has_content(node, ["대안검사"], []):
                errors.append(f"[{loc} ({nid})] test 노드에 '대안검사'가 누락되었습니다.")
            if isinstance(node.get("다음"), dict):
                seen_targets: dict[tuple[str, ...], str] = {}
                for b_key, b_val in node["다음"].items():
                    if isinstance(b_val, list) and len(b_val) > 1:
                        errors.append(
                            f"[{loc} ({nid})] test 노드 분기 '{b_key}'에 다중 타겟({b_val})이 지정되어 중복 선택지가 생성됩니다. 분기키를 분리하세요."
                        )
                    t_tuple = tuple(b_val) if isinstance(b_val, list) else (str(b_val),)
                    if t_tuple in seen_targets:
                        errors.append(
                            f"[{loc} ({nid})] test 노드 분기 '{b_key}'와 '{seen_targets[t_tuple]}'가 동일한 타겟({list(t_tuple)})을 가리킵니다."
                        )
                    else:
                        seen_targets[t_tuple] = b_key

        elif ntype == "dx":
            links = node.get("질환링크")
            if not links or not isinstance(links, list):
                errors.append(f"[{loc} ({nid})] dx 노드에 '질환링크' 리스트가 없습니다.")
            else:
                for raw_link in links:
                    s = str(raw_link).strip()
                    target = s.replace("[[", "").replace("]]", "").split("|")[0].split("#")[0].strip()
                    if not target:
                        errors.append(f"[{loc} ({nid})] 빈 질환링크가 있습니다.")
                    elif vault_stems and target not in vault_stems:
                        errors.append(f"[{loc} ({nid})] dx 질환링크 대상 파일이 볼트에 없습니다: [[{target}]]")

            if not has_content(node, ["위험감별"], ["놓치면 위험한 감별", "위험감별"]):
                errors.append(f"[{loc} ({nid})] dx 노드에 '놓치면 위험한 감별(위험감별)'이 없습니다.")

        elif ntype == "treat":
            if node.get("내숙련도") is None or not isinstance(node.get("내숙련도"), int) or not (0 <= node["내숙련도"] <= 5):
                errors.append(f"[{loc} ({nid})] treat 노드의 '내숙련도'(0~5 정수)가 누락되었거나 범위를 벗어났습니다.")
            for req_key in ("술기구분", "술기세트", "자침점용량", "빈도", "기간", "금기", "부작용"):
                if not has_content(node, [req_key], []):
                    errors.append(f"[{loc} ({nid})] treat 노드에 '{req_key}'가 누락되었습니다.")
            if not has_content(node, ["전원기준", "전원 기준"], ["전원 기준", "전원기준"]):
                errors.append(f"[{loc} ({nid})] treat 노드에 '전원 기준(전원기준)'이 누락되었습니다.")
            if not has_content(node, ["재평가시점", "재평가 시점"], ["재평가 시점", "재평가시점"]):
                errors.append(f"[{loc} ({nid})] treat 노드에 '재평가 시점'이 누락되었습니다.")

        elif ntype == "teach":
            if "금지사항" in node:
                errors.append(f"[{loc} ({nid})] teach 노드에 오기 키 '금지사항'이 있습니다. '하지말아야할것'으로 수정하세요.")
            if "전원기준보조" in node:
                errors.append(f"[{loc} ({nid})] teach 노드에 오기 키 '전원기준보조'가 있습니다.")
            if not has_content(node, ["환자설명", "환자 설명"], ["환자 설명"]):
                errors.append(f"[{loc} ({nid})] teach 노드에 '환자 설명'이 누락되었습니다.")
            for req_key in ("생활지도", "흔한오해", "하지말아야할것"):
                if not has_content(node, [req_key], []):
                    errors.append(f"[{loc} ({nid})] teach 노드에 '{req_key}'가 누락되었습니다.")

        elif ntype == "outcome":
            if node.get("내숙련도") is None or not isinstance(node.get("내숙련도"), int) or not (0 <= node["내숙련도"] <= 5):
                errors.append(f"[{loc} ({nid})] outcome 노드의 '내숙련도'(0~5 정수)가 누락되었거나 범위를 벗어났습니다.")
            if not has_content(node, ["측정지표", "측정 지표"], ["측정 지표"]):
                errors.append(f"[{loc} ({nid})] outcome 노드에 '측정 지표'가 누락되었습니다.")
            if not has_content(node, ["측정시점"], []):
                errors.append(f"[{loc} ({nid})] outcome 노드에 '측정시점'이 누락되었습니다.")
            if not has_content(node, ["판정기준"], []):
                errors.append(f"[{loc} ({nid})] outcome 노드에 '판정기준'이 누락되었습니다.")

        elif ntype == "skill":
            if node.get("내숙련도") is None or not isinstance(node.get("내숙련도"), int) or not (0 <= node["내숙련도"] <= 5):
                errors.append(f"[{loc} ({nid})] skill 노드의 '내숙련도'(0~5 정수)가 누락되었습니다.")

        # 5. 상태: 정본 승격 조건 검사 (00_스키마.md §4 & §8)
        if status == "정본":
            basis = str(node.get("근거") or "").strip()
            if not basis:
                errors.append(f"[{loc} ({nid})] 상태가 '정본'인데 '근거'가 비어 있습니다.")
            if not has_content(node, ["전원기준", "전원 기준"], ["전원 기준", "전원기준"]):
                errors.append(f"[{loc} ({nid})] 상태가 '정본'인데 '전원 기준'이 비어 있습니다.")
            if not has_content(node, ["환자설명", "환자 설명"], ["환자 설명"]):
                errors.append(f"[{loc} ({nid})] 상태가 '정본'인데 '환자 설명'이 비어 있습니다.")

    # 2. 상위 / 다음 참조 무결성 검사
    for nid, node in nodes_by_id.items():
        parent_id = node.get("상위")
        if parent_id:
            pid = str(parent_id).strip()
            if pid not in nodes_by_id:
                errors.append(f"[{nid}] '상위'가 존재하지 않는 노드를 참조합니다: '{pid}'")

        for ref_id in extract_referenced_ids(node.get("다음")):
            if ref_id not in nodes_by_id:
                errors.append(f"[{nid}] '다음'이 존재하지 않는 노드를 참조합니다: '{ref_id}'")

        rec_id = node.get("추천문진")
        if rec_id:
            rid = str(rec_id).strip().strip("[]")
            if rid not in nodes_by_id:
                errors.append(f"[{nid}] '추천문진'이 존재하지 않는 노드를 참조합니다: '{rid}'")

    # 3. 증상별 레드플래그 ask 노드가 최소 1개 이상인지 확인 + L0 도달성(BFS) 검사
    for sym_code, rf_count in symptom_redflags.items():
        if rf_count < 1:
            errors.append(f"[증상 {sym_code}] 레드플래그(레드플래그: true) ask 노드가 0개입니다.")

        sym_nodes = [nid for nid in nodes_by_id if nid.startswith(f"{sym_code}-")]
        l0_roots = [nid for nid in sym_nodes if "-L0-" in nid]
        if not l0_roots:
            errors.append(f"[증상 {sym_code}] L0 진입 노드가 없습니다.")
            continue
        visited: set[str] = set()
        queue = list(l0_roots)
        while queue:
            cur = queue.pop(0)
            if cur in visited or cur not in nodes_by_id:
                continue
            visited.add(cur)
            cur_node = nodes_by_id[cur]
            for nxt in extract_referenced_ids(cur_node.get("다음")):
                if nxt not in visited:
                    queue.append(nxt)
            rec = cur_node.get("추천문진")
            if rec:
                rid = str(rec).strip().strip("[]")
                if rid not in visited:
                    queue.append(rid)
        unreachable = sorted(nid for nid in sym_nodes if nid not in visited)
        if unreachable:
            errors.append(f"[증상 {sym_code}] L0에서 도달할 수 없는 고아 노드: {unreachable}")

    return errors


def assemble_tree_json(all_nodes: list[tuple[dict[str, Any], Path, int]]) -> dict[str, Any]:
    """지시서 §2 고정 계약 형식 그대로 tree.json 구조를 조립한다."""
    kst = timezone(timedelta(hours=9))
    now_iso = datetime.now(kst).isoformat(timespec="seconds")

    symptoms: dict[str, dict[str, Any]] = {}

    for node, md_path, _ in all_nodes:
        nid = str(node["id"])
        m = NODE_ID_RE.match(nid)
        if not m:
            continue
        sym_code = m.group(1)

        if sym_code not in symptoms:
            # 폴더명이나 파일명에서 한글 증상명을 추론하되 기본 매핑 우선
            sym_name = SYMPTOM_NAMES.get(sym_code, md_path.stem)
            symptoms[sym_code] = {
                "name": sym_name,
                "entry": "",
                "nodes": {},
            }

        symptoms[sym_code]["nodes"][nid] = node

    # 각 증상의 entry 노드 결정 (L0 우선 -> 상위 없는 첫 노드 -> 정렬 첫 노드)
    for sym_code, sym_obj in symptoms.items():
        node_ids = sorted(sym_obj["nodes"].keys())
        l0_ids = [x for x in node_ids if "-L0-" in x]
        root_ids = [x for x in node_ids if not sym_obj["nodes"][x].get("상위")]
        if l0_ids:
            sym_obj["entry"] = l0_ids[0]
        elif root_ids:
            sym_obj["entry"] = root_ids[0]
        elif node_ids:
            sym_obj["entry"] = node_ids[0]

    return {
        "generated": now_iso,
        "증상": symptoms,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="CLIN-7 프로토콜 파서 및 무결성 검사기")
    parser.add_argument("--check", action="store_true", help="스키마 및 참조 무결성 검사를 수행하고 위반 시 1을 반환")
    args = parser.parse_args()

    base_dir, md_files, using_fixture = collect_target_files()
    source_label = f"fixture ({base_dir})" if using_fixture else f"vault ({base_dir})"

    all_nodes: list[tuple[dict[str, Any], Path, int]] = []
    parse_errors: list[str] = []

    for md_path in md_files:
        nodes, errs = parse_markdown_file(md_path, base_dir)
        all_nodes.extend(nodes)
        parse_errors.extend(errs)

    vault_stems = build_vault_note_index(VAULT_ROOT)
    lint_errors = validate_nodes(all_nodes, vault_stems)
    total_errors = parse_errors + lint_errors

    tree_data = assemble_tree_json(all_nodes)
    OUTPUT_JSON.write_text(json.dumps(tree_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sym_summary = ", ".join(
        f"{code}({info['name']}: {len(info['nodes'])}개, entry={info['entry']})"
        for code, info in tree_data["증상"].items()
    )
    print(f"[build_tree] 소스: {source_label}")
    print(f"[build_tree] 파일 {len(md_files)}개 파싱 → 총 노드 {len(all_nodes)}개 → {OUTPUT_JSON.name} 생성 완료")
    print(f"[build_tree] 증상 목록: {sym_summary}")

    if total_errors:
        print(f"[build_tree] FAIL — 오류 {len(total_errors)}건 검출:", file=sys.stderr)
        for err in total_errors:
            print(f"  - {err}", file=sys.stderr)
        if args.check:
            return 1
    else:
        print("[build_tree] PASS — 무결성 검사 통과 (오류 0건)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
