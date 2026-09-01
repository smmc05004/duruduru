/*
 * 시간(소수) → 화면 표기. 추천 결과 카드와 조건 요약이 같은 규칙을 쓴다.
 * 계산에 쓰이지 않는 표시 전용 함수다.
 */

/** 3.5 → "3:30" (시안 Main.dc.html의 "이동 3:30") */
export function formatClockDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

/** 32.8 → "32시간 48분", 29 → "29시간" (시안 Main.dc.html) */
export function formatHoursAndMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours === 0) return `${minutes}분`;
  return minutes === 0 ? `${wholeHours}시간` : `${wholeHours}시간 ${minutes}분`;
}

/** 0.806 → "81%" */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
