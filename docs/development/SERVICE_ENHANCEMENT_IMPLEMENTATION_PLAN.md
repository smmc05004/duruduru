# 서비스 고도화 구현 계획

> 상태: E1 구현·로컬 검증 완료, PR CI 대기 / 기준일: 2026-09-08 / 작업 브랜치: `feat/destination-comparison`

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
