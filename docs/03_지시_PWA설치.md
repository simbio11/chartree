---
name: PWA 설치 요건 보완 지시
status: 대기
대상: 안티그래비티(아르곤)
배치: 1회 (파일 5개)
출처: 비오님 2026-11-18 "안티에게 지시 문구로 넘기기"
---

# 지시 — 차트나무를 실제 설치 가능한 PWA로 만들기

현재 상태: manifest·서비스워커는 있으나 `icons: []` 이라 크롬이 설치를 제안하지 않음. 이름도 구 이름(`진료 프로토콜 뷰`)으로 남아 있음.

## 할 일 (순서대로)

1. `web/icons/` 폴더 생성 후 아이콘 3개를 Pillow로 생성
   - `icon-192.png` (192×192), `icon-512.png` (512×512), `icon-maskable-512.png` (512×512)
   - 배경 `#0f172a` 단색, 전경은 밝은 회백색(`#e2e8f0`) 단순 도형 — 나무가 위로 갈라지는 형태 또는 노드 3단 분기
   - maskable은 안전영역(중앙 80%) 안에만 그림. 글자·작은 디테일 금지
   - 생성 스크립트는 `tools/make_icons.py`로 저장소에 커밋(재현 가능하게). Pillow 12.3.0 사용 가능
2. `web/manifest.json` 수정
   - `name: "차트나무"`, `short_name: "차트나무"`, `description: "증상 분기 진료 프로토콜 뷰어"`
   - `id`, `scope`, `start_url` 모두 `"/"`
   - `icons` 3개 등록 — 192(`any`), 512(`any`), 512(`maskable`)
   - `display: standalone`, `background_color`·`theme_color` `#0f172a`, `lang: ko-KR` 유지
3. `web/sw.js`
   - `CACHE_NAME` → `"chartree-shell-v2"`
   - `ASSETS`에 아이콘 3개 경로 추가
4. `verify_app.py`에 6번째 검사 추가
   - manifest의 `icons` 배열이 비어 있지 않은가
   - 각 아이콘 파일이 실제로 존재하고, Pillow로 열어 가로·세로가 선언값과 같은가
   - 192 이상 아이콘이 최소 1개 존재하는가
5. `web/index.html`은 아이콘 참조 1줄만 허용
   - `<link rel="apple-touch-icon" href="/icons/icon-192.png">` 추가 가능
   - 그 외 마크업·스크립트 수정 금지

## 금지

- `app.js` 로직 수정 금지 (설치 요건과 무관)
- 외부 CDN·아이콘 URL 금지 — 아이콘은 반드시 저장소 안 파일
- `C:\Simbio` 볼트 쓰기 금지
- HTTPS·포트·테일스케일 설정 건드리지 말 것 (아린 담당)

## 완료 조건

- `python verify_app.py` 실행해 **6/6 PASS** 출력을 그대로 붙일 것
- 커밋 1개(`PWA: 아이콘·manifest·SW 캐시 v2 + 검증 6항목`)로 마무리
- 보고에 포함: 생성한 아이콘 파일 3개 경로, manifest 최종 내용, verify 출력 전문
