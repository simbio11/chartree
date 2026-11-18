#!/usr/bin/env python3
"""
verify_app.py — CLIN-7 진료 프로토콜 뷰 & 진화형 워크벤치 자동 검증 스크립트 (M0~M3 통합)

검증 항목:
1. build_tree.py --check 통과 확인 (exit 0)
2. 127.0.0.1:8765 HTTP 서버 응답 확인 (이미 떠 있으면 재사용, 아니면 임시 기동)
3. GET / (index.html), /app.js, /style.css, /tree.json, /manifest.json, /sw.js → HTTP 200
4. tree.json 고정 계약(§2) 파싱 및 깨진 참조 0건 확인
5. M1~M3 + 진화형 워크벤치 핵심 UI 컴포넌트 존재 및 외부 CDN 0건 확인
6. manifest.json 아이콘 3종 존재 · Pillow 실측 크기 일치 · 192px 이상 존재 확인
"""

from __future__ import annotations

from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from typing import Any
from urllib.request import urlopen

from PIL import Image

import build_tree
import serve

WORKSPACE_ROOT = Path(__file__).resolve().parent
WEB_DIR = WORKSPACE_ROOT / "web"
HOST = "127.0.0.1"
PORT = 8765
BASE_URL = f"http://{HOST}:{PORT}"


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def start_temp_server() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((HOST, PORT), serve.ProtocolRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    for _ in range(20):
        if is_port_open(HOST, PORT):
            break
        time.sleep(0.1)
    return server


def fetch_endpoint(path: str) -> tuple[int, bytes]:
    url = f"{BASE_URL}{path}"
    with urlopen(url, timeout=5) as resp:
        return resp.status, resp.read()


def verify_tree_contract(tree_obj: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if not isinstance(tree_obj, dict):
        return ["tree.json 최상위 구조가 객체(dict)가 아닙니다."]

    if "generated" not in tree_obj or not isinstance(tree_obj["generated"], str):
        errors.append("tree.json에 'generated' 타임스탬프 문자열이 없습니다.")

    symptoms = tree_obj.get("증상")
    if not isinstance(symptoms, dict) or len(symptoms) == 0:
        errors.append("tree.json에 '증상' 객체가 비어 있습니다.")
        return errors

    for sym_code, sym_data in symptoms.items():
        if not isinstance(sym_data, dict):
            errors.append(f"[증상 {sym_code}] 값이 객체가 아닙니다.")
            continue

        for req_key in ("name", "entry", "nodes"):
            if req_key not in sym_data:
                errors.append(f"[증상 {sym_code}] 필수 키 '{req_key}' 누락")

        nodes = sym_data.get("nodes")
        if not isinstance(nodes, dict) or len(nodes) == 0:
            errors.append(f"[증상 {sym_code}] nodes가 비어 있습니다.")
            continue

        entry_id = sym_data.get("entry")
        if entry_id not in nodes:
            errors.append(f"[증상 {sym_code}] entry('{entry_id}')가 nodes에 존재하지 않습니다.")

        for nid, node in nodes.items():
            for req_field in ("id", "유형", "제목", "상태", "신뢰도", "본문", "파일"):
                if req_field not in node:
                    errors.append(f"[{nid}] 필수 필드 '{req_field}' 누락")

            parent_id = node.get("상위")
            if parent_id and parent_id not in nodes:
                errors.append(f"[{nid}] 깨진 상위 참조: '{parent_id}'")

            for ref_id in build_tree.extract_referenced_ids(node.get("다음")):
                if ref_id not in nodes:
                    errors.append(f"[{nid}] 깨진 다음 참조: '{ref_id}'")

    return errors


def verify_no_external_cdn_and_features() -> list[str]:
    errors: list[str] = []
    forbidden_patterns = ("https://", "http://", "//cdn", "googleapis.com", "jsdelivr", "unpkg")
    for p in (WEB_DIR / "index.html", WEB_DIR / "style.css", WEB_DIR / "app.js"):
        if not p.exists():
            errors.append(f"필수 정적 파일 누락: {p}")
            continue
        content = p.read_text(encoding="utf-8")
        for pat in forbidden_patterns:
            if pat in content:
                errors.append(f"[{p.name}] 외부 URL/CDN 패턴('{pat}') 검출")

    html_content = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    required_ids = (
        "symptom-grid",
        "tree-columns",
        "node-detail-panel",
        "pathway-bar",
        "skill-add-form",
        "case-record-form",
        "node-editor-form",
        "patient-teach-modal",
    )
    for req_id in required_ids:
        if req_id not in html_content:
            errors.append(f"[index.html] 필수 UI 컴포넌트 ID 누락: #{req_id}")

    js_content = (WEB_DIR / "app.js").read_text(encoding="utf-8")
    if "indexedDB" not in js_content:
        errors.append("[app.js] IndexedDB 로컬 저장소 구현이 없습니다.")

    return errors


def verify_pwa_icons() -> tuple[list[str], list[str]]:
    """manifest.json 아이콘 배열·실제 PNG 파일·Pillow 크기·192px 이상 조건을 검사한다."""
    errors: list[str] = []
    icon_paths: list[str] = []
    manifest_path = WEB_DIR / "manifest.json"
    if not manifest_path.exists():
        return ["web/manifest.json이 존재하지 않습니다."], icon_paths

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"manifest.json 파싱 실패: {exc}"], icon_paths

    icons = manifest.get("icons")
    if not isinstance(icons, list) or len(icons) == 0:
        errors.append("manifest.json의 'icons' 배열이 비어 있습니다.")
        return errors, icon_paths

    has_192_plus = False
    for idx, icon in enumerate(icons):
        if not isinstance(icon, dict):
            errors.append(f"manifest.icons[{idx}]가 객체가 아닙니다.")
            continue
        src = str(icon.get("src") or "").strip()
        sizes_str = str(icon.get("sizes") or "").strip()
        if not src:
            errors.append(f"manifest.icons[{idx}]의 'src'가 비어 있습니다.")
            continue

        rel_src = src.lstrip("/")
        if rel_src.startswith("./"):
            rel_src = rel_src[2:]
        icon_file = WEB_DIR / rel_src
        icon_paths.append("/" + rel_src)

        if not icon_file.exists() or not icon_file.is_file():
            errors.append(f"아이콘 파일이 존재하지 않습니다: {icon_file}")
            continue

        if "x" not in sizes_str:
            errors.append(f"[{src}] 잘못된 sizes 형식: '{sizes_str}'")
            continue

        try:
            decl_w_s, decl_h_s = sizes_str.lower().split("x", 1)
            decl_w, decl_h = int(decl_w_s), int(decl_h_s)
        except ValueError:
            errors.append(f"[{src}] sizes 정수 변환 실패: '{sizes_str}'")
            continue

        try:
            with Image.open(icon_file) as im:
                actual_w, actual_h = im.size
        except Exception as exc:
            errors.append(f"[{src}] Pillow 이미지 열기 실패: {exc}")
            continue

        if (actual_w, actual_h) != (decl_w, decl_h):
            errors.append(
                f"[{src}] 크기 불일치: 선언={decl_w}x{decl_h}, 실제={actual_w}x{actual_h}"
            )
        if actual_w >= 192 and actual_h >= 192:
            has_192_plus = True

    if not has_192_plus:
        errors.append("192x192 이상 크기의 PWA 아이콘이 최소 1개 필요합니다.")

    return errors, icon_paths


def main() -> int:
    errors: list[str] = []

    # 1. build_tree.py --check 실행
    proc = subprocess.run(
        [sys.executable, str(WORKSPACE_ROOT / "build_tree.py"), "--check"],
        cwd=str(WORKSPACE_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        errors.append(f"build_tree.py --check 실패 (exit {proc.returncode}):\n{proc.stderr.strip()}")
    else:
        print("[verify_app] 1/6 build_tree.py --check 통과 (exit 0)")

    # 2. 정적 파일·PWA·M0~M3 기능 컴포넌트 및 외부 CDN 금지 확인
    for rel_path in ("web/index.html", "web/app.js", "web/style.css", "web/manifest.json", "web/sw.js", "tree.json"):
        full_path = WORKSPACE_ROOT / rel_path
        if not full_path.exists():
            errors.append(f"필수 파일이 존재하지 않습니다: {rel_path}")
    errors.extend(verify_no_external_cdn_and_features())
    if not errors:
        print("[verify_app] 2/6 정적 웹 파일 · PWA · M0~M3(트리·스킬·케이스·가지치기·AI협업) UI 존재 및 외부 CDN 0건 확인")

    # 3. PWA 아이콘 3종 존재 · Pillow 크기 일치 확인
    icon_errors, icon_endpoints = verify_pwa_icons()
    errors.extend(icon_errors)
    if not icon_errors:
        print(f"[verify_app] 3/6 PWA manifest icons 검증 통과 ({len(icon_endpoints)}종, Pillow 실측 일치)")

    # 4. HTTP 서버 기동(또는 기존 서버 연결) 및 엔드포인트 200 검사
    temp_server: ThreadingHTTPServer | None = None
    already_running = is_port_open(HOST, PORT)
    if not already_running:
        temp_server = start_temp_server()

    tree_payload: dict[str, Any] = {}
    endpoints = ["/", "/index.html", "/app.js", "/style.css", "/manifest.json", "/sw.js", "/tree.json", *icon_endpoints]
    try:
        for ep in endpoints:
            try:
                status, body = fetch_endpoint(ep)
                if status != 200:
                    errors.append(f"GET {ep} 응답 코드 불일치: {status} (기대값 200)")
                elif len(body) == 0:
                    errors.append(f"GET {ep} 응답 본문이 비어 있습니다.")
                if ep == "/tree.json" and status == 200:
                    tree_payload = json.loads(body.decode("utf-8"))
            except Exception as exc:
                errors.append(f"GET {ep} 요청 실패: {exc}")
    finally:
        if temp_server is not None:
            temp_server.shutdown()
            temp_server.server_close()

    if not errors:
        print(f"[verify_app] 4/6 HTTP {BASE_URL} 엔드포인트 {len(endpoints)}종 모두 HTTP 200 확인")

    # 5. tree.json 계약 및 깨진 참조 0건 확인
    contract_errors = verify_tree_contract(tree_payload)
    errors.extend(contract_errors)
    if not contract_errors:
        sym_codes = list(tree_payload.get("증상", {}).keys())
        total_nodes = sum(len(v.get("nodes", {})) for v in tree_payload.get("증상", {}).values())
        print(f"[verify_app] 5/6 tree.json 파싱 및 계약 검증 통과 (증상={sym_codes}, 총 노드={total_nodes}개, 깨진 참조=0건)")

    # 6. 최종 결과 출력
    if errors:
        print(f"[verify_app] FAIL — 총 {len(errors)}건 실패:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("[verify_app] 6/6 PASS — 모든 검증 항목 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
