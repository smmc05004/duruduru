#!/bin/bash
# Stop 훅 검증 게이트: 종료 전에 하네스 검사·lint·타입 검사를 돌리고,
# 실패하면 exit 2 로 종료를 막으면서 원인을 stderr 로 에이전트에 전달한다.
#
# Jest 와 프로덕션 빌드는 매 턴 돌기에 느려서 뺐다. 그 둘을 포함한 전체 검증은
# npm run verify 이며, 작업 사이클의 verify 노드와 CI 가 실행한다.
#
# 종료 코드는 명령 치환으로 직접 잡는다. `cmd | tail` 뒤의 $? 는 파이프라인이 아니라
# 마지막 명령의 코드라서 실패가 조용히 삼켜진다.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 서로를 기다릴 이유가 없으므로 병렬로 돌린다. 매 턴 도는 훅이라 지연이 누적된다.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

CHECKS="harness lint typecheck"

(npm run --silent check:agent-harness >"$TMP/harness" 2>&1; echo $? >"$TMP/harness.code") &
(npm run --silent lint >"$TMP/lint" 2>&1; echo $? >"$TMP/lint.code") &
(npm run --silent typecheck >"$TMP/typecheck" 2>&1; echo $? >"$TMP/typecheck.code") &
wait

FAILED=""
for check in $CHECKS; do
  code=$(cat "$TMP/$check.code" 2>/dev/null || echo 1)
  [ "$code" -eq 0 ] || FAILED="$FAILED $check"
done

[ -z "$FAILED" ] && exit 0

{
  echo "검증 게이트 실패 -$FAILED"
  for check in $FAILED; do
    echo "--- $check ---"
    tail -20 "$TMP/$check"
  done
  echo
  echo "docs/agent/WORK_CYCLE.md 의 그래프에서 다시 열어야 할 노드를 확인하세요."
} >&2

exit 2
