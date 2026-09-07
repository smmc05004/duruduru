# DURUDURU 작업 규칙

기능 구현의 기준은 다음 문서를 함께 따른다.

- `docs/agent/TECH_STACK.md`
- `docs/development/MVP_IMPLEMENTATION_PLAN.md` — 기능·에픽의 최신 구현 상태와 다음 employee 작업
- `docs/product/PRD.md`
- `docs/product/TRAVEL_RECOMMENDATION.md`
- `docs/product/DISTANCE_CALCULATION.md`
- `docs/product/API_FETCH_FLOW.md`
- `docs/product/FOOD_DATA_POLICY.md`
- `docs/product/INTERREGIONAL_TRAVEL_TIME.md`

이 프로젝트에서 제품 범위, 우선순위, 데이터 신뢰도 또는 사용자 흐름에 영향을 주는 작업을 시작하기 전에 다음 문서를 읽는다.

1. `.agents/pm/AGENT.md` — 지속되는 PM 역할과 권한
2. `docs/product/PRD.md` — 서비스 정의·목적·MVP 범위
3. `docs/product/TRAVEL_RECOMMENDATION.md` — 추천·일정 생성 규칙
4. `docs/product/DISTANCE_CALCULATION.md` — 국가교통DB 기반 지역 간 일반 예상 이동시간 규칙
5. `docs/development/MVP_IMPLEMENTATION_PLAN.md` — 현재 구현 상태, 다음 작업, 교체 대상

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

DURUDURU는 네 개의 지속 에이전트 역할로 일한다. 각 역할의 책임·권한·절차·제약을 정의하는 문서가 그 역할의 **단일 출처(SSOT)**이며, 규칙은 그 문서에만 두고 다른 곳에 복제하지 않는다.

| 역할     | 정의 문서(SSOT)             | 담당                                                                       |
| -------- | --------------------------- | -------------------------------------------------------------------------- |
| PM       | `.agents/pm/AGENT.md`       | 제품 범위·우선순위·MVP 경계·성공 기준, 기능 요청 분류, `docs/product` 관리 |
| Employee | `.agents/employee/AGENT.md` | 명세를 작업 계획으로 분해, 작업 브랜치 구현, PR 준비                       |
| Designer | `.agents/designer/AGENT.md` | 화면·상태 설계, 디자인 토큰·공통 컴포넌트의 단일 출처                      |
| Reviewer | `.agents/reviewer/AGENT.md` | 완료된 변경의 독립 검토. 현재 MVP 구현에서는 생략한다                      |

어떤 도구(Claude Code, Codex 등)에서든 특정 역할로 작업할 때는 해당 정의 문서를 먼저 열어 그 내용을 작업 지침으로 삼고, 그 문서가 지시하는 참고 문서까지 읽은 뒤 착수한다.

- Claude Code는 `.claude/agents/<역할>.md`로 같은 역할을 서브에이전트로 등록한다. 이 파일은 정의 문서를 가리키는 얇은 포인터이며 규칙을 담지 않는다.
- Codex 등 다른 도구는 이 표의 정의 문서를 직접 읽어 같은 역할로 작업한다.
- 도구별 배선과 갱신 규칙은 `.agents/README.md`를 따른다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
