# 관광 데이터·목적 적합성 고도화 작업 계획

> 2026-09-10: 계획 작성·기획 대조 완료. **구현 미착수 / 모델 변경 후 사용자 구현 지시 대기.** 이 문서 작성은 작업자 실행·데이터 재수집·테스트·PR 완료가 아니다.
> 제품 SSOT: [관광 데이터·목적 적합성 기획서](../product/TOURISM_RECOMMENDATION_UPGRADE.md). 다음 세션은 AGENTS.md와 employee 역할 정의, 제품 문서, 이 계획을 읽는다.

## 기준선·작업 경계

현재 검색은 lib/mvp-phase-two-search.ts가 지역 프로필·KTDB JSON을 읽는다. scripts/build-region-profile.mjs의 cat 기반 필터와 lib/mvp-phase-two-search.ts의 categoriesFor가 새 분류 미지원이다. 신규 중심 API는 표본 조회만 완료됐고 수집기·연결 인덱스·점수 구현은 없다. 기존 .env.local.example 변경은 이전 키 추가 작업이며 값이 있는 .env.local은 커밋하지 않는다.

모델 변경 후 최신 main에서 `feat/tourism-recommendation-upgrade` 등 단일 목적 영문 브랜치로 단계별 구현한다. 문서 브랜치가 미병합이면 해당 변경의 포함 여부를 먼저 확인하고 사용자 문서를 유실하지 않는다. 완료 후 한글 커밋·단일 PR을 준비하되 병합은 이후 지시/하네스에 따른다. 지금은 커밋/PR/병합을 수행한 상태가 아니다.

## 순차 작업

| 순서 | 상태             | 작업                                              | 완료 판정                                                                           |
| ---- | ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T1   | 완료(2026-09-10) | 공식 분류 코드 원본 확인·새 분류 계약·공통 해석기 | 5개 관심사에 대한 공식 코드 표, 새/구 우선순위, 미해석 집계, 네 대표 명소 회귀 검증 |
| T2   | 완료(2026-09-10) | 프로필 수집기 교체·전국 재수집                    | 페이지 완전성·중복·분류/법정동/좌표 품질 보고와 정상본 교체, 대표 명소 포함         |
| T3   | 완료(2026-09-10) | 중심 관광지 수집기·체크포인트                     | 202608 동일월·유효 지역·예산·제한 재시도·인증 중단·재개·정상본 보존 검증            |
| T4   | 미착수           | 보수적 원천 연결·데이터 묶음                      | 연결 상태별 집계, 본체/부분 금지 사례·동일 시설 중복 점수 검증                      |
| T5   | 미착수           | 실제 방문 선정·목적 근거 점수·역할 순서           | 기획 D4와 초안/카드 근거 일치, 시간·편집·저장 호환 유지                             |
| T6   | 미착수           | 결과 비교·통합 검증·인계                          | 변경 전후 비교 보고, 검색 외부 호출 0회, Jest/Playwright/verify 및 PR 근거          |

T1→T2→T3→T4→T5→T6 순서로 진행한다. 앞 단계 실패를 임의 데이터·도시 가점으로 우회하지 않는다. 일정 생성 개선만 먼저 넣고 데이터 교체가 끝났다고 표시하지 않는다.

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

### T5: 추천·계획 소비

- lib/mvp-phase-two-search.ts, lib/mvp-phase-two-planner.ts 및 실제 연결된 activity-placement/타입/저장 모듈을 조사해 파일 범위를 확정한다. 사용자가 고정·편집한 기존 계획은 새 순위로 재생성하지 않는다.
- 새 분류와 중심 근거를 관광 후보 선정에 반영한 다음 실제 초안 지표로 목적 점수를 계산한다. 후보 지역의 모든 원천 명소로 점수를 계산한 뒤 다른 장소를 일정에 넣는 구현을 금지한다.
- interest/easy/relaxed의 선택·표시 순서와 세부 정렬을 D4대로 구현한다. 동일 데이터 버전에서 결정적 동점을 유지한다. 카드 설명은 실제 지표로 만든다.
- 기존 저장본에서 새 근거 필드가 없으면 이전 상태로 복원한다. 새 필드를 얻기 위한 자동 검색/외부 조회를 하지 않는다. 새로운 계획의 버전·근거 필드를 저장한다.
- Next.js/React 변경 전 설치된 관련 Next.js 가이드와 Vercel 성능 스킬을 읽는다. UI 재디자인·추가 입력·거리 하한은 범위 밖이다.

### T6: 검증·완료

- 단위: 새 분류/하위 호환, 수집 오류·재개·완전성, 매칭 정확성, 시설 중복, 점수 상한/결측, 역할 순서·동점, 시간 불가 및 사용자 계획 보존을 Jest로 검증한다.
- 비교 입력: 서울·부산·비광역시 지원 출발 각각 역사 단일과 다른 4개 관심사, 역사+문화. 기준 08:00→다음날20:00 및 야간 출발을 포함한다. 같은 입력의 변경 전/후 후보·실제 대표 명소·근거점수·왕복/현지시간·배제 이유를 보고한다.
- 품질: 공주·경주·익산과 과천·광명·파주를 포함한 전국 지역별 원천/연결 건수를 보고한다. 특정 도시 순위를 통과 조건으로 하드코딩하지 않는다. 대표 명소 누락 복구와 실제 일정 선택 변화를 분리해 평가한다.
- 통합: 검색 중 외부 fetch를 감시/실패시키고도 추천이 동작하는지 확인한다. 단순히 브라우저 내부 API 1회만 보고 원천 호출 0이라고 주장하지 않는다.
- Playwright: 입력→최대3지역→선택→음식점→계획→교체/저장/복원. 시간표 제약과 중심 근거의 실제 방문 일치를 확인한다. 실제 무료 API 확인은 제한 표본으로 하고 대량 E2E 반복에 원천을 호출하지 않는다.
- npm run verify, 변경 범위 Jest, 핵심 E2E를 실행한다. 기존 PoC 실패와 신규 회귀를 구분한다. 코드 변경의 독립 reviewer와 PR/CI 절차는 브랜치 하네스를 따른다.
- 문서 상태/작업 체크리스트/원천 기준월을 실제 결과로 갱신하고 한글 PR에 범위·검증·미연결/결측·계정 호출량·미구현 운영 자동화를 명시한다.

## 다음 세션 시작점

T1·T2·T3 완료(2026-09-10). 다음은 **T4 — 보수적 원천 연결·배포 묶음**이다. `data/region-profiles.json`(schemaVersion 2)과 `data/central-attractions.json`(schemaVersion 1, baseYm 202608)을 입력으로 새 `scripts/build-tourism-evidence.mjs`(또는 동등 모듈)에서 `hubTatsCd`↔`contentId` 연결을 만든다. T3 완료 기록의 "T4로 넘길 사항"을 먼저 읽는다. 전국 연결률·새 가중치 품질은 구현 후 검증 대상이며 검증 완료라고 보고하지 않는다.
