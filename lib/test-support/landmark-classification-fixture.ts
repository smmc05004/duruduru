/**
 * 네 대표 명소의 확인된 TourAPI 분류 회귀 표본.
 *
 * 2026-09-10 `detailCommon2` 조회로 실측했다. 네 곳 모두 구 `cat1/2/3`가 비어 있고
 * 새 `lclsSystm1=HS`(역사관광) 계열만 존재한다 — 구 `cat2=A0201` 필터로는 누락되던
 * 레코드다. 공통 해석기가 이 표본을 역사로 판정하는지 검증에 쓴다.
 */
export type LandmarkClassificationSample = {
  contentId: string;
  title: string;
  contentTypeId: string;
  lclsSystm1: string;
  lclsSystm2: string;
  lclsSystm3: string;
  cat1: string;
  cat2: string;
  cat3: string;
  lDongRegnCd: string;
  lDongSignguCd: string;
};

export const LANDMARK_CLASSIFICATION_SAMPLES: readonly LandmarkClassificationSample[] =
  [
    {
      contentId: "125949",
      title: "공주 공산성 [유네스코 세계유산]",
      contentTypeId: "12",
      lclsSystm1: "HS",
      lclsSystm2: "HS01",
      lclsSystm3: "HS010200",
      cat1: "",
      cat2: "",
      cat3: "",
      lDongRegnCd: "44",
      lDongSignguCd: "150",
    },
    {
      contentId: "126166",
      title: "경주 불국사 [유네스코 세계유산]",
      contentTypeId: "12",
      lclsSystm1: "HS",
      lclsSystm2: "HS03",
      lclsSystm3: "HS030100",
      cat1: "",
      cat2: "",
      cat3: "",
      lDongRegnCd: "47",
      lDongSignguCd: "130",
    },
    {
      contentId: "126207",
      title: "경주 첨성대",
      contentTypeId: "12",
      lclsSystm1: "HS",
      lclsSystm2: "HS01",
      lclsSystm3: "HS011200",
      cat1: "",
      cat2: "",
      cat3: "",
      lDongRegnCd: "47",
      lDongSignguCd: "130",
    },
    {
      contentId: "127977",
      title: "익산 미륵사지 [유네스코 세계유산]",
      contentTypeId: "12",
      lclsSystm1: "HS",
      lclsSystm2: "HS01",
      lclsSystm3: "HS010700",
      cat1: "",
      cat2: "",
      cat3: "",
      lDongRegnCd: "52",
      lDongSignguCd: "140",
    },
  ];
