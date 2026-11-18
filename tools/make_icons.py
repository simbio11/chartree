#!/usr/bin/env python3
"""
tools/make_icons.py — 차트나무(Chartree) PWA 아이콘 3종 생성기

생성 파일:
  - web/icons/icon-192.png (192x192, any)
  - web/icons/icon-512.png (512x512, any)
  - web/icons/icon-maskable-512.png (512x512, maskable — 중앙 80% 안전영역 내 배치)
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = WORKSPACE_ROOT / "web" / "icons"

BG_COLOR = "#0f172a"
FG_COLOR = "#e2e8f0"


def draw_tree_icon(size: int, padding_ratio: float) -> Image.Image:
    """3단 분기 나무(노드 트리) 도형을 4배 슈퍼샘플링으로 선명하게 그린다."""
    scale = 4
    hi = size * scale
    img = Image.new("RGBA", (hi, hi), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # 안전 영역 계산
    pad = hi * padding_ratio
    span = hi - 2 * pad
    cx = hi / 2.0

    def pt(nx: float, ny: float) -> tuple[float, float]:
        # 정규화 좌표 [0..1] -> 안전 영역 좌표
        return (pad + nx * span, pad + ny * span)

    # 3단 분기 노드 좌표 (아래 루트 -> 중간 2분기 -> 상단 3잎)
    root = pt(0.50, 0.86)
    trunk_mid = pt(0.50, 0.62)
    mid_left = pt(0.24, 0.44)
    mid_right = pt(0.76, 0.44)
    top_left = pt(0.16, 0.16)
    top_center = pt(0.50, 0.12)
    top_right = pt(0.84, 0.16)

    line_w = max(4, round(span * 0.085))
    node_r_root = span * 0.095
    node_r_mid = span * 0.085
    node_r_top = span * 0.080

    # 가지 연결선
    edges = [
        (root, trunk_mid),
        (trunk_mid, mid_left),
        (trunk_mid, mid_right),
        (mid_left, top_left),
        (mid_left, top_center),
        (mid_right, top_center),
        (mid_right, top_right),
    ]
    for p1, p2 in edges:
        draw.line([p1, p2], fill=FG_COLOR, width=line_w)

    # 노드 원
    nodes = [
        (root, node_r_root),
        (trunk_mid, node_r_mid * 0.72),
        (mid_left, node_r_mid),
        (mid_right, node_r_mid),
        (top_left, node_r_top),
        (top_center, node_r_top),
        (top_right, node_r_top),
    ]
    for (nx, ny), r in nodes:
        draw.ellipse([nx - r, ny - r, nx + r, ny + r], fill=FG_COLOR)

    # 중심 보정용 미세 다듬기 (LANCZOS 다운샘플)
    out = img.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
    return out


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    specs = [
        ("icon-192.png", 192, 0.16),
        ("icon-512.png", 512, 0.16),
        # maskable: 중앙 80% 안전영역(좌우상하 각 10% 여유) 안에 충분히 들어가도록 0.22 여백 사용
        ("icon-maskable-512.png", 512, 0.22),
    ]
    for filename, size, pad in specs:
        out_path = ICONS_DIR / filename
        img = draw_tree_icon(size, pad)
        img.save(out_path, format="PNG", optimize=True)
        print(f"[make_icons] generated: {out_path} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
