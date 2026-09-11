# 관광 데이터·목적 적합성 고도화 작업 계획

> **최신(2026-09-10): T1~T7 구현 완료.** 같은 `docs/tourism-recommendation-upgrade` 브랜치/PR #76에 T7 목적 적합성 보완까지 반영했다(`e1-v3`/`e2-v3`). 결과·검증은 [T6 보고서 §7](TOURISM_RECOMMENDATION_T6_REPORT.md#7-t7-결과--목적-적합성-보완-2026-09-10-같은-pr), 확정 상수는 [제품 D4-a](../product/TOURISM_RECOMMENDATION_UPGRADE.md#d4-a--확정-상수-t7-1-2026-09-10). 새 API·입력 옵션·수집 자동화·연결률 확대는 추가하지 않았다. 병합은 사용자 지시/하네스에 따른다.

> 2026-09-10: **T1~T6 구현 완료.** 브랜치 `docs/tourism-recommendation-upgrade`에서 커밋 `3ba31e1`~T6 커밋, PR 생성(병합은 지시 대기). 결과·검증·미해소 항목은 [T6 보고서](TOURISM_RECOMMENDATION_T6_REPORT.md).
>
> (원본 계획 노트) 2026-09-10: 계획 작성·기획 대조 완료. 구현은 모델 변경 후 별도 세션에서 진행했다.
> 제품 SSOT: [관광 데이터·목적 적합성 기획서](../product/TOURISM_RECOMMENDATION_UPGRADE.md). 다음 세션은 AGENTS.md와 employee 역할 정의, 제품 문서, 이 계획을 읽는다.

## 기준선·작업 경계

현재 검색은 lib/mvp-phase-two-search.ts가 지역 프로필·KTDB JSON을 읽는다. scripts/build-region-profile.mjs의 cat 기반 필터와 lib/mvp-phase-two-search.ts의 categoriesFor가 새 분류 미지원이다. 신규 중심 API는 표본 조회만 완료됐고 수집기·연결 인덱스·점수 구현은 없다. 기존 .env.local.example 변경은 이전 키 추가 작업이며 값이 있는 .env.local은 커밋하지 않는다.

모델 변경 후 최신 main에서 `feat/tourism-recommendation-upgrade` 등 단일 목적 영문 브랜치로 단계별 구현한다. 문서 브랜치가 미병합이면 해당 변경의 포함 여부를 먼저 확인하고 사용자 문서를 유실하지 않는다. 완료 후 한글 커밋·단일 PR을 준비하되 병합은 이후 지시/하네스에 따른다. 지금은 커밋/PR/병합을 수행한 상태가 아니다.

## 순차 작업

| 순서 | 상태             | 작업                                              | 완료 판정                                                                                                                                            |
| ---- | ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | 완료(2026-09-10) | 공식 분류 코드 원본 확인·새 분류 계약·공통 해석기 | 5개 관심사에 대한 공식 코드 표, 새/구 우선순위, 미해석 집계, 네 대표 명소 회귀 검증                                                                  |
| T2   | 완료(2026-09-10) | 프로필 수집기 교체·전국 재수집                    | 페이지 완전성·중복·분류/법정동/좌표 품질 보고와 정상본 교체, 대표 명소 포함                                                                          |
| T3   | 완료(2026-09-10) | 중심 관광지 수집기·체크포인트                     | 202608 동일월·유효 지역·예산·제한 재시도·인증 중단·재개·정상본 보존 검증                                                                             |
| T4   | 완료(2026-09-10) | 보수적 원천 연결·데이터 묶음                      | 연결 상태별 집계, 본체/부분 금지 사례·동일 시설 중복 점수 검증                                                                                       |
| T5   | 완료(2026-09-10) | 실제 방문 선정·목적 근거 점수·역할 순서           | 기획 D4와 초안/카드 근거 일치, 시간·편집·저장 호환 유지                                                                                              |
| T6   | 완료(2026-09-10) | 결과 비교·통합 검증·인계                          | 변경 전후 비교 보고([T6 보고서](TOURISM_RECOMMENDATION_T6_REPORT.md)), 검색 외부 호출 0회 검증, Jest/Playwright/verify 통과, 성능 회귀 수정, PR 생성 |

T1→T2→T3→T4→T5→T6 순서로 진행했다. 남은 작업은 아래 T7 하나다. 앞 단계 실패를 임의 데이터·도시 가점으로 우회하지 않는다. 일정 생성 개선만 먼저 넣고 데이터 교체가 끝났다고 표시하지 않는다.

### T7: 목적 적합성 보완 및 이번 작업 마무리 — 미착수

