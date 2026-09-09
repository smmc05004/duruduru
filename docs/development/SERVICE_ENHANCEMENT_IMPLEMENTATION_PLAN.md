# 서비스 고도화 구현 계획

> 상태: E1·E2 구현·검증·병합 완료, E3 구현·로컬 검증 완료·PR 준비 중 / 기준일: 2026-09-09 / E3 작업 브랜치: `feat/visit-information`

## E3 — 추천 근거와 방문 판단 정보

### 목표

선택한 계획의 실제 관광지에만 TourAPI 기존 상세 원천을 제한적으로 보강한다. 일정과 기존 음식점 흐름은 즉시 유지하고, 제공된 소개·Type1 확인 사진·휴무 원문·안전한 주소 도구를 항목별로 덧붙인다. 검색에는 관광 상세 호출을 추가하지 않는다.

### 수용 기준

- 자동 보강은 실제 계획의 서로 다른 관광지 최대 6개에만 하고, 항목별 `detailCommon2`/`detailIntro2` 최대 2회, 전체 최대 12회·원천 동시성 2·항목 12초·작업 28초를 지킨다. 항목은 순차 처리하고 내부 두 요청만 병렬 처리한다.
- 진행 요청은 `contentId + contentTypeId` 단위로 자동·클릭이 공유한다. 정상 캐시는 30분, 부분 캐시는 5분이며, 자동 재시도는 없고 명시적 재시도는 항목당 최대 2회 및 실패 뒤 30초 쿨다운을 적용한다.
- 검색/목적지/계획 세대가 바뀌면 이전 자동 결과를 취소 또는 무시한다. 저장본 복원은 자동 상세 호출 0회이고 명시적 `방문정보 확인`만 같은 예산으로 요청한다.
- 항목별 `loading / ready / partial / unavailable / not-requested`와 부분 성공을 보존한다. 느림·오류·시간 초과는 관광·식사 계획을 막거나 바꾸지 않는다.
- 소개는 HTML을 실행하지 않는 안전한 첫 160자 요약과 펼치기로, 사진은 `cpyrhtDivCd === Type1` 및 허용 관광공사 이미지 호스트일 때만 출처·조건·조회일과 함께 표시한다. 그 외 이미지·원시 HTML·원시 외부 URL은 쓰지 않는다.
- 휴무 원문을 보이고, 전체가 단일 `매주 {요일}` 또는 `매주 {요일} 휴무` 형식일 때만 KST 방문일과 비교해 경고한다. 공휴일 예외·복수 조건·부분 일치·결측은 자동 판정하지 않는다.
- 주소가 있으면 복사와 승인한 HTTPS 지도 검색 링크를 제공하고, 없으면 이름 검색임을 알리며 복사 버튼을 숨긴다. 링크는 URL 인코딩·`noopener noreferrer`를 사용하고 복사 실패는 주소 선택 안내로 처리한다.

### 파일 범위와 구현 순서

1. `lib/attraction-detail.ts`와 관광 상세 Route Handler를 현재 TourAPI 계약·콘텐츠 유형/프로필 소속 검증에 맞춰 확장하고, 안전 정규화·사진·휴무·지도 URL 규칙을 도메인 모듈로 둔다.
2. client-safe 상세 요청 조정기와 캐시를 추가해 공유·취소·세대 격리·시간 제한·재시도 예산을 적용한다.
3. `components/mvp-phase-two/Notebook.tsx`, `components/mvp-phase-two/TripPlanner.tsx`의 기존 H 여행 수첩 레일에 비차단 방문 정보 카드와 접근 가능한 상태/동작만 추가한다. 음식 상세·알고리즘과 E1/E2 근거는 바꾸지 않는다.
4. 먼저 실패하는 Jest로 한도·공유·시간 초과·부분 성공·stale 격리·저장 복원 무요청 및 정규화/휴무/URL을 검증하고, 실제 검색→역할→선택→계획→제한 mock 음식 API 통합 흐름을 유지한다.
5. Playwright 실제 UI, `npm run verify`, 관련/전체 Jest, `npm run test:e2e`, `npm run cycle`을 실행하고 PR에 실제 TourAPI 확인 결과와 mock 검증을 구분해 기록한다.

### 상태·의존성·제외

- 상태: 구현·로컬 검증 완료·PR 준비 중. 작업 브랜치 `feat/visit-information`은 E2 병합 뒤 최신 `main`에서 생성했다.
- 의존성: 기존 TourAPI `detailCommon2`/`detailIntro2`, 서버 키, 선택 계획·프로필 계약만 사용한다.
- 제외: 검색 상세 호출, 새 외부 서비스·키·DB·LLM·실시간/경로/지오코딩, 전국 상세 수집, 음식점 상세/선정 변경, E4 편집·저장 스키마 변경은 하지 않는다.

