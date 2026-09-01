/**
 * TourAPI가 DURUDURU 일정 생성에 필요한 데이터를 실제로 주는지 확인하는 프로브.
 * 사용: TOUR_API_SERVICE_KEY=... npm run check:tour-api
 */
const key = process.env.TOUR_API_SERVICE_KEY;
const baseUrl = "https://apis.data.go.kr/B551011/KorService2";

if (!key) {
  console.error(
    "TOUR_API_SERVICE_KEY가 없습니다. .env.local.example을 .env.local로 복사해 서비스키를 넣은 뒤 실행하세요.",
  );
  process.exit(1);
}

// data.go.kr의 Encoding/Decoding 키 어느 쪽을 넣어도 URLSearchParams에서 한 번만 인코딩한다.
let serviceKey = key;
try {
  serviceKey = decodeURIComponent(key);
} catch {
  /* 이미 Decoding 키이거나 percent-encoding이 아님 */
}

// TourAPI v4.4: 기존 areaCode/sigunguCode가 삭제되어 법정동 코드로 조회한다.
const targets = ["경주", "공주", "강릉"];

async function request(endpoint, params) {
  const url = new URL(`${baseUrl}/${endpoint}`);
  url.search = new URLSearchParams({
    serviceKey,
    MobileOS: "ETC",
    MobileApp: "DURUDURU_POC",
    _type: "json",
    numOfRows: "20",
    pageNo: "1",
    ...params,
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const payload = await response.json();
  const header = payload?.response?.header;
  const publicError = payload?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (header?.resultCode !== "0000")
    throw new Error(
      `${endpoint}: ${header?.resultCode ?? publicError?.returnReasonCode ?? "unknown"} ${header?.resultMsg ?? publicError?.returnAuthMsg ?? publicError?.errMsg ?? "unexpected response"}`,
    );
  return payload?.response?.body?.items?.item ?? [];
}

function asList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function truthy(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function introField(intro, base) {
  return (
    [
      intro[base],
      intro[`${base}culture`],
      intro[`${base}festival`],
      intro[`${base}leports`],
      intro[`${base}shopping`],
      intro[`${base}food`],
    ].find(truthy) ?? ""
  );
}

async function inspectDestination(target, codes) {
  const legalCode = codes.find((item) => item.lDongSignguNm === `${target}시`);
  if (!legalCode)
    throw new Error(
      `ldongCode2에서 ${target}시 법정동 코드를 찾지 못했습니다.`,
    );
  const [attractions, culturalFacilities] = await Promise.all([
    request("areaBasedList2", {
      lDongRegnCd: legalCode.lDongRegnCd,
      lDongSignguCd: legalCode.lDongSignguCd,
      contentTypeId: "12",
    }),
    request("areaBasedList2", {
      lDongRegnCd: legalCode.lDongRegnCd,
      lDongSignguCd: legalCode.lDongSignguCd,
      contentTypeId: "14",
    }),
  ]);
  const places = [...asList(attractions), ...asList(culturalFacilities)];
  const samples = places.slice(0, 5);
  const details = [];
  for (const place of samples) {
    const intro =
      asList(
        await request("detailIntro2", {
          contentId: String(place.contentid),
          contentTypeId: String(place.contenttypeid),
        }),
      )[0] ?? {};
    details.push({
      name: place.title,
      id: place.contentid,
      hasAddress: truthy(place.addr1),
      hasCoordinates: truthy(place.mapx) && truthy(place.mapy),
      hasHours: truthy(introField(intro, "usetime")),
      hasClosedDays: truthy(introField(intro, "restdate")),
      hours:
        introField(intro, "usetime")
          .replace(/<[^>]+>/g, " ")
          .slice(0, 90) || "—",
      closedDays:
        introField(intro, "restdate")
          .replace(/<[^>]+>/g, " ")
          .slice(0, 70) || "—",
    });
  }
  const festivalStart = new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  const festivals = asList(
    await request("searchFestival2", {
      lDongRegnCd: legalCode.lDongRegnCd,
      lDongSignguCd: legalCode.lDongSignguCd,
      eventStartDate: festivalStart,
    }),
  );
  return {
    target,
    legalCode,
    places: places.length,
    details,
    festivals: festivals.slice(0, 3).map((festival) => ({
      title: festival.title,
      start: festival.eventstartdate,
      end: festival.eventenddate,
    })),
  };
}

console.log("\nDURUDURU TourAPI data probe\n");
let operationalTotal = 0;
let operationalCovered = 0;
const codes = asList(
  await request("ldongCode2", { lDongListYn: "Y", numOfRows: "1000" }),
);
for (const target of targets) {
  try {
    const result = await inspectDestination(target, codes);
    console.log(
      `## ${target}: 법정동 ${result.legalCode.lDongRegnCd}-${result.legalCode.lDongSignguCd}, 관광지·문화시설 ${result.places}건, 현재 이후 축제 ${result.festivals.length}건`,
    );
    console.table(
      result.details.map(
        ({
          name,
          id,
          hasAddress,
          hasCoordinates,
          hasHours,
          hasClosedDays,
        }) => ({
          name,
          id,
          address: hasAddress ? "Y" : "N",
          coordinates: hasCoordinates ? "Y" : "N",
          hours: hasHours ? "Y" : "N",
          closedDays: hasClosedDays ? "Y" : "N",
        }),
      ),
    );
    for (const detail of result.details) {
      operationalTotal += 1;
      if (detail.hasHours || detail.hasClosedDays) operationalCovered += 1;
    }
    if (result.festivals.length) console.table(result.festivals);
  } catch (error) {
    console.error(`## ${target}: ${error.message}`);
  }
}
console.log(
  `\n운영 정보(운영시간 또는 휴무일) 충족률: ${operationalCovered}/${operationalTotal} (${operationalTotal ? Math.round((operationalCovered / operationalTotal) * 100) : 0}%)`,
);
console.log(
  "판정: 주소·좌표·관광지/축제 목록은 TourAPI로 검증 가능. 운영 정보가 없는 관광지는 별도 보완 데이터 또는 카테고리 기본값이 필요합니다.",
);