1. **수치 확정:** 기존 데이터와 48개 비교 입력을 재사용한다. 실제 배치된 관심사별 중복 제거 시설 수·세부 유형 수에 포화 상한을 적용한 소수의 고정 구간안을 비교한다. 상한·수식·경계·중심 연결 보조 상한·선택 이유를 제품 D4에 기록하고 구현 상수로 고정한다. 정렬 중 두 후보 차이로 동점을 정하는 비교자는 금지한다. 특정 도시 순위나 중앙값 62분 복귀를 목표로 튜닝하지 않는다. 합의한 평가축 밖 제품 판단이 필요하면 보고한다.
2. **선정·점수·역할 수정:** `lib/tourism-evidence.ts`, `lib/mvp-phase-two-search.ts`, `lib/mvp-phase-two-planner.ts`의 실제 소비 경로를 함께 수정한다. 실제 초안만 점수화하며 중심 순위가 세부 유형 다양성을 앞서지 않게 한다. 지역 간 원시 hubRank 합산을 제거하고 D4의 구간→왕복시간→보조 근거 순서를 적용한다. 지역 내 장소 선택도 지역별 순위를 교차 비교해 비추이적 정렬이 되지 않도록 결정적인 선택 키/단계로 구현한다. easy/relaxed·시간 엔진·식당 호출 정책은 유지한다.
3. **표시·저장 호환:** 새 적합성 지표와 중심 연결 근거를 구분하고 기존 점수 필드의 의미를 몰래 덮어쓰지 않는다. 알고리즘/근거 버전을 구분하고 카드·검증·저장을 함께 점검한다. 기존 계획은 재선정 없이 복원한다. 새 API 호출·전국 재수집·디자인 변경은 하지 않는다.
4. **검증:** 동구간이면 짧은 이동 우선, 높은 구간이면 먼 후보 선택 가능, 상한 이후 개수 증가의 무효, 중복 시설·분류 결측·다중 관심사·중심 결측·행정구역 분할/순위 숫자 변경의 영향, 정렬 추이성·결정성·저장 호환을 검증한다. 관광·식사·휴식·이동·귀가 제약과 검색 외부 호출 0회를 유지한다.
5. **비교·인계:** T6 48개 입력을 재실행하고 각 interest 선정/탈락 후보의 시설·다양성·구간·보조 근거·왕복/현지시간·실제 장소를 보고한다. 특히 긴 이동을 선택한 이유를 확인한다. T6 이력과 T7 결과를 구분하고 변경 범위 Jest·verify·핵심 E2E·CI 결과를 기록한다. 새 기능을 이어 붙이지 않고 같은 PR에 반영해 이번 작업을 마무리한다. 병합은 사용자 지시/기존 하네스에 따른다.

