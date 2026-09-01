/*
 * 지원 조건(출발지·이동수단) 목록.
 *
 * ⚠ 이 목록은 **정식 정책이 아니다.** docs/product/DECISIONS.md에서
 *   - "초기 지역", "초기 이동수단", "출발지 단위"가 모두 `제안` 상태다.
 * 그래서 값은 확정 정책이 아니라 PoC 목업(lib/mock-data.ts의 목적지와 app/page.tsx PoC 폼)에서
 * 이어받은 임시값이며, `provisional: true`와 `source`로 그 사실을 드러낸다.
 *
 * docs/product/FUNCTIONAL_SPEC.md의 F-01은 "정식 허용값은 지원 지역·이동수단 결정 후
 * 데이터 계층이 제공한다"고 정한다. 따라서 검증 로직은 이 목록을 하드코딩으로 읽지 않고
 * `SupportSet`을 인자로 받는다. 데이터 계층이 생기면 이 모듈만 교체된다.
 */

export type TransportMode = "car" | "public";

export type SupportedOrigin = {
  id: string;
  /** 표시명 */
  name: string;
  /** 행정권역. 데이터 계약의 필수 필드다. */
  region: string;
};

export type SupportedTransport = {
  id: TransportMode;
  name: string;
  /** 정식 지원 여부. false면 화면에서 고를 수 없고 검증도 통과시키지 않는다. */
  supported: boolean;
  /** 고를 수 없는 이유. 화면이 그대로 보여 준다. */
  unsupportedReason?: string;
};

export type SupportSet = {
  origins: SupportedOrigin[];
  transports: SupportedTransport[];
  /** 목록이 확정 정책인지 임시값인지 */
  provisional: boolean;
  /** 목록의 출처 */
  source: string;
  /** 지원 조건 데이터의 기준 시각. 데이터 계층이 생기면 collectedAt에서 온다. */
  basisDate: string;
};

export const provisionalSupportSet: SupportSet = {
  origins: [
    { id: "seoul", name: "서울", region: "서울특별시" },
    { id: "daejeon", name: "대전", region: "대전광역시" },
    { id: "busan", name: "부산", region: "부산광역시" },
  ],
  transports: [
    { id: "car", name: "자차", supported: true },
    {
      id: "public",
      name: "대중교통",
      supported: false,
      unsupportedReason: "대중교통은 아직 준비 중이라 고를 수 없어요.",
    },
  ],
  provisional: true,
  source:
    "PoC 목업(lib/mock-data.ts, 이전 app/page.tsx 폼)에서 이어받은 임시 목록",
  basisDate: "2026-08-30",
};

/*
 * 관심사 태그 목록도 임시값이다. DECISIONS.md에 관심사 분류에 대한 결정이 없고,
 * 이 값은 lib/mock-data.ts의 `Attraction.category`에서 이어받았다.
 * 관심사는 0개 이상이므로 검증 대상이 아니고, 화면의 선택지 제공에만 쓴다.
 */
export const provisionalInterestTags = [
  "역사",
  "자연",
  "문화",
  "미식",
] as const;
