# 서비스 고도화 구현 계획

> 상태: E1 구현·검증·병합 완료 (`e071fce`, CI 기록 `5dd184a`), E2 구현·로컬 검증 완료, PR 생성 예정 / 기준일: 2026-09-08 / E2 작업 브랜치: `feat/day-itinerary-composition`

## E2 — 하루 관광 구성과 여유

### 목표

E1이 검색과 선택에 함께 쓰는 공통 일정 엔진에 보수적 시설 의심 묶음, 반일별 근접 관광 선택, 활동 사이 15분 여유를 넣는다. 좌표 거리로 내부 이동시간을 만들지 않으며, 15분 여유는 관광일 최소 30분 자유시간 안에 포함한다. 후보 초안·선택 결과·기존 편집 재계산은 같은 엔진·규칙 버전을 사용한다.

### 수용 기준

- 기존 동일 ID·강한 중복 제거는 유지하고, 주소 완전 일치·300m 이내·일반 시설명을 제외한 3글자 이상 이름 토큰 공유를 모두 만족할 때만 `facilityGroupId`를 만든다. 대표 기준의 모든 구성원 검증으로 연쇄 병합을 막는다.
- 시설 의심은 대안이 있을 때의 선택 감점일 뿐 원본 삭제·지역 제외가 아니다. 대안이 없으면 선택하고 계획 근거에 `같은 시설 안 장소가 포함될 수 있어요`를 남긴다. 확인된 `same-facility`/`independent` 보정만 최소 계약으로 적용한다.
- 실제 확정 슬롯의 날짜·반일에 맞춰 첫 장소와 이후 장소를 고른다. 같은 반일에는 5km 이내 미사용 후보를 우선하고, 없거나 좌표가 결측이면 명세의 결정적 fallback과 거리/분산 안내를 보존한다.
- 연속 관광 사이에만 15분 `여유시간`을 배치하고, 식사·야간 휴식 경계에는 중복하지 않는다. 관광일 자유시간 총합은 해당 여유를 포함해 최소 30분이며, 식사·출발/귀가·야간 이동·다음날 복귀 제약은 유지한다.
- `facilityGroupId`, `sessionId`, 거리 결측/분산 안내, 선정 규칙 버전이 계획 근거에 client-safe로 보존되고, 기본 일정은 이를 실제 이동시간·도로 동선처럼 표시하지 않는다.
- 검색→역할 후보→선택 계획→음식 목록의 Route Handler 흐름은 엔진을 실제로 실행하고 음식 API만 제한 mock한다. 음식·원천 호출 정책, H 여행 수첩 디자인, E1 역할·근거는 바꾸지 않는다.

### 파일 범위와 구현 순서

1. `lib/mvp-phase-two-types.ts`, `lib/mvp-phase-two-planner.ts`: 시설 그룹·보정의 최소 계약, 반일 선정/여유 블록, 근거와 규칙 버전을 공통 도메인 엔진에 추가한다.
2. `lib/mvp-phase-two-search.ts`: E1 초안 계산이 E2 공통 엔진 결과를 그대로 비교·반환하는지 유지한다.
3. `components/mvp-phase-two/Notebook.tsx`, `components/mvp-phase-two/TripPlanner.tsx`: 기존 H 일정 레일에서 실제 이동시간으로 오인되지 않는 여유·시설/분산 안내만 최소 표시한다.
4. `lib/__tests__/mvp-phase-two-search.test.ts`, 새 또는 기존 planner 테스트, `e2e/home.spec.ts`: 먼저 실패하는 시설 묶음·반일 근접성·여유 제약과 실제 검색→계획→음식 목록 연결을 검증한다.
5. `docs/development/MVP_IMPLEMENTATION_PLAN.md`: E2의 현재 진입점과 완료 PR·검증 근거를 완료 시 연결한다.

### 상태·의존성

- 상태: 구현·로컬 검증 완료. E1 PR #67의 완료 근거는 아래 기록을 유지한다. 독립 reviewer는 E2 PR 생성 뒤 별도 컨텍스트에서 수행한다.
- 의존성: E1 공통 초안 엔진과 기존 TourAPI 프로필/KTDB 데이터만 사용한다. 새 API·키·DB·LLM·도로 경로·내부 이동시간 환산·음식점 알고리즘 변경은 없다.
- 보정 계약: 현재는 코드에만 둔 정렬 콘텐츠 ID 쌍, `same-facility | independent`, 확인 근거·확인일의 소규모 입력으로 제한하며, 근거 없는 보정 목록은 추가하지 않는다.

