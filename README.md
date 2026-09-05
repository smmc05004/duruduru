# DURUDURU (두루두루)

사용자가 목적지를 먼저 정하지 않아도 되는 국내 여행 추천 서비스입니다. 출발지와 정확한 출발·복귀 시간, 이동수단, 관심사를 입력하면 **주어진 시간 안에 갈 수 있는 목적지부터** 추천하고, 선택한 지역의 일정을 만듭니다.

> 기존 여행 플래너가 “경주에 가는데 무엇을 할까?”를 돕는다면, DURUDURU는 “이번 주말 이 시간에 어디를 다녀올 수 있을까?”를 먼저 해결합니다.

## 현재 상태

현재는 기능 구현을 진행하는 MVP 단계입니다. 제품 정의와 결정, 기능 명세는 아래 문서를 기준으로 합니다.

- [제품 요구사항](docs/product/PRD.md)
- [기능 명세](docs/product/FUNCTIONAL_SPEC.md)
- [제품 결정](docs/product/DECISIONS.md)

## 주요 사용자 흐름

1. 출발지, 출발·복귀 일시, 이동수단, 관심사를 입력합니다.
2. 전체 가용시간에서 왕복 예상 이동시간과 복귀 버퍼를 뺀 시간으로 목적지 후보를 걸러 점수순으로 보여 줍니다.
3. 후보마다 추천 이유, 왕복 예상 이동시간, 현지 이용 가능 시간을 함께 표시합니다.
4. 후보를 선택하면 운영시간·휴무·체류시간·이동·식사와 복귀 조건을 반영한 일정을 확인합니다.
5. 여행 기간과 지역·관심사가 맞는 축제가 있으면 일정에 반영합니다.

이동시간은 실시간 정보가 아닌 평균·추정치이며, 결과에는 추정과 데이터 결측을 구분해 표시합니다.

## 기술 스택

- Next.js 16 (App Router), React 19, TypeScript 6
- TanStack Query, Axios, Zustand
- Tailwind CSS 4
- ESLint 9 + `eslint-config-next`
- Jest + React Testing Library, Playwright
- 별도 백엔드·DB 없음

## 프로젝트 구조

```text
app/                       # App Router 화면
lib/                       # 추천·일정 도메인 로직과 데이터
e2e/                       # Playwright 화면 점검
scripts/                   # 점검·작업 사이클 스크립트
docs/product/              # 제품 요구사항·결정·계획
docs/design/               # 디자인 방향과 토큰
docs/agent/                # 에이전트 공통 규칙
.env.local.example         # TourAPI 점검용 환경변수 예시
```

파일 단위 구성은 개발 중 바뀌므로 여기에 옮겨 적지 않습니다.

## 로컬 실행

요구 사항: Node.js와 npm

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 환경변수와 TourAPI 점검

앱을 실행하는 데 API 키는 필요 없습니다. 다만 한국관광공사 TourAPI의 실제 응답을 조사하는 스크립트에는 서비스 키가 필요합니다.

1. 공공데이터포털에서 [한국관광공사 국문 관광정보 서비스_GW](https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15101578)를 활용 신청합니다.
2. `.env.local.example`을 `.env.local`로 복사합니다.
3. `TOUR_API_SERVICE_KEY`에 발급받은 서비스 키를 넣습니다. `.env.local`은 저장소에 커밋하지 않습니다.
4. 다음 명령으로 경주·공주·강릉의 관광지/문화시설과 축제 응답, 주소·좌표·운영정보 필드의 충족 여부를 확인합니다.

```bash
npm run check:tour-api
```

스크립트는 TourAPI v4.4의 법정동 코드(`lDongRegnCd`, `lDongSignguCd`)로 조회합니다. 서비스 키는 스크립트에서 URL 인코딩을 처리하므로 인코딩 키와 디코딩 키 모두 입력할 수 있습니다.
