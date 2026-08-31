#!/bin/bash
# 편집 직후 그 파일만 lint 한다. 규칙의 출처는 저장소의 ESLint 설정이며,
# 이 훅은 npm 스크립트를 호출하기만 한다.
#
# 위반은 반드시 exit 2 + stderr 로 끝내야 한다. PostToolUse 훅에서 모델에게
# 내용이 전달되는 경로는 그것뿐이고, exit 1 은 사용자 화면에만 표시되어
# 편집한 에이전트는 위반 사실을 모른 채 다음 작업으로 넘어간다.

FILE_PATH=$(jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx|mjs|cjs)$ ]]; then
  exit 0
fi

# 삭제되었거나 저장소 밖의 파일은 건너뛴다.
[[ -f "$FILE_PATH" ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

OUTPUT=$(npm run --silent lint:file -- "$FILE_PATH" 2>&1)
EXIT_CODE=$?

# ESLint 의 exit 2 는 lint 위반이 아니라 설정·플러그인 오류다. 편집을 막지 않는다.
if [ "$EXIT_CODE" -eq 2 ] || [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

printf '%s\n' "$OUTPUT" >&2
exit 2