### 검증 계획

- Jest: 일반 토큰·주소/좌표 단독·연쇄 묶음 비적용, 대안 유무의 시설 감점/안내, 반일 5km 우선과 좌표 결측 fallback, 15분 여유와 일 30분 자유시간·식사/야간/귀가 경계, 공통 초안 동일성을 검증한다.
- 통합 Jest: 검색 Route Handler와 실제 엔진을 통과시키고 음식 목록 API만 mock하여 검색→역할→선택→음식 흐름을 검증한다.
- 브라우저: Playwright로 서울/부산 검색, 역할 카드, 선택 뒤 일정의 여유 안내와 음식 요청 1회를 확인한다.
- 품질: 관련 Jest, 전체 Jest(기존 stale page 실패는 별도 실패로 명시), `npm run verify`, 관련 Playwright, `npm run cycle`을 실행한다.

### PR 증거

- 커밋: PR 생성 시 기록한다.
- E2 Jest: `lib/__tests__/mvp-phase-two-planner-e2.test.ts`, `lib/__tests__/mvp-phase-two-search.test.ts`, `lib/__tests__/mvp-phase-two-flow-e2.test.ts` 10건 통과. 시설 신호/연쇄 방지, same-facility/independent 보정 계약, 시설 의심 대안 우선, 15분 여유·30분 일일 자유시간, 실제 검색 Route Handler→E2 계획→음식 Route Handler 흐름을 검증했다. 마지막 흐름은 검색·계획 엔진을 실제 실행하고 음식 TourAPI만 제한 mock했다.
- 전체 Jest: 93건 통과, 19건 실패. 실패는 기존 `app/__tests__/page.test.tsx`가 이미 제거된 PoC-era `loadConditions`/`loadItinerary` props와 `<select>` 입력을 전제로 해 현재 `TripPlanner` UI 계약과 맞지 않는 기준선 문제다. E2에서 해당 테스트를 삭제·약화하거나 통과로 처리하지 않았다.
- `npm run verify`: 통과. production build 포함. 기존 `scripts/build-region-profile.mjs`의 미사용 변수 ESLint 경고 2건은 유지된다.
- Playwright: `E2E_PORT=3100 npm run test:e2e -- e2e/home.spec.ts` 4건 통과. 실제 `/api/search` 및 E2 엔진을 실행하고 음식 목록 API만 mock하여 역할 카드→선택→여유시간 안내→음식 요청 1회를 확인했다.
- `npm run cycle`: 그래프를 확인했다. 이 명령은 작업 ID 없이 실행하면 안내만 출력하며 상태 전이를 수행하지 않는다. E2 독립 review·handoff는 PR 생성 뒤 reviewer 근거와 함께 진행한다.
- 한계: 실제 TourAPI 키·외부 호출은 이 PR에서 성공 근거로 삼지 않았고, 외부 음식 목록은 제한 mock으로 재현했다.

## E1 — 비교할 가치가 있는 목적지 3안

### 목표

동일한 입력과 지역 프로필·KTDB 시간표에서 공통 일정 엔진으로 실제 초안을 먼저 만들고, 서로 중복하지 않는 `easy`·`interest`·`relaxed` 역할의 최대 3개 목적지를 순차적으로 제안한다. 음식점·관광 상세 호출을 검색에 추가하지 않는다.

### 수용 기준

