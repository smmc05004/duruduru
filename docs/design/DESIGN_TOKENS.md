# DURUDURU 디자인 토큰

확정 방향 H의 값이다. 방향의 배경은 `docs/design/DESIGN_DIRECTION.md`에 있다.

이 문서가 정의이고 `app/tokens.css`가 코드 반영이다. 한쪽만 고치지 않는다. 여기 없는 색·크기를 화면에서 새로 만들지 않는다.

> 아래 색·형태·서체 토큰은 `app/tokens.css`의 `:root`에 반영돼 있고, 컴포넌트 스타일은 `app/globals.css`에 있다. PoC 시절 토큰(Pretendard·Nanum Myeongjo·DM Mono, 크림/딥그린)과 PoC 전용 클래스는 제거했다.

## 색

| 토큰 | 값 | 용도 |
| --- | --- | --- |
| `--paper` | `#efe9d5` | 화면 바탕 |
| `--paper-dot` | `#d9d0b3` | 바탕 점 패턴 (16px 간격, 1px) |
| `--card` | `#fbf8ee` | 카드 표면 |
| `--card-muted` | `#f4f0e2` | 비활성·탈락 카드 표면 |
| `--ink` | `#2b2a1d` | 제목, 기본 텍스트 |
| `--ink-body` | `#3d3a2c` | 본문 |
| `--ink-muted` | `#6b6550` | 보조 정보 |
| `--ink-faint` | `#8a8368` | 각주, 고지 문구 |
| `--line` | `#33301f` | 카드 테두리 (2px) |
| `--line-dashed` | `#a8a081` | 탈락·비활성 카드 테두리 (2px dashed) |
| `--shadow` | `#cfc5a4` | 하드 섀도 (5px 5px 0) |
| `--olive` | `#4a6b2f` | 주요 강조, 배지 바탕 |
| `--olive-ink` | `#3f6b2b` | 올리브 계열 텍스트 |
| `--olive-bar` | `#6c9b4a` | 시간 막대의 체류 구간 |
| `--olive-soft` | `#e6efd8` | 태그 바탕 |
| `--mustard` | `#e0b743` | 관심사·기간 배지 |
| `--mustard-soft` | `#f7e6b8` | 축제 태그 바탕 |
| `--mustard-ink` | `#7a5710` | 머스터드 계열 텍스트 |
| `--terracotta` | `#c1502e` | 추천 라벨(손글씨) 바탕 |
| `--track` | `#e7e1cd` | 시간 막대 바탕 |
| `--track-move` | `#c3b998` | 시간 막대의 이동 구간 |
| `--field` | `#fdfcf6` | 입력 필드·셀렉트 표면 (카드보다 한 단 밝게) |
| `--on-dark` | `#f6f2e5` | 올리브·자적색 바탕 위의 글자 |
| `--skeleton` | `#ded8c2` | 로딩 자리표시 블록 |
| `--alert` | `#8c2140` | 검증 오류·데이터 장애 |
| `--alert-soft` | `#f4dcdf` | 장애 배너 바탕 |
| `--alert-ink` | `#6f1a33` | 오류·장애 텍스트, 이중 테두리 안쪽 선 |

파생이 필요하면 기존 토큰에서 명도를 조정하는 것을 기본으로 하고, 의미가 충돌해 색을 구분해야 할 때만 색상까지 옮긴다. 어느 쪽이든 파생 규칙을 아래 표에 적고 새 토큰으로 등록한 뒤 쓴다.

### 새로 파생한 토큰의 근거

