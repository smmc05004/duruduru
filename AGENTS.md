# DURUDURU 작업 규칙

기능 구현의 기준은 다음 문서를 함께 따른다.

- `docs/agent/TECH_STACK.md`
- `docs/product/PRD.md`
- `docs/product/TRAVEL_RECOMMENDATION.md`
- `docs/product/DISTANCE_CALCULATION.md`
- `docs/product/API_FETCH_FLOW.md`

이 프로젝트에서 제품 범위, 우선순위, 데이터 신뢰도 또는 사용자 흐름에 영향을 주는 작업을 시작하기 전에 다음 문서를 읽는다.

1. `.agents/pm/AGENT.md` — 지속되는 PM 역할과 권한
2. `docs/product/PRD.md` — 서비스 정의·목적·MVP 범위
3. `docs/product/TRAVEL_RECOMMENDATION.md` — 추천·일정 생성 규칙
4. `docs/product/DISTANCE_CALCULATION.md` — 시·군·구 청사 대표점 간 일반 예상 이동시간 규칙

## 기본 원칙

- DURUDURU의 핵심은 **사용 가능한 시간으로 목적지부터 추천**하는 경험이다.
- 핵심 추천과 일정 생성은 LLM이 아니라 공공데이터와 규칙/점수 기반 엔진으로 구현한다.
- 스탬프, 친구, 랭킹, 방문 인증은 현 MVP 범위에 포함하지 않는다.
- 구현 전에 두 제품 문서의 범위와 충돌 여부를 확인한다. 새 제품 판단이 필요하면 해당 문서를 먼저 갱신하거나 사용자에게 결정받는다.
- 문서와 코드가 충돌하면 코드를 임의로 확장하지 말고 문서를 갱신하거나 사용자와 결정한다.

## 개발 브랜치 규칙

- `main`은 항상 검증 가능한 기준 브랜치다. 작업은 `main`에서 직접 수행하거나 직접 push하지 않고, 목적이 하나로 좁혀진 작업 브랜치에서 진행한다.
- 브랜치 이름은 `feat/`, `fix/`, `docs/`, `chore/` 중 하나로 시작하고, 뒤에는 작업 목적을 영문 소문자 케밥 표기로 적는다. 예: `feat/recommendation-engine`, `fix/return-time-validation`. 커밋 메시지와 PR은 한글로 쓰지만, 브랜치 이름은 셸·CI·URL에서 인코딩되는 자리라 영문으로 통일한다.
- 작업 시작 전에는 `main`을 최신 상태로 맞춘 뒤 분기한다. 작업 브랜치에서는 논리적으로 독립적인 단위마다 한글 커밋 메시지로 커밋한다.
- 작업이 끝나면 PR에서 변경 범위, 검증 결과, 제품 문서 확인 여부를 점검한 뒤에만 `main`으로 병합한다. 병합된 작업 브랜치는 삭제한다.
- `main`에는 force push하지 않는다. 작업 브랜치의 이력 정리가 필요할 때만, 원격 상태를 확인한 후 `--force-with-lease`를 사용한다.
- 상세 브랜치 절차와 병합 방식은 `docs/development/BRANCH_WORKFLOW.md`를 따른다.

## MVP 구현 방식

- MVP 기능 구현 중에는 코드 리뷰, 작업 사이클, 자동 테스트·빌드·화면 점검을 수행하지 않는다. 기능 구현이 완료되면 사용자가 직접 화면을 확인한다.
- 작업 브랜치와 한글 커밋, PR 생성은 계속 사용한다.

## 지속 에이전트 역할

- 제품 범위와 의사결정은 `.agents/pm/AGENT.md`의 PM 에이전트가 관리한다.
- 구현 작업의 계획·수행·PR 준비는 `.agents/employee/AGENT.md`의 employee agent가 담당한다.
- 화면 설계와 디자인 토큰·공통 컴포넌트는 `.agents/designer/AGENT.md`의 designer agent가 담당한다.
- 구현 결과의 독립 검토는 `.agents/reviewer/AGENT.md`의 reviewer agent가 담당한다. 단, 현재 MVP 구현에서는 독립 리뷰를 생략한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
