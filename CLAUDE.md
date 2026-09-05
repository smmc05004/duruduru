# DURUDURU Claude Code 진입점

이 파일은 Claude Code 전용 진입점이다. 제품·기술·작업 규칙의 단일 출처는 저장소 안의 공통 문서이며, 이 파일에 규칙을 복제하지 않는다.

@AGENTS.md
@docs/agent/TECH_STACK.md
@docs/development/MVP_IMPLEMENTATION_PLAN.md
@docs/product/PRD.md
@docs/product/TRAVEL_RECOMMENDATION.md
@docs/product/DISTANCE_CALCULATION.md

## Claude Code 전용 규칙

- 공유 프로젝트 설정은 `.claude/settings.json`에만 둔다. 인증 정보, 개인 경로, 토큰은 커밋하지 않는다.
- 훅은 공통 npm 검증 명령만 호출한다. 훅의 동작을 제품·기술 규칙의 단일 출처로 만들지 않는다.
- 편집 직후에는 `.claude/hooks/lint-changed-file.sh`가 그 파일만 lint 하고, 세션 종료 전에는 `.claude/hooks/verify-gate.sh`가 하네스 검사·lint·타입 검사를 병렬로 돌린다. Git 커밋 직전에는 공통 Husky 훅이 staged 파일만 Prettier·ESLint로 정리한다. Jest·빌드·전체 포맷 검사는 느려서 Claude 훅에 넣지 않으며 `npm run verify`와 CI에서 확인한다.
- reviewer 역할은 구현 세션과 분리된 새 Claude 세션에서 실행한다.