| 토큰 | 파생 규칙 |
| --- | --- |
| `--field` | `--card`(#fbf8ee)에서 명도만 +1.5%. 카드 위에 놓인 입력면이 카드보다 한 단 밝아야 눌리는 자리로 읽힌다 |
| `--on-dark` | `--paper`(#efe9d5)에서 명도 +3%. 올리브·자적색 바탕에서 흰색보다 종이 톤이 방향 H에 맞는다 |
| `--skeleton` | `--track`(#e7e1cd)에서 명도 −3%. 카드 표면 위에서 구분되지만 내용으로 오인되지 않는 최소 대비 |
| `--alert` | `--terracotta`(#c1502e)에서 **색상을 적자 방향으로 약 25° 돌리고 명도를 −18%, 채도를 올림**. 명도만 낮추면 테라코타의 어두운 변종으로 보여, 추천 라벨과 장애가 같은 색으로 읽힌다. 색상까지 옮겨야 구분된다 |
| `--alert-soft` | `--alert`를 `--paper` 위에 12% 농도로 얹은 값 |
| `--alert-ink` | `--alert`에서 명도 −12%. 자적색 바탕 위 텍스트 대비 확보용 |

**`--terracotta`와 `--alert`는 절대 서로 대체하지 않는다.** `--terracotta`는 추천 라벨(손글씨 스티커) 한 곳에만, `--alert`는 검증 오류와 데이터 장애에만 쓴다. 이 둘이 같은 색이면 "가장 잘 맞아요"와 "불러오지 못했어요"가 같은 신호가 된다.

## 타이포그래피

| 역할 | 서체 | 크기 / 굵기 |
| --- | --- | --- |
| 화면 제목 | Jua | 25px / 400 (line-height 1.42) |
| 카드 제목 | Jua | 34px / 400 (line-height 1.15) |
| 강조 라벨 | Gaegu | 16px / 700 — 화면당 한 곳 |
| 본문 | Gothic A1 | 14px / 500 (line-height 1.7) |
| 보조 정보 | Gothic A1 | 12px / 600 |
| 태그·배지 | Gothic A1 | 11px / 600 |
| 각주 | Gothic A1 | 11px / 500 (line-height 1.7) |
| 수치 강조 | Gothic A1 | 20~21px / 800 |

- Jua, Gaegu, Gothic A1 모두 Google Fonts(OFL)다. 웹폰트 링크로 불러온다.
- 폴백은 `system-ui, 'Apple SD Gothic Neo', sans-serif`. 자간이 크게 달라지므로 제목 줄바꿈은 폴백에서도 확인한다.
- **Gaegu를 본문·수치에 쓰지 않는다.** 획이 얇아 작은 크기에서 무너진다. C안이 탈락한 원인이다.

## 간격·형태

| 토큰 | 값 |
| --- | --- |
| 화면 좌우 여백 | 18px (카드 영역), 20~22px (텍스트 영역) |
| 카드 내부 여백 | 20px |
| 카드 사이 간격 | 16px |
| 카드 테두리 | 2px solid `--line` |
| 카드 그림자 | `5px 5px 0 --shadow` |
| 라디우스 — 카드 | 0 |
| 라디우스 — 태그·칩 | 99px (조건 칩), 2px (장소 태그) |
| 라디우스 — 시간 막대 | 99px, 높이 10px |
| 최소 터치 영역 | 44px |

## 컴포넌트

### 목적지 카드

| 상태 | 표현 |
| --- | --- |
| 기본 | `--card` 바탕, 2px `--line` 테두리, 하드 섀도 |
| 추천 | 좌상단에 손글씨 라벨(`--terracotta` 바탕, -3deg 회전) |
| 탈락·비활성 | `--card-muted` 바탕, 2px dashed `--line-dashed`, 텍스트를 `--ink-muted`로 |

구성 순서: 지명(Jua) + 행정구역 → 시간 막대 → 설명 → 태그.

### 시간 막대

이동 / 체류 / 이동 비율을 한 줄로 보여준다. 양끝은 `--track-move`, 가운데는 `--olive-bar`. 아래에 `이동 3:30` · `머무는 시간 29시간` · `이동 3:30`을 배치하고 가운데 값만 굵게 강조한다.

### 태그

- 장소 태그 — `--olive-soft` 바탕, `--olive-ink` 텍스트, 라디우스 2px
- 축제 태그 — `--mustard-soft` 바탕, `--mustard-ink` 텍스트
- 조건 칩 — 흰 바탕, 1.5px `--olive` 테두리, 라디우스 99px
- 선택된 관심사 칩 — `--mustard` 바탕

### 입력 필드

| 상태 | 표현 |
| --- | --- |
| 기본 | `--field` 바탕, 2px solid `--line`, 라디우스 0, 최소 높이 48px. 라벨은 12px/700 `--ink-body`, 값은 15px/700 `--ink` |
| 입력 중 (포커스) | 테두리 2.5px `--olive` + 바깥 3px `--olive-soft` 링(`box-shadow: 0 0 0 3px`). 라벨을 `--olive-ink`로 |
| 오류 | 테두리 2px `--alert`, 라벨·값을 `--alert-ink`로. 필드 바로 아래 12px/600 `--alert-ink` 메시지 + 15px ✕ 원형 아이콘 |
| 비활성 | `--card-muted` 바탕, 2px dashed `--line-dashed`, 값 자리는 `--skeleton` 블록 |
| 미선택(placeholder) | 값 자리에 `--ink-faint` 안내 문구 |

셀렉트는 입력 필드와 같은 상태 집합을 쓰고 오른쪽에 18px 아래꺾쇠 SVG를 둔다. 상태색이 바뀌면 꺾쇠 색도 함께 바뀐다.

검증 오류 표현의 규칙:

- 오류는 **항목 단위**로 붙인다. 화면 상단에 요약 배너(2px `--alert` 테두리, `--alert-soft` 바탕)를 두고 개수를 적되, 배너만으로 어느 항목인지 알 수 있게 하지 않는다.
- 오류 메시지는 무엇을 어떻게 고치면 되는지까지 적는다.
- 오류가 남아 있으면 제출 버튼을 비활성으로 두고 그 이유를 버튼 아래 11px/600 `--ink-faint`로 적는다.
- 검증 오류는 **데이터 장애와 형태로 구분**한다. 검증 오류는 자적색을 쓰되 상단 8px 띠와 3px 이중 테두리를 쓰지 않는다. 그 두 형태는 장애 전용이다.

### 세그먼티드 컨트롤

한 줄에 2~3칸. 바깥 테두리 2px `--line`, 칸 사이 구분선 2px `--line`, 각 칸 최소 높이 46px.

| 상태 | 표현 |
| --- | --- |
| 선택 | `--olive` 바탕, `--on-dark` 글자 14px/700 |
| 미선택 | `--field` 바탕, `--ink` 글자 14px/600 |
| 비활성 | `--card-muted` 바탕, `--ink-faint` 글자, 왼쪽 구분선을 `--line-dashed`로 |

비활성 칸에는 왜 고를 수 없는지 컨트롤 아래 11px/500 `--ink-faint`로 적는다.

### 버튼

| 변형 | 표현 |
| --- | --- |
| 주요 | `--olive` 바탕, 2px `--line` 테두리, `5px 5px 0 --shadow`, Jua 18~19px, `--on-dark` 글자, 최소 높이 56px |
| 보조 | `--card` 바탕, 2px `--line`, 하드 섀도 동일, Gothic A1 15px/700 `--ink`, 최소 높이 52px |
| 비활성 | `--card-muted` 바탕, 2px dashed `--line-dashed`, `--ink-faint` 글자, **섀도 없음** |
| 장애 복구 | `--alert` 바탕, 2px `--alert-ink` 테두리, `--on-dark` 글자. 데이터 장애 화면의 재시도에만 쓴다 |

비활성에서 섀도를 빼는 이유: 색만 흐리게 하면 하드 섀도 때문에 여전히 눌리는 것처럼 보인다.

### 칩

| 상태 | 표현 |
| --- | --- |
| 조건 요약 칩 | 투명 바탕, 1.5px `--olive` 테두리, 라디우스 99px, 12px/600 `--olive-ink` |
| 관심사 미선택 | `--field` 바탕, 1.5px `--olive` 테두리, 13px/600 `--olive-ink` |
| 관심사 선택 | `--mustard` 바탕·테두리, 13px/700, 글자는 머스터드 위 대비를 위해 `#4a3708` |
| 비활성 | `--card-muted` 바탕, 1.5px dashed `--line-dashed`, `--ink-faint` |

선택 가능한 칩의 최소 높이는 44px, 좌우 여백 16px이다. 조건 요약 칩은 읽기 전용이라 44px 규칙을 강제하지 않는다.

### 일정 타임라인 항목

왼쪽 시간 열 52px + 12px 간격 + 내용 카드. 시간 열은 12px/800 `--ink`(추정·비확정 시각은 11px/700 `--ink-faint`)이고, 그 아래로 2px `--track-move` 세로 레일이 이어진다.

내용 카드는 `--card` 바탕, 2px `--line`, `4px 4px 0 --shadow`. 종류는 **왼쪽 6px 색 띠**로 구분한다.

| 종류 | 왼쪽 띠 | 머리 라벨 |
| --- | --- | --- |
| 이동 · 복귀 이동 | 없음 | `--ink-muted` 11px/700 + 자동차 SVG |
| 방문 | 6px `--olive-bar` | `--olive-ink` 11px/700 + 건물 SVG |
| 축제 | 6px `--mustard` | `--mustard-ink` 11px/700 + 별 SVG |
| 장소 사이 이동 | 카드가 아닌 한 줄 — `--paper` 바탕, 2px dashed `--line-dashed`, 높이 44px 미만 허용 | — |
| 식사 시간 · 비어 있는 블록 | 없음. `--card-muted` 바탕 + 2px dashed `--line-dashed` | `--ink-muted` |

각 방문 항목에는 운영시간 배지(`--olive-soft`)와, 해당되면 휴무·예외 배지(`--mustard-soft`)를 붙이고, 그 아래 11px/500 `--ink-faint`로 출처·갱신일·추정 여부를 적는다. **운영 근거가 없는 방문 항목을 그리지 않는다.**

### 데이터 신뢰도 표시

| 상태 | 표현 |
| --- | --- |
| 확인된 값 | `--olive-soft` 바탕, `--olive-ink` 11px/600, 체크 SVG |
| 추정값 | `--mustard-soft` 바탕, `--mustard-ink` 11px/700, 물결 SVG |
| fallback · 오래된 값 | `--mustard-soft` 바탕 + 1px dashed `--mustard-ink`, 시계 SVG, 기준 시각을 함께 적는다 |
| 결측 | `--card-muted` 바탕 + 1px dashed `--line-dashed`, `--ink-faint`, 빼기 SVG |
| 장애 | `--alert-soft` 바탕, `--alert-ink`, 경고 삼각형 SVG |

신뢰도는 색 하나로만 구분하지 않는다. 테두리(실선/점선)와 아이콘 모양을 함께 바꾼다.

### 로딩 상태

- 카드 껍데기(2px `--line` 테두리 + 하드 섀도)를 유지하고 내용만 `--skeleton` 블록으로 바꾼다. 카드가 사라지면 레이아웃이 흔들린다.
- **조건 요약 카드는 스켈레톤으로 바꾸지 않는다.** 제출한 조건은 계산 중에도 실제 값으로 남는다.
- 진행 상태는 안내 배너(정상 상태 형식, `--olive-soft`/`--olive`)로 알리고, 취소·수정 경로를 보조 버튼으로 남긴다.
- 스켈레톤 블록은 애니메이션 없이도 성립해야 한다. 움직임은 있으면 좋은 정도다.

### 결과 없음 · 일정 생성 불가 · 데이터 장애

이 셋의 구분이 이 문서에서 가장 중요한 규칙이다.

| | 결과 없음 · 일정 생성 불가 (정상) | 데이터 장애 (오류) |
| --- | --- | --- |
| 색 | 종이·잉크·올리브만. **자적색을 쓰지 않는다** | `--alert` / `--alert-soft` / `--alert-ink` |
| 형태 | 평소와 같은 카드 (2px `--line` + 하드 섀도) | 화면 상단 8px `--alert` 띠 + `3px double --alert` 테두리 |
| 아이콘 | 선으로 그린 지도·일정표. 경고 삼각형을 쓰지 않는다 | 경고 삼각형 |
| 헤더 | 평소와 같다 | `--alert` 바탕 상태 배지 |
| 말투 | "없어요 / 못 만들었어요" + 다음 행동 | "불러오지 못했어요" + 재시도 |
| 필수 내용 | 조건 요약 유지, 왜 안 됐는지의 계산·운영시간 근거, 조건 조정 안내 | 무엇이 실패했는지, 마지막 정상 데이터 시점, 임의 대체값을 쓰지 않았다는 사실 |

정상 예외에서 후보나 일정을 만들어 채우지 않는다. 장애에서 임의의 출발지·이동수단·운영값으로 대체해 계산하지 않는다.

## 코드 반영용 CSS 커스텀 프로퍼티

아래 블록이 위 표의 색 토큰과 1:1로 대응한다. **이 블록은 `app/tokens.css`의 `:root`에 그대로 반영돼 있다.** 여기 없는 값을 화면에서 새로 만들지 않는다.

```css
:root {
  /* 바탕·표면 */
  --paper: #efe9d5;
  --paper-dot: #d9d0b3;
  --card: #fbf8ee;
  --card-muted: #f4f0e2;
  --field: #fdfcf6;

  /* 글자 */
  --ink: #2b2a1d;
  --ink-body: #3d3a2c;
  --ink-muted: #6b6550;
  --ink-faint: #8a8368;
  --on-dark: #f6f2e5;

  /* 선·그림자 */
  --line: #33301f;
  --line-dashed: #a8a081;
  --shadow: #cfc5a4;

  /* 강조 */
  --olive: #4a6b2f;
  --olive-ink: #3f6b2b;
  --olive-bar: #6c9b4a;
  --olive-soft: #e6efd8;
  --mustard: #e0b743;
  --mustard-soft: #f7e6b8;
  --mustard-ink: #7a5710;
  --terracotta: #c1502e;

  /* 시간 막대 */
  --track: #e7e1cd;
  --track-move: #c3b998;

  /* 상태 */
  --skeleton: #ded8c2;
  --alert: #8c2140;
  --alert-soft: #f4dcdf;
  --alert-ink: #6f1a33;

  /* 형태 */
  --radius-card: 0;
  --radius-pill: 99px;
  --radius-tag: 2px;
  --border-card: 2px;
  --border-alert: 3px;
  --shadow-card: 5px 5px 0 var(--shadow);
  --shadow-item: 4px 4px 0 var(--shadow);
  --touch-min: 44px;

  /* 서체 */
  --font-title: 'Jua', system-ui, 'Apple SD Gothic Neo', sans-serif;
  --font-body: 'Gothic A1', system-ui, 'Apple SD Gothic Neo', sans-serif;
  --font-hand: 'Gaegu', system-ui, 'Apple SD Gothic Neo', sans-serif;
}
```

화면 시안(`design/screens/`)은 웹폰트를 다음 한 줄로 불러온다.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gaegu:wght@700&family=Gothic+A1:wght@500;600;700;800&family=Jua&display=swap">
```

애플리케이션 코드는 같은 서체를 `app/layout.tsx`에서 `next/font/google`로 불러와 self-host한다. 폴백 스택은 위 서체 토큰에 그대로 들어 있다.

## 화면 시안

이 토큰으로 그린 모바일 390px 화면과 컴포넌트 시트의 작업 파일은 `design/screens/`에 있다. 다음 수정은 그 파일에서 다시 만든다.
