/* F-01/E3의 정식 지원 조건 계약. 추천 후보·이동시간 데이터는 E4에서 연결한다. */

/** `public`은 종료된 PoC 일정 투영의 호환값일 뿐 E3 지원 조건에는 넣지 않는다. */
export type TransportMode = "car" | "public";

export type RepresentativePoint = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type SupportedOrigin = {
  id: string;
  name: string;
  region: string;
  representativePoint: RepresentativePoint;
};

export type SupportedDestination = {
  id: string;
  name: string;
  region: string;
  representativePoint: RepresentativePoint;
};

export type SupportedTransport = { id: "car"; name: string };

export type SupportSet = {
  /** 허용값 또는 기준점을 바꾸면 반드시 올린다. */
  version: string;
  /** F-01 날짜·시간·여행 유형 판별의 단일 기준 */
  timeZone: "Asia/Seoul";
  origins: SupportedOrigin[];
  destinations: SupportedDestination[];
  transports: SupportedTransport[];
  source: string;
  basisDate: string;
};

const cityHall = (
  id: string,
  label: string,
  latitude: number,
  longitude: number,
): RepresentativePoint => ({ id, label, latitude, longitude });

/** 2026-09-02 사용자 승인 초기 지원 조건. */
export const supportConditionsV1: SupportSet = {
  version: "2026-09-02",
  timeZone: "Asia/Seoul",
  origins: [
    {
      id: "seoul",
      name: "서울특별시",
      region: "서울특별시",
      representativePoint: cityHall(
        "seoul-city-hall",
        "서울특별시청",
        37.5663,
        126.9779,
      ),
    },
    {
      id: "daejeon",
      name: "대전광역시",
      region: "대전광역시",
      representativePoint: cityHall(
        "daejeon-city-hall",
        "대전광역시청",
        36.3504,
        127.3845,
      ),
    },
    {
      id: "busan",
      name: "부산광역시",
      region: "부산광역시",
      representativePoint: cityHall(
        "busan-city-hall",
        "부산광역시청",
        35.1796,
        129.0756,
      ),
    },
  ],
  destinations: [
    {
      id: "gyeongju",
      name: "경주",
      region: "경상북도",
      representativePoint: cityHall(
        "gyeongju-city-hall",
        "경주시청",
        35.8562,
        129.2247,
      ),
    },
    {
      id: "gongju",
      name: "공주",
      region: "충청남도",
      representativePoint: cityHall(
        "gongju-city-hall",
        "공주시청",
        36.4465,
        127.119,
      ),
    },
    {
      id: "gangneung",
      name: "강릉",
      region: "강원특별자치도",
      representativePoint: cityHall(
        "gangneung-city-hall",
        "강릉시청",
        37.7519,
        128.8761,
      ),
    },
  ],
  transports: [{ id: "car", name: "자차" }],
  source: "DECISIONS.md 7.5절 — 2026-09-02 사용자 승인",
  basisDate: "2026-09-02",
};

/* 관심사 분류 체계는 아직 미결정이다. F-01은 1개 이상만 검증한다. */
export const interestTags = ["역사", "자연", "문화", "미식"] as const;

/**
 * 지원 조건의 읽기 경계. 현재는 번들에 포함한 승인 목록을 읽지만, 실제 저장소로 옮길 때도
 * 입력 화면이 임의 목록으로 대체하지 않고 실패·재시도를 다룰 수 있도록 명시적 경계를 둔다.
 */
export function loadSupportConditions(): SupportSet {
  return supportConditionsV1;
}
