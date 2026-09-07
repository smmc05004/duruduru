# DURUDURU 지속 에이전트 정의

이 저장소는 네 개의 지속 에이전트 역할을 쓴다: **pm**, **employee**, **designer**, **reviewer**.

## 단일 출처(SSOT)

각 역할의 책임·권한·절차·제약의 단일 출처는 아래 정의 문서다. 도구에 묶이지 않으며, 역할 규칙을 바꿀 때는 항상 이 문서만 고친다. 다른 어떤 파일에도 규칙을 복제하지 않는다.

| 역할     | 정의 문서(SSOT)             |
| -------- | --------------------------- |
| PM       | `.agents/pm/AGENT.md`       |
| Employee | `.agents/employee/AGENT.md` |
| Designer | `.agents/designer/AGENT.md` |
| Reviewer | `.agents/reviewer/AGENT.md` |

## 도구별 배선

두 도구 모두 위 정의 문서를 참조한다. 진입 경로만 다르다.

### Claude Code

`.claude/agents/<역할>.md`가 같은 역할을 서브에이전트로 등록한다. 각 파일은 frontmatter(`name`, `description`, 필요 시 `tools`)와 "정의 문서를 읽고 따르라"는 지시만 담은 얇은 포인터다. 규칙은 담지 않는다.

- 실행: `pm`, `employee`, `designer`, `reviewer` 이름으로 서브에이전트를 스폰한다.
- 스폰된 에이전트는 먼저 `.agents/<역할>/AGENT.md`와 그 문서가 지시하는 참고 문서를 읽고 착수한다.

### Codex 및 기타 도구

Codex의 진입 문서는 저장소 루트 `AGENTS.md`다. 그 안의 `지속 에이전트 역할` 절이 각 역할과 정의 문서를 가리킨다. 폴더 기반 서브에이전트 스캐너가 없어도, 역할로 작업을 시작할 때 `.agents/<역할>/AGENT.md`를 열어 작업 지침으로 삼으면 Claude Code와 동일한 규칙이 적용된다. Codex 전용 역할 파일은 두지 않는다.

## 갱신 규칙

1. 역할 규칙 변경은 `.agents/<역할>/AGENT.md`에서만 한다.
2. `description`(언제 이 역할을 쓰는가)이 바뀌면 `.claude/agents/<역할>.md`의 frontmatter `description`과 `AGENTS.md` 표의 담당 설명을 같은 뜻으로 맞춘다.
3. 역할을 추가하거나 제거하면 `.agents/<역할>/AGENT.md`, `.claude/agents/<역할>.md`, `AGENTS.md`의 `지속 에이전트 역할` 절, `scripts/check-agent-harness.mjs`의 필수 문서 목록을 함께 갱신한다.
4. `npm run check:agent-harness`가 필수 문서 존재와 `.agents/*/AGENT.md`·`.claude/agents/*.md`의 백틱 경로를 검사한다.