### 검증·PR 증거

- Jest: 호출 수/동시성/12초·28초/캐시 만료·공유·재시도, 부분/오류/시간 초과, stale 결과 차단, 저장 복원 무요청, Type1·안전 HTML/URL, KST 단일 요일 휴무를 검증한다.
- 통합 Jest: 검색과 E1/E2 실제 엔진을 실행하고 음식·관광 상세 원천만 제한 mock해 선택 후 계획 유지와 비차단 상세 보강을 검증한다.
- 브라우저·품질: Playwright UI 확인, `npm run verify`, `npm run test:e2e`, `npm run cycle`을 실행한다. 기존 stale `app/__tests__/page.test.tsx` 전체 Jest 실패는 삭제·약화하지 않고 기준선 한계로 분리 기록한다.
- 로컬 증거: `lib/__tests__/attraction-visit-info.test.ts`, `lib/__tests__/mvp-phase-two-flow-e3.test.ts` 5건 통과. 최대 6개 순차 보강·공유/부분 캐시·수동 재시도 쿨다운·항목 timeout/stale 중단·KST 휴무·안전 지도 URL과 실제 검색→계획→음식 Route Handler→프로필 소속 관광 상세 2원천 정규화를 확인했다. `npm run typecheck`, `git diff --check`도 통과했다.
- 브라우저: `E2E_PORT=3100 npm run test:e2e -- e2e/home.spec.ts` 5건 통과. 실제 검색 엔진에서 목적지를 선택한 뒤에만 방문정보를 보강하고, 검색 중 상세 호출 0회·안전한 지도 링크 표시를 확인했다. 개발 환경 React Strict Mode가 첫 effect를 취소한 뒤 자동 보강을 영구 생략하던 문제를 수정하고 동일 시나리오로 재검증했다.
- `npm run verify`: 통과. format·lint·typecheck·production build를 포함한다. 기존 `scripts/build-region-profile.mjs`의 미사용 변수 ESLint 경고 2건은 유지된다.
- 전체 Jest: 98건 통과, 19건 실패. 실패는 기존 `app/__tests__/page.test.tsx`가 제거된 PoC-era select·loader props를 전제해 현 `TripPlanner` UI 계약과 맞지 않는 기준선 문제다. E3에서 해당 테스트를 삭제·약화하거나 통과로 처리하지 않았다.
- 실제 API 한계: 실 TourAPI 키·외부 호출 성공은 검증 근거로 삼지 않았다. 기존 Route Handler의 서버 키·프로필 소속 검증을 유지하고, 제한 mock으로 success/partial/오류를 재현했다.
- PR 증거: 커밋/PR/CI 확인 후 번호와 결과를 추가한다.

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

- PR: [#68 하루 관광 구성과 여유를 구현한다](https://github.com/smmc05004/duruduru/pull/68)
- 커밋: `7ae152e` 하루 관광 구성과 여유를 구현한다
- E2 Jest: `lib/__tests__/mvp-phase-two-planner-e2.test.ts`, `lib/__tests__/mvp-phase-two-search.test.ts`, `lib/__tests__/mvp-phase-two-flow-e2.test.ts` 10건 통과. 시설 신호/연쇄 방지, same-facility/independent 보정 계약, 시설 의심 대안 우선, 15분 여유·30분 일일 자유시간, 실제 검색 Route Handler→E2 계획→음식 Route Handler 흐름을 검증했다. 마지막 흐름은 검색·계획 엔진을 실제 실행하고 음식 TourAPI만 제한 mock했다.
- 전체 Jest: 93건 통과, 19건 실패. 실패는 기존 `app/__tests__/page.test.tsx`가 이미 제거된 PoC-era `loadConditions`/`loadItinerary` props와 `<select>` 입력을 전제로 해 현재 `TripPlanner` UI 계약과 맞지 않는 기준선 문제다. E2에서 해당 테스트를 삭제·약화하거나 통과로 처리하지 않았다.
- `npm run verify`: 통과. production build 포함. 기존 `scripts/build-region-profile.mjs`의 미사용 변수 ESLint 경고 2건은 유지된다.
- Playwright: `E2E_PORT=3100 npm run test:e2e -- e2e/home.spec.ts` 4건 통과. 실제 `/api/search` 및 E2 엔진을 실행하고 음식 목록 API만 mock하여 역할 카드→선택→여유시간 안내→음식 요청 1회를 확인했다.
- 독립 리뷰 후속: 시설 주소 정규화가 구두점을 모두 지워 `1-2`와 `12`를 충돌시키던 문제를 수정했다. 공백·대소문자만 정리하고 번지 구분자는 보존하되, 하이픈 바로 앞뒤의 공백만 정리해 `1 - 2`와 `1-2`는 같게 처리한다. 해당 양성·음성 충돌 회귀 단위 검증을 추가했다.
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
