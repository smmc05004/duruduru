# 에이전트 공통 Source Order

Codex와 Claude Code를 포함한 모든 에이전트는 문서·코드가 충돌할 때 다음 순서로 판단한다.

1. `docs/product/PRD.md` — 합의된 제품 정의와 MVP 요구사항
2. `docs/product/DECISIONS.md` — 확정·제안·보류 상태
3. `docs/product/FUNCTIONAL_SPEC.md` — 구현 가능한 기능 명세와 수용 기준
4. `docs/product/PRODUCT_PLAN.md` — 제품 방향·단계별 계획
5. 현재 코드와 테스트 — 실제 동작 및 기술 기준선
6. `docs/development/BRANCH_WORKFLOW.md`, `.agents/*/AGENT.md` — 작업·역할 절차

상위 문서와 하위 문서가 충돌하면 하위 문서를 임의로 맞추지 않는다. 제품 판단은 PM 또는 사용자에게 제안하고, 기술 사실은 현재 설치된 의존성·코드·실행 결과로 확인한다.

`제안`과 `보류` 상태는 구현 요구사항이 아니다. 정책이 없을 때 가장 작은 인터페이스·조사·테스트 준비까지만 진행하고, 임의의 상수나 동작을 추가하지 않는다.