- `easy`는 왕복 운전, 충족 관심사, 관광 수, 세부 분류 수, `groupId` 순으로 고르고, `interest`와 `relaxed`는 E1 명세의 결정적 순서를 적용한다.
- 역할은 앞에서 고른 `groupId`를 제외한 후보에서 순차적으로 하나씩 선택하며, 가능한 후보가 1~2개면 그 수만 반환한다.
- 근접성은 실제 초안의 당일 연속 관광지 쌍에서만 계산하고, 전체 쌍 수·유효 쌍 수·평균 거리 결측을 `Candidate.recommendation`에 보존한다. 유효 쌍이 없는 후보는 제거하지 않고 해당 비교에서 마지막으로 둔다.
- 후보 카드에는 역할, 왕복 자동차 일반 예상시간, 실제 관광지 수, 충족/누락 관심사, 현지 낮 자유시간과 사실 기반 근거를 보인다. 세 역할의 지표가 같을 때 차이를 꾸미지 않는다.
- 기존 서울/부산 출발 그룹 제외, 일반구 그룹 중복 제거, 공통 초안과 선택 일정의 동일성, 음식점 흐름을 보존한다.
- 결정적 A/B/C 역할 선택, 중복 단독 우승자, 1~2개/동점/거리 결측, 검색 외부 호출 0회 및 검색→역할 선택→선택→음식 목록 실제 통합 흐름을 검증한다.

### 파일 범위와 구현 순서

1. `lib/mvp-phase-two-types.ts`: 역할·비교 수치·알고리즘 버전의 client-safe 계약을 추가한다.
2. `lib/mvp-phase-two-search.ts`: 공통 초안에서 비교 지표를 만들고 순차 역할 선택과 결정적 이유를 구현한다.
3. `components/mvp-phase-two/Notebook.tsx`, `components/mvp-phase-two/TripPlanner.tsx`: H · 여행 수첩 결과 카드에 E1 역할과 근거를 추가한다.
4. `lib/__tests__/mvp-phase-two-search.test.ts`, `e2e/home.spec.ts`: 먼저 실패하는 결정론 테스트와 API만 mock한 실제 흐름 통합 검증을 추가한다.
5. `docs/development/MVP_IMPLEMENTATION_PLAN.md`: 다음 employee 진입점을 이 문서로 연결하고, PR·검증 근거를 완료 시 기록한다.

### 제외 범위

E2의 시설 묶음·반일 여유, E3 상세/사진/휴무, E4 편집·저장 이관, 내부 이동시간 환산, 새 외부 API·키·DB·LLM·실시간 교통, 음식점 알고리즘 변경은 구현하지 않는다.

### 검증 계획

- Jest: 역할별 정렬·순차 중복 제거·동점·거리 결측·1~2개 결과 및 계획 동일성을 검증한다.
- Playwright: 서울/부산에서 검색, 세 역할 카드 확인, 하나 선택 후 기존 음식 목록 요청과 계획 표시를 검증한다. 검색/음식 API만 제한적으로 mock하고 엔진·역할 선택은 실제 코드로 실행한다.
- `npm run verify`, 관련 Jest, `npm run test:e2e`를 실행하고 실제 Playwright 브라우저 화면을 점검한다.

### PR 증거

- PR: [#67 E1 목적지 비교 역할 추천 구현](https://github.com/smmc05004/duruduru/pull/67)
- 커밋: `2ac8aed` 목적지 비교 역할 추천을 구현한다
- E1 Jest: `lib/__tests__/mvp-phase-two-search.test.ts` 5건 통과 — A/B/C 역할, 순차 중복 제거와 1~2개, 전체 동점, 거리 결측, 실제 정적 검색→선택 계획→제한된 mock 음식 목록 연결
- 전체 Jest: 88건 통과, 19건 실패. 실패는 기존 `app/__tests__/page.test.tsx`가 현재 `app/page.tsx`에서 이미 제거된 PoC-era `loadConditions`/`loadItinerary` props와 `<select>` 입력을 전제로 한 기준선 불일치이며 E1 수정 범위 밖이다.
- `npm run verify`: 통과. ESLint의 기존 `scripts/build-region-profile.mjs` 미사용 변수 경고 2건은 유지된다. 첫 sandbox 실행은 Google Fonts 네트워크 차단으로 build가 실패했고, 허용된 네트워크에서 재실행해 build까지 통과했다.
- Playwright: `E2E_PORT=3100 npm run test:e2e -- e2e/home.spec.ts` 4건 통과. 새 흐름은 실제 `/api/search` 엔진을 실행하고 음식점 API만 mock해, 역할 카드 표시 후 선택 때만 음식 요청 1회를 확인했다.
- CI/병합 가능 상태: Verify·E2E·Vercel Preview Comments·Vercel 모두 통과, `MERGEABLE`·`CLEAN` (2026-09-08 확인). 병합은 하지 않는다.