- [x] T7-1 수치 비교와 D4 확정 — 상한 4/3·구간 경계 `[4.5, 6.5]`·보조 상한 4, 후보안 비교·선정 근거는 [제품 D4-a](../product/TOURISM_RECOMMENDATION_UPGRADE.md#d4-a--확정-상수-t7-1-2026-09-10). 구현 상수 `PURPOSE_FIT_METRIC`.
- [x] T7-2 선정·점수·역할 구현 — `lib/tourism-evidence.ts`(구간 지표·보조 시설 수), `lib/mvp-phase-two-search.ts`(interest 정렬 = 충족 → 구간 → 왕복시간 → 보조 → groupId, 원점수 정렬 제거), `lib/mvp-phase-two-planner.ts`(관광 선정 = 세부 유형 다양성·근접성 → 중심 근거 불리언 → ID, hubRank 크기 비교 제거). `e1-v2→e1-v3`, `e2-v2→e2-v3`.
- [x] T7-3 표시·저장 호환 — `PurposeEvidence`에 `fitBand`/`fitAverage`/`fitByInterest`/`matchedFacilityCount` 추가(선택 필드, `score` 의미 보존). `mvp-phase-two-storage.ts` 검증·`cleanPurpose` 화이트리스트, 구 `e1-v2`/`e2-v2` 저장본 재선정 없이 복원. `Notebook.tsx` 근거 펼치기에 "목적 적합성 구간" 표시, 원점수 숨김.
- [x] T7-4 회귀·48개 사례 검증 — 신규 `lib/__tests__/enhancement-t7-selection.test.ts`·`lib/__tests__/enhancement-t7-comparison.test.ts`, `lib/__tests__/enhancement-tourism-evidence.test.ts` T7 블록. 동구간→짧은 이동, 높은 구간→먼 후보, 포화, 분류 결측·다중 관심사·중심 결측, 행정구역 분할 불변, 추이성·결정성, 저장 호환, 검색 fetch 0회 모두 통과.
- [x] T7-5 문서·기존 PR 인계 — [T6 보고서 §7](TOURISM_RECOMMENDATION_T6_REPORT.md#7-t7-결과--목적-적합성-보완-2026-09-10-같은-pr), 제품 D4-a, 이 체크리스트 갱신. `scripts/report-t7-selection.mjs`. 같은 PR #76에 반영.

### T1: 새 분류 계약

- 공식 분류 목록 API/안내를 읽고 코드·명칭·계층·조회일을 보존한다. history=HS는 실측됨. 나머지를 약어 추측으로 채우지 않는다. 기존 5개 관심사의 의미를 바꾸는 대응은 PM 문서에 먼저 반영한다.
- lib/mvp-region-data.ts 및 실제 사용 타입에 새 코드·원천 변경일·분류 버전을 추가한다. 공통 관심사 해석기를 만들어 수집·검색·후보/저장 변환이 동일 규칙을 사용하게 한다.
- rg로 cat1/2/3와 categoryId 소비 경로를 전수 확인한다. legacy 모듈은 실제 import 경로로 구분하고 무관한 PoC 코드 재작성은 하지 않는다.
- 네 명소의 확인된 콘텐츠 ID·분류/법정동을 작은 fixture로 남긴다. 새 분류 존재/없음/미해석/구 분류 충돌을 검증한다.

#### T1 완료 기록 (2026-09-10)

- 공식 목록: `lclsSystmCode2`(`lclsSystmListYn=Y`) 246행을 `data/tourapi-lcls-systm-codes.json`에 보존. L1 10종(NA·HS·LS·VE·EX·AC·EV·FD·SH·C01). 분류 버전 `lcls-2026-09-10`.
- 관심사 표·우선순위·미해석 규칙은 `docs/product/TOURISM_RECOMMENDATION_UPGRADE.md` D1-a~D1-c에 반영.
- **PM 확인 대기:** 휴양(rest)은 새 체계 대응 L1이 없어 **구현 보류**(구 `A0202`만 유지). 문화(culture)는 의미 보존 VE 하위 코드로만 활성화. 자연·역사·레저는 L1 1:1로 활성화.
- 공통 해석기: `lib/interest-classification.ts`(런타임 의존성 0, `.mjs`가 상대 경로 import). 관심사 ID SSOT도 이 모듈로 이동, `mvp-region-data.ts`가 재수출.
- 도입 지점: `scripts/build-region-profile.mjs`(레코드 판정을 해석기로 게이트 + `lclsSystm*`·`modifiedtime`·분류 버전 보존, `data/region-profiles.json` 재생성은 T2), `lib/mvp-phase-two-search.ts`(`categoriesFor` → 해석기), `lib/mvp-phase-two-storage.ts`(`lclsSystm*` 검증·보존). `lib/mvp-core.ts`는 미소비 legacy 경로라 그대로 둠.
- 타입: `RegionAttraction`·`Attraction`에 선택 `lclsSystm1/2/3` 추가, `RegionAttraction`에 `sourceModifiedAt`·`classificationVersion` 추가.
- 회귀: `lib/test-support/landmark-classification-fixture.ts` + `lib/__tests__/interest-classification.test.ts`(19케이스, 통과). 네 명소 모두 `lclsSystm1=HS` → 역사 판정.
- 검증: `npm run verify` 통과, `npm run test:enhancement`(84) 통과. 기존 `app/__tests__/page.test.tsx` 19실패는 이 작업 전부터 깨진 PoC.

### T2: 관광지 수집·품질

- scripts/build-region-profile.mjs를 새 분류 필터·페이지 검증·새 코드 보존으로 수정한다. 구 분류와 병행 조회가 필요한 범위는 실제 응답 근거로 정하고 콘텐츠 ID를 중복 제거한다.
- 수집 결과의 원천 개수/실제 건수/고유 ID/지역 배정/분류 결측/좌표 결측을 분리한다. 문화·레저 유형 중복과 새 체계의 숙박·쇼핑 유입을 확인한다.
- 임시 출력에서 검증한 뒤 data/region-profiles.json을 교체한다. 갱신 실패·예산 초과가 기존 파일을 훼손하지 않게 한다. 수집 재개는 실행 ID·요청 조건·페이지 기준으로 관리한다.
- 대표 네 명소와 기존 유효 장소의 차이를 contentId로 보고한다. 증가한 건수를 전부 추천 품질 개선으로 해석하지 않는다.

#### T2 완료 기록 (2026-09-10)

- **휴양·문화 매핑**: PM 결정(D1-c) 반영. 휴양 = `EX05 웰니스관광` + `NA04 자연공원` + `VE03 도시공원`(구 `A0202` fallback 유지). 문화는 T1 그대로. `lib/interest-classification.ts`의 `rest` 규칙 교체, `lclsPending` 제거. 해석기에 `NON_INTEREST_LCLS1`(AC·SH·FD·EV·C01) 추가 — 공식 L1이 관심사 밖 버킷이면 `contentTypeId` 신호를 무시한다(D1-b 규칙 3). `lib/__tests__/interest-classification.test.ts` 22→30 케이스(휴양 활성, NA04 겸침, VE02/VE05 제외, AC/SH 신호 억제).
- **수집기**: `scripts/build-region-profile.mjs`를 새 분류 스펙 12개(`lclsSystm1=NA/HS/LS`, `lclsSystm2=VE06/VE07/VE09/EX05/NA04/VE03`, `lclsSystm3=VE120100`, `contentTypeId=14/28`)로 교체. 구 `cat` 병행 조회는 실측 순유입 0건이라 제거(해석기 legacy 경로는 유지). contentId 단위로 union·1회 판정, 판정 근거(`lclsSystm*`·`cat*`·basis·`unresolvedLcls`·`imageCopyright`·`modifiedtime`) 보존. 호출 경계: 동시성 1, 요청 간 ≥1s, 20s 제한, 예산 900, 재시도 ≤2, 인증/한도 오류 즉시 중단, HTTP 200 원천/XML 오류 비성공 처리. 페이지 단위 체크포인트(`--resume`), 안전 배포(`.next.json` → 검증 → `--promote`).
- **재수집 결과**: 26요청·0실패·0재시도·드리프트 0. 원천 행 20,838 → 고유 contentId 15,781 → 배정 13,628(전부 `basis=lcls`). 249개 지역 전부 수집. 유효분류 없음 1,980(= `contentTypeId=28`가 데려온 `AC` 숙박, 규칙 3으로 제외). 미매핑 지역 173(인천 분할 구 등 매핑에서 의도적으로 뺀 지역). 좌표 결측 1. `unresolvedLcls` 0.
- **카테고리 3곳 이상 지역**: 자연 212 · 역사 222 · 휴양 236 · 문화 235 · 레저 173. (구본: 자연 161 · 역사 195 · 휴양 140 · 문화 234 · 레저 217 — 역사·휴양·자연↑, 레저는 숙박 제거로↓.)
- **대표 4명소**: 125949 공주(공산성)·126166 경주(불국사)·126207 경주(첨성대)·127977 익산(미륵사지) 모두 올바른 지역·`lclsSystm1=HS`·역사 판정으로 포함. 회귀 검증 통과.
- **구본 대비 contentId 차이**: 추가 4,158 / 유실 2,294 / 지역 변경 0 / 분류 변경 390. 유실은 대부분 구 `leisure`(숙박·`A03` 숙박류)·구 `rest`(`A0202` 테마파크). 경주 역사 64→109, 공주 22→36, 익산 42→53(D0 실측과 일치). 건수 증가는 분류 정밀화 결과이며 곧바로 추천 품질 개선이 아니다.
- **검증**: `npm run verify` 통과. `npm run test:enhancement` 84/84 통과. `interest-classification`·`mvp-phase-two-search`·`enhancement-*` 통과. `app/__tests__/page.test.tsx` 19실패는 이 작업 전부터 깨진 PoC(변동 없음). 검색 경로는 JSON import만 사용해 외부 호출 0회.

### T3: 중심 관광지 수집

- 새 scripts/build-central-attractions.mjs 및 package.json 실행 명령, 비밀 값 없는 예제 설명을 추가한다. 결과 후보는 data/central-attractions.json이다.
- 기획 D2대로 월·코드·호출 예산·체크포인트·요청 간격·실패 정책을 구현한다. 자격 오류·HTTP 200 오류·XML 오류·429/초당 제한·일일 한도·시간 초과를 구분하고 키는 로그에서 제외한다.
- 체크포인트에는 기준월·코드/매핑 버전·요청/재시도 수·지역/페이지 성공 상태를 저장한다. 같은 데이터 작업의 중복 실행을 막고 일일 계정 잔여 호출량과 별도 사용량은 실행 전에 확인한다.
- 개발 한도 1,000을 실행 예산 400과 혼동하지 않는다. 최근 샘플 응답 시간으로 전국 실행 시간을 보장하지 않는다. 동일 월 결과 재사용과 실패 지역 재개를 검증한 뒤 제한 순차 수집한다.

#### T3 완료 기록 (2026-09-10)

- **API 형식(공식 응답 대조).** `LocgoHubTarService1/areaBasedList1`. 요청: `serviceKey`(디코딩 키를 `URLSearchParams`가 1회 인코딩), `MobileOS`/`MobileApp`/`_type`/`numOfRows`/`pageNo`, `baseYm=202608` 고정, `areaCd`(법정동 시도 2자리), `signguCd`(표준 SIG_CD **5자리**). 3자리 `signguCd`·옛 TourAPI `areaCode`·미지원 코드·미래월은 모두 `resultCode 0000` + `totalCount 0`(빈 응답)이다. 응답 항목: `hubTatsCd`(32자리 해시 — TourAPI `contentId`와 **다른 ID**, 필드 분리 저장), `hubTatsNm`, `hubRank`(1~100), `hubCtgryLclsNm`(관광지/숙박), `hubCtgryMclsNm`, `mapX/mapY`. `totalCount`는 최대 100이며 한 페이지로 끝나지만 페이지 종료·중복은 방어적으로 검증한다.
- **산출물.** `scripts/build-central-attractions.mjs`(CLI) + `scripts/lib/central-attractions-core.mjs`(순수 로직, Jest 공유) + `package.json` `build:central-attractions` + `.env.local.example`(`CENTRAL_ATTRACTION_API_SERVICE_KEY` 설명, 값 없음). 정상본 `data/central-attractions.json`. 중간 산출물(`*.next.json`·`*.checkpoint.json`·`*.quality-report.json`·`*.lock`)은 `.gitignore`.
- **호출 정책(D2).** 동시성 1, 요청 시작 간 ≥1초, 요청 제한 20초, 실행 예산 400(성공·실패·재시도 모두 산입). 인증/권한/일일한도(`resultCode` 22·30~33) → 즉시 `FatalApiError` 중단. 429·5xx·초당제한(`23`)·연결오류 → 대기 후 최대 2회 재시도(재시도도 예산). HTTP 200의 원천/XML 오류는 성공 처리 안 함. 로그·JSON·에러에 키·키 포함 URL 미기록(HTTP 상태·원천 코드·지역·페이지만). 잔여 한도는 첫 지역 요청이 프리플라이트 역할(값 출력 없음, `code 22` 시 즉시 중단).
- **체크포인트·재개.** `data/central-attractions.checkpoint.json`에 기준월·매핑/분류 버전·`runId`·요청/재시도/실패 수·지역별 상태·저장 코드. `--resume`은 `baseYm`·매핑 버전·분류 버전이 모두 같을 때만 성공분 재사용. 재조회 대상 = `status≠ok` 이거나 저장된 `areaCd/signguCd`가 현재 계산값과 다른 지역(코드 정규화 반영). 잠금 파일로 동시 실행 차단(오래된 잠금 30분 후 자동 무시).
- **안전 배포.** 항상 `*.next.json`(+ 품질 보고)로만 기록 → `validateDocument` 통과 → `--promote`로만 `data/central-attractions.json` 교체. `failed` 지역이 남거나 표본 6지역이 정상이 아니면 교체 차단. 예산 초과·치명 오류는 기존 정상본을 건드리지 않는다.
- **매핑 코드 버그 수정.** `data/region-mapping.json`은 KTDB `전남광주통합특별시`(`lDongRegnCd` "12") 스킴이라 광주광역시·전라남도의 `lDongSignguCd` 뒤 3자리가 표준 SIG_CD와 어긋난다(광양 190 vs 46230, 고흥 740 vs 46770 등). 중심 API는 표준 SIG_CD만 받으므로 `CENTRAL_SIGNGU_OVERRIDES`(광주 5 + 전남 22, 공식 응답으로 27개 전부 대조)로 정규화한다. 세종은 `lDongRegnCd` "36110"에서 `areaCd 36`·`signguCd 36110`를 유도한다. KorService2용 코드는 손대지 않는다.
- **수집 결과(baseYm 202608).** 유효 지역 249개 중 **ok 221 · empty 28 · failed 0**. 요청 290회(최초 262 + 재개 28), 재시도 0, 실패 0. 중심 관광지 20,705건(중복 `hubTatsCd` 0). `hubCtgryLclsNm` 관광지 13,812 · 숙박 6,893(숙박·쇼핑 필터는 T4/T5 몫). `totalCount` = 수집 + 중복 불일치 0건.
- **empty 28의 실체(공식 응답 대조).** 광주광역시 5개 구 + 전라남도 22개 시군 + 경기 화성시. 표준 SIG_CD로 조회해도 202608은 전부 `totalCount 0`이고, 인접 월(광주·전남 202506/202507/202412/202601, 화성 202507/202509)에는 자료가 있다 → **원천의 해당 월 자료 공백**이며 코드 문제가 아니다. D2에 따라 과거 월로 대체하지 않고 `empty` + 사유로 남긴다. 품질 보고 `emptyRegions[].note`에 기록. 세종은 최초 실행부터 정상(코드 유도 규칙이 이미 처리).
- **재개 검증.** 최초 실행 후 `--resume`이 221개 ok 지역을 재호출 없이 건너뛰고, 코드가 바뀐 광주·전남 27개와 empty 화성 1개만 다시 조회함을 확인. 예산 누적(priorStats)이 재개 실행으로 이어짐을 확인.
- **표본 6지역(202608).** 공주 100(1 국립공주박물관 · 2 공산성 · 3 무령왕릉), 익산 100(1 미륵사지), 경주 100(1 동궁과월지 · 3 첨성대), 과천 63(1 국립과천과학관), 광명 93(2 광명동굴), 파주 100. D0 표본과 건수·형태 일치.
- **검증.** `scripts/__tests__/build-central-attractions.test.js` 32케이스(코드 조립·정규화·오류 분류·예산·체크포인트 재개·수집 흐름·키 단일 인코딩·정상본 검증, 네트워크는 fake fetch로 통제) 통과. `npm run verify` 통과.
- **T4로 넘길 사항.** (1) `hubTatsCd`(해시) ↔ `contentId`(숫자) 연결은 지역·정규화 이름·좌표 500m로 보수적으로. (2) `hubCtgryLclsNm=숙박`(6,893) 및 `hubCtgryMclsNm`의 쇼핑·기타관광은 일정 배치에서 제외(D3). (3) 광주·전남·화성은 중심 근거 없음 — 카드에 중심 문구 금지, `empty` 사유 보존. (4) 프로필(schemaVersion 2)·중심(schemaVersion 1)·연결 인덱스의 `baseYm`/`mappingVersion`/`classificationVersion` 정합 확인 후에만 배포 묶음 교체.

### T4: 연결과 배포 묶음

- 새 scripts/build-tourism-evidence.mjs 또는 동등 모듈에서 지역·이름·좌표 기반 연결을 수행한다. 전체 비교를 런타임 검색 때 매번 하지 않는다.
- contentId와 hubTatsCd 분리, 매칭 방법·거리·상태·이유·수동 근거를 저장한다. 이름 정규화의 허용 접두/접미 규칙을 명시하고 임의의 괄호 삭제/부분 문자열 매칭을 금지한다.
- 공산성연지/공산성, 동학사계곡/동학사, 천마총(대릉원)/대릉원, 동명 지역, 좌표 결측, 복수 후보, 무령왕릉 별칭 중복을 회귀 검증한다.
- 동일 시설 수동 보정은 실제 확인한 근거가 있을 때만 추가한다. 매칭률을 올리려고 기준을 느슨하게 바꾸지 않는다.
- 프로필·중심 원본·연결 결과를 schemaVersion/dataVersion/기준월/생성일/원천 버전 참조로 묶는다. 전체가 검증됐을 때만 배포 대상 정상본을 교체한다. 기존 정상 묶음으로 재배포할 수 있게 한다.

#### T4 완료 기록 (2026-09-10)

- **산출물.** `scripts/build-tourism-evidence.mjs`(CLI, 외부 호출 0) + `scripts/lib/tourism-evidence-core.mjs`(순수 로직, Jest 공유) + `package.json` `build:tourism-evidence`. 정상본 `data/tourism-evidence.json`(schemaVersion 1). 중간 산출물(`*.next.json`·`*.quality-report.json`)은 `.gitignore`. 안전 배포: 항상 `*.next.json`으로만 쓰고 `validateDocument` 통과 시 `--promote`/`--promote-only`로만 정상본 교체 → 기존 정상 묶음으로 재배포 가능.
- **연결 대상·격리.** `data/central-attractions.json`의 `hubTatsCd`(32자리 해시) ↔ `data/region-profiles.json`의 `contentId`(숫자). 두 ID를 `matched` 항목에 분리 보존. 대조는 **동일 `regionId` 안에서만** 수행 — 지역 그룹이 같아도 다른 구의 동명 장소는 연결하지 않는다.
- **이름 정규화(허용/금지).**
  - 제거: 공백과 구분 기호 `/ · ㆍ | , ~ - – —`, 그리고 유네스코 병기 토큰(`[유네스코세계유산]` 등 정확 일치). 괄호·대괄호와 그 내용은 제거하지 않는다.
  - 허용 접두: 지역 도(道) 정식 명칭·축약(`충청남도`/`충남`), 시군구명(`공주시`), 시군구명에서 끝의 시/군/구를 뗀 형태(`공주`). **한 번만** 제거.
  - 허용 접미: 끝의 `(지역명)`/`[지역명]` — 괄호 안이 위 지역명과 **정확히 같을 때만** 제거(`동학사(공주)`→`동학사`).
  - 금지: 임의의 일반 괄호 삭제(`천마총(대릉원)` 유지), 부분 문자열 매칭, 지역명이 아닌 접미 토큰 제거.
  - 파생형별 "느슨함" 등급(0 exact → 1 unesco → 2 region-paren → 3 region-prefix)을 매치 방법으로 기록.
- **자동 확정 3조건(전부 충족).** ① 정규화 파생형이 **동일**(부분 문자열 X) ② 좌표 500m 이내(제품 휴리스틱, 공식 동일 장소 보증 아님 — 주석·문서·JSON에 명시) ③ 유일 후보. 후보가 여럿이면 원문 exact 등급 후보가 유일할 때만 확정(`exact-unique`), 아니면 `ambiguous`. **좌표 결측은 자동 확정하지 않는다**(허브·후보 어느 쪽이든 `ambiguous`).
- **연결 결과 스키마.** 지역별 `matched`(contentId→근거: hubTatsCd·hubRank·method·distanceM·hubCategory·nonItineraryCategory·interestCategories, **런타임 O(1) 조회용**) / `unmatched` / `ambiguous` / `rejected`(사유·거리) / `superseded`. 상태별·사유별·방법별 집계는 `summary`.
- **동일 시설 중복.** 같은 `contentId`에 여러 허브가 걸리면 가장 높은 순위(작은 `hubRank`) 하나만 `matched`, 나머지는 `superseded`(reason `same-facility-lower-rank`).
- **카테고리.** 허브 `categoryLcls=숙박`·`categoryMcls=쇼핑/숙박`은 `nonItineraryCategory:true`로 표시만 하고 **실제 일정 제외는 T5**. 장소의 관심사는 D1 TourAPI 분류(`interestCategories`)를 그대로 보존하고 중심 카테고리로 재분류하지 않는다.
- **데이터 묶음.** `bundle.consistent` + `versionRefs`(mappingVersion `2026-09-06T23:46:42.853Z`, classificationVersion `lcls-2026-09-10`, baseYm `202608`) + 세 원천의 schemaVersion·generatedAt 참조. 셋의 버전이 하나라도 어긋나면 `buildEvidenceDocument`가 throw(섞지 않음). `dataVersion`은 세 원천 generatedAt + 스키마의 sha256 앞 16자.
- **수동 별칭.** 이번엔 넣지 않음(모델 추측 별칭 금지). 넣을 경우 실제 확인한 명칭·주소·공식 자료·확인일·두 원천 ID를 파일에 남기도록 스키마에 자리 확보.
- **전국 집계(baseYm 202608).** 중심 항목 20,705개 검토 → matched **3,317** · unmatched 16,311(전부 `no-name-match`) · ambiguous 11(`candidate-coord-missing` 7 · `multiple-candidates` 4) · rejected 1,064(`main-part-distinction` 781 · `distance-over-heuristic` 277 · `region-affix-not-normalized` 6) · superseded 2. 방법 분포 exact 2,863 · region-paren 270 · region-prefix 166 · unesco 13 · exact-unique 5. 전체 연결률 0.16(허브 분모에 숙박 6,893·쇼핑 1,439 포함). 보수적 게이트가 의도적으로 미연결을 많이 남긴다 — 기준을 느슨하게 바꾸지 않았다.
- **표본 지역 연결률.** 공주 28/100 · 경주 29/100 · 익산 20/100 · 과천 11/63 · 광명 12/93 · 파주 30/100. 미연결 주원인: 숙박·쇼핑·교통(역/터미널) 허브, 산·하천·대형 공원처럼 두 원천의 대표점이 500m 넘게 어긋나는 경우, 프로필에 없는 상호(체인·전망대 등).
- **금지 회귀 사례 판정.** ① 공주 `공산성`(허브 r2) → `공주 공산성 [유네스코 세계유산]`(125949)에 matched, `공산성연지`(2916020)에는 연결 안 됨. ② `동학사`(r8) → `동학사(공주)`(125893)에 matched, `동학사계곡`(129558)에는 연결 안 됨(허브 `동학사계곡`은 좌표 1,071m로 rejected). ③ 경주 `천마총`(r26) → `천마총(대릉원)`(126214)·`대릉원 일원`(1492402) 어디에도 연결 안 됨(rejected `main-part-distinction`). ④ `무령왕릉`(r3) → rejected(별칭/부분), `공주무령왕릉과왕릉원`(r7)만 126681에 matched 하여 별칭 중복 없음. `validateDocument`가 이 네 쌍을 정상본 교체 차단 조건으로 고정.
- **동일 시설 중복 → 최고순위 1개 예.** 청송 `송소고택`(129051): `청송송소고택`(r10)만 인정, `청송 송소고택`(r31)은 superseded. 당진 도비도(2750341): r27만 인정, `도비도항`(r42) superseded.
- **검증.** `scripts/__tests__/build-tourism-evidence.test.js` 35케이스(이름 정규화 허용/금지, 500m·유일성, 본체/부분, 좌표 결측, 복수 후보, exact-unique, 동일 시설 최고순위, 버전 정합·불일치 시 throw, 동명 지역 격리, 상태별 집계, 실제 원천 회귀 4쌍) 통과. `npm run verify` 통과, `npm run test:enhancement` 84/84 회귀 없음. 검색 경로는 JSON import만 사용해 외부 호출 0회.
- **T5로 넘길 사항.** (1) `regions[regionId].matched[contentId]`를 실제 초안에 배치된 관광지에 한해 조회해 `1/log2(1+hubRank)` 목적 근거 점수 계산(D4). (2) `nonItineraryCategory:true` 항목의 실제 일정 제외. (3) 중심 근거 없는 카드에 중심 문구 금지, `superseded`/`ambiguous`/미연결 상태 보존 표시. (4) 광주·전남·화성 등 중심 `empty` 28개 지역은 근거 0 — 카드에서 중심 문구 금지. (5) `data/tourism-evidence.json`은 `JSON.stringify` 출력이 prettier의 단일 원소 배열 축약과 달라, 재생성 후 `prettier --write` 한 번 필요(다른 데이터 정상본과 동일).

### T5: 추천·계획 소비

- lib/mvp-phase-two-search.ts, lib/mvp-phase-two-planner.ts 및 실제 연결된 activity-placement/타입/저장 모듈을 조사해 파일 범위를 확정한다. 사용자가 고정·편집한 기존 계획은 새 순위로 재생성하지 않는다.
- 새 분류와 중심 근거를 관광 후보 선정에 반영한 다음 실제 초안 지표로 목적 점수를 계산한다. 후보 지역의 모든 원천 명소로 점수를 계산한 뒤 다른 장소를 일정에 넣는 구현을 금지한다.
- interest/easy/relaxed의 선택·표시 순서와 세부 정렬을 D4대로 구현한다. 동일 데이터 버전에서 결정적 동점을 유지한다. 카드 설명은 실제 지표로 만든다.
- 기존 저장본에서 새 근거 필드가 없으면 이전 상태로 복원한다. 새 필드를 얻기 위한 자동 검색/외부 조회를 하지 않는다. 새로운 계획의 버전·근거 필드를 저장한다.
- Next.js/React 변경 전 설치된 관련 Next.js 가이드와 Vercel 성능 스킬을 읽는다. UI 재디자인·추가 입력·거리 하한은 범위 밖이다.

#### T5 완료 기록 (2026-09-10)

- **파일 범위(조사 결과).** 소비 경로는 `lib/mvp-phase-two-search.ts`(그룹·초안·역할) → `lib/mvp-phase-two-planner.ts`(`scheduleTrip`/`scheduleBaseTrip`/`selectPlaces`, 초안 선정) → `lib/mvp-phase-two-types.ts`(계약) → `lib/mvp-phase-two-storage.ts`(저장 검증·정리) → `components/mvp-phase-two/Notebook.tsx`(`NotebookCandidate` 카드)다. `rg`로 확인: `scheduleTrip`은 검색과 테스트 픽스처만 호출하고 편집(`editPlan`/`rebuildActivities`/`arrangeDay`)은 `scheduleLocalDay`만 써 관광을 재선정하지 않는다 → 초안 선정 변경이 사용자 편집·저장 복원을 건드리지 않는다. `activity-placement.ts`는 분(minute) DP만 담당해 근거 무관, 그대로 둠. 레거시 `lib/recommendation*.ts`·`components/CandidateCard.tsx`는 phase-two가 import하지 않아 제외.
- **새 모듈** `lib/tourism-evidence.ts`: `data/tourism-evidence.json`의 `regions[regionId].matched[contentId]`를 O(1) 조회. `nonItineraryCategory`(숙박·쇼핑·교통) 매치와 `hubRank ∉ [1,100]`은 연결 없음으로 취급(근거·점수·선정 신호 전부 제외). `computePurposeEvidence(placed, interests, memberRegionIds)`가 D4 점수를 만든다.
- **"실제 초안 배치 장소만 점수 근거" 보장.** `searchPhaseTwo`가 `scheduleTrip` 반환 후 `preview.blocks`의 `kind === "attraction"` 블록에서만 `attraction`을 뽑아 `computePurposeEvidence`에 넘긴다. 후보 지역의 `group.places`(전체 원천 명소)나 `candidate.attractions`는 넘기지 않는다. 관심사별로 `attraction.categories` 교집합 → `facilityGroups`로 중복 시설 제거(가장 낮은 hubRank 하나) → `1/log2(1+hubRank)` 상위 3개 합 ÷ 3 → 요청 관심사 평균. 상한 1. Jest가 `contributingContentIds ⊆ 배치 블록 contentId`를 검증한다.
- **선정 반영(D4).** `selectPlaces` 정렬에 미충족 관심사 다음, 세부 분류·근접성 앞 순서로 중심 근거 동점 규칙 추가(연결 있는 장소 우선 → 낮은 hubRank 우선). `scheduleTrip`/`scheduleBaseTrip`에 선택적 `centralHubRank` 콜백을 뚫었고 검색만 `hubRankForSelection`을 넘긴다. 편집·픽스처는 undefined → 기존 동작. 초안 알고리즘 버전 `e2-v1 → e2-v2`.
- **역할 순서.** 선택·표시 순서 `easy→interest→relaxed` → `interest→easy→relaxed`. `interest` 정렬 키: 충족 관심사 수 ↓ → 목적 근거 점수 ↓ → 세부 분류 다양성 ↓ → 실제 관광 수 ↓ → 왕복시간 ↑ → groupId ↑. `easy`/`relaxed`는 기존 이동 부담/여유 정렬 유지, 선행 선택 그룹 제외. 저장본·픽스처의 근거 결측(`unavailable`)과 `no-central-data`는 정렬에서 0으로 처리(결정적). `algorithmVersion` `e1-v1 → e1-v2`.
- **카드.** 대표 장소·추천 이유는 본문 유지. 원천명(티맵 기반)·기준월·연결 수·목적 점수는 `방문 미리보기·추천 근거`(근거 펼치기)에만 표시. 중심 근거가 없으면(`contributingContentIds` 빈 값·`no-central-data`) 중심 관광지 문구를 넣지 않고 "지역 매력 0 아님" 안내만 남긴다. `전국 역사 1위`·`가장 인기`·`영업 보장` 문구 없음.
- **저장 하위호환.** `recommendation` 검증: `algorithmVersion ∈ {e1-v1, e1-v2}`, `purpose`는 선택 필드(누락 시 그대로 복원 — 재계산·외부 조회 없음). `itineraryAlgorithmVersion ∈ {e2-v1, e2-v2}`. `cleanRecommendation`이 `purpose`를 화이트리스트로 통과, 손상된 `purpose`(점수>1 등)는 저장본 거절.
- **검증.** `npm run verify` 통과. `npm run test:enhancement` 97/97. 신규 `lib/__tests__/enhancement-tourism-evidence.test.ts`(9) + `mvp-phase-two-search.test.ts` T5 블록(2) + `lib/__tests__/mvp-phase-two-storage-v3.test.ts` T5 블록(3), 기존 역할 순서 테스트 갱신. 전체 `npx jest`는 `app/__tests__/page.test.tsx` 19실패(작업 전부터 깨진 PoC)만 남고 그 외 272 통과. 검색 경로 외부 fetch 0회(flow-e2가 tour-api mock 미호출 확인).
- **T6로 넘길 사항.** (1) 서울·부산·비광역시 출발 변경 전/후 후보·대표 명소·근거 점수 비교 보고. (2) 전국 연결률 16%(숙박·쇼핑 분모 포함)가 `interest` 역할 순위에 주는 영향 — 중심 자료 있는 지역이 동점에서 유리, `no-central-data` 28개 지역은 목적 점수 0. (3) Playwright 입력→3지역→선택→음식→계획→저장/복원과 중심 근거 실제 방문 일치. (4) `hubRankForSelection`이 허브 관심사와 장소 관심사 일치를 엄밀히 대조하지 않고 "matched면 신호"로 단순화한 점(원천 `interestCategories`가 같은 분류기 산출이라 실무상 일치).

### T6: 검증·완료

- 단위: 새 분류/하위 호환, 수집 오류·재개·완전성, 매칭 정확성, 시설 중복, 점수 상한/결측, 역할 순서·동점, 시간 불가 및 사용자 계획 보존을 Jest로 검증한다.
- 비교 입력: 서울·부산·비광역시 지원 출발 각각 역사 단일과 다른 4개 관심사, 역사+문화. 기준 08:00→다음날20:00 및 야간 출발을 포함한다. 같은 입력의 변경 전/후 후보·실제 대표 명소·근거점수·왕복/현지시간·배제 이유를 보고한다.
- 품질: 공주·경주·익산과 과천·광명·파주를 포함한 전국 지역별 원천/연결 건수를 보고한다. 특정 도시 순위를 통과 조건으로 하드코딩하지 않는다. 대표 명소 누락 복구와 실제 일정 선택 변화를 분리해 평가한다.
- 통합: 검색 중 외부 fetch를 감시/실패시키고도 추천이 동작하는지 확인한다. 단순히 브라우저 내부 API 1회만 보고 원천 호출 0이라고 주장하지 않는다.
- Playwright: 입력→최대3지역→선택→음식점→계획→교체/저장/복원. 시간표 제약과 중심 근거의 실제 방문 일치를 확인한다. 실제 무료 API 확인은 제한 표본으로 하고 대량 E2E 반복에 원천을 호출하지 않는다.
- npm run verify, 변경 범위 Jest, 핵심 E2E를 실행한다. 기존 PoC 실패와 신규 회귀를 구분한다. 코드 변경의 독립 reviewer와 PR/CI 절차는 브랜치 하네스를 따른다.
- 문서 상태/작업 체크리스트/원천 기준월을 실제 결과로 갱신하고 한글 PR에 범위·검증·미연결/결측·계정 호출량·미구현 운영 자동화를 명시한다.

#### T6 완료 기록 (2026-09-10)

- **비교**: 출발지 4개(서울/부산/강릉·수원=비광역시) × 관심사 6세트 × 시간 2개 = 48셀을 `f95699d`(before) 워크트리와 대조. 재현: `lib/__tests__/enhancement-t6-comparison.test.ts` + `scripts/report-tourism-recommendation-comparison.mjs`. 전체 표·평가는 [T6 보고서](TOURISM_RECOMMENDATION_T6_REPORT.md).
- **핵심 결과**: 수용 기준 1·2·3·4·6 충족. 대표 4명소 프로필 복구 확인(첨성대는 실제 초안에도 배치). `interest` 역할 왕복시간 중앙값 62→358분으로 원거리 대도시 쏠림(34/48셀 편도 2h+) — D4 정렬(목적 점수 > 왕복시간)에 충실한 결과이나 제품 판단 필요. 임의 튜닝하지 않고 제품 규칙 변경안 5개를 보고서 6.1에 정리.
- **성능 회귀 수정**: T5의 큰 관광 풀에서 `facilityGroups` O(n²)가 검색을 2~6배 느리게 함(부산 역사+문화 6.7s). `lib/mvp-phase-two-planner.ts`에 풀 배열 참조 `WeakMap` 메모 추가 → 2.6배 개선, 결과 바이트 동일. 이 수정 전 부산 실검색 E2E가 타임아웃으로 실패했고 수정 후 통과.
- **검증**: `npm run verify` 통과. `test:enhancement` 147 통과. `npx jest` 322 통과 / 19 실패(전부 기존 PoC `page.test.tsx`, `f95699d`에서도 동일 — 신규 회귀 0). `test:e2e --repeat-each=2` 통과(신규 `T6 중심 근거 카드…` 포함). 통합: `lib/__tests__/enhancement-t6-search-no-network.test.ts`로 fetch 차단 시에도 추천 동작 + 검색 모듈 그래프에 원천 클라이언트 없음 확인.
- **신규 파일**: `docs/development/TOURISM_RECOMMENDATION_T6_REPORT.md`, `scripts/report-tourism-recommendation-comparison.mjs`, `scripts/report-tourism-evidence-quality.mjs`, `lib/__tests__/enhancement-t6-comparison.test.ts`, `lib/__tests__/enhancement-t6-search-no-network.test.ts`, e2e `T6 중심 근거 카드…`.
- **후속**: 보고서 6절 — `interest` 원거리 쏠림(PM 결정), 연결률 16% 완화(별도 데이터 작업), 예약 수집 자동화 미구성, 중심 `empty` 28지역 원천 공백. 독립 reviewer 검토 권장.

## 다음 세션 시작점

**T1~T7 구현 완료(2026-09-10). PR #76 병합 대기.** 남은 일은 병합 절차와 그 이후다:

1. `gh pr checks 76` Verify·E2E 초록 확인 후 사용자 지시/하네스에 따라 병합. 병합 후 작업 브랜치 삭제.
2. 범위 밖으로 남긴 항목([T6 보고서](TOURISM_RECOMMENDATION_T6_REPORT.md) §6.2 연결률 16%, §3.3 중심 `empty` 28지역, §6.4 예약 수집 자동화, §7.6 목적 구간의 대도시 포화)은 별도 데이터·운영 작업으로 분리해 다룬다.
3. 새 KTDB 자료·새 중심 관광지 기준월을 확보하면 D2 절차로 재수집한다(과거 월 자동 혼합 금지).
