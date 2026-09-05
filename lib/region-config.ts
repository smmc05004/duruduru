export type RegionConfig = {
  id: string;
  name: string;
  province: string;
  zoneId: string;
  legalName: string;
};

/** TourAPI 법정동 코드와 KTDB 252존을 모두 확인한 초기 지원 지역이다. */
export const supportedRegions: RegionConfig[] = [
  {
    id: "seoul",
    name: "서울특별시",
    province: "서울특별시",
    zoneId: "ktdb-zone-2",
    legalName: "서울특별시 중구",
  },
  {
    id: "daejeon",
    name: "대전광역시",
    province: "대전광역시",
    zoneId: "ktdb-zone-68",
    legalName: "대전광역시 서구",
  },
  {
    id: "busan",
    name: "부산광역시",
    province: "부산광역시",
    zoneId: "ktdb-zone-38",
    legalName: "부산광역시 연제구",
  },
  {
    id: "gyeongju",
    name: "경주",
    province: "경상북도",
    zoneId: "ktdb-zone-207",
    legalName: "경상북도 경주시",
  },
  {
    id: "gongju",
    name: "공주",
    province: "충청남도",
    zoneId: "ktdb-zone-154",
    legalName: "충청남도 공주시",
  },
  {
    id: "gangneung",
    name: "강릉",
    province: "강원특별자치도",
    zoneId: "ktdb-zone-122",
    legalName: "강원특별자치도 강릉시",
  },
];

export const originRegions = supportedRegions.slice(0, 3);
export const destinationRegions = supportedRegions.slice(3);
