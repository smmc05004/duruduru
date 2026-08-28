export type Attraction = {
  name: string;
  category: "역사" | "자연" | "문화" | "미식";
  open: number;
  close: number;
  stayHours: number;
  closedDays?: number[];
  description: string;
};

export type Destination = {
  id: string;
  name: string;
  region: string;
  driveHours: number;
  publicHours: number;
  tags: string[];
  summary: string;
  food: string;
  attractions: Attraction[];
  festival?: { name: string; start: string; end: string };
};

export const destinations: Destination[] = [
  {
    id: "gyeongju", name: "경주", region: "경상북도", driveHours: 3.5, publicHours: 3.1,
    tags: ["역사", "문화", "미식"], summary: "천년 고도의 유적과 한옥 골목을 느긋하게 걷는 여행", food: "황남빵 · 경주식 한정식",
    attractions: [
      { name: "대릉원", category: "역사", open: 9, close: 22, stayHours: 1.5, description: "신라 왕릉이 모인 고분 공원" },
      { name: "국립경주박물관", category: "역사", open: 10, close: 18, stayHours: 2, closedDays: [1], description: "신라 문화유산을 만나는 대표 박물관" },
      { name: "불국사", category: "역사", open: 9, close: 17.5, stayHours: 2, description: "유네스코 세계유산 사찰" },
      { name: "동궁과 월지", category: "역사", open: 9, close: 22, stayHours: 1.5, description: "야경이 아름다운 신라 궁궐 터" }
    ], festival: { name: "신라문화제", start: "2026-09-10", end: "2026-09-20" }
  },
  {
    id: "gongju", name: "공주", region: "충청남도", driveHours: 1.6, publicHours: 2.1,
    tags: ["역사", "문화", "미식"], summary: "백제의 흔적을 따라 걷는, 짧지만 밀도 있는 역사 여행", food: "공주 밤 · 알밤 막걸리",
    attractions: [
      { name: "공산성", category: "역사", open: 9, close: 18, stayHours: 1.5, description: "금강을 내려다보는 백제 왕성" },
      { name: "국립공주박물관", category: "역사", open: 10, close: 18, stayHours: 1.5, closedDays: [1], description: "무령왕릉 유물을 품은 박물관" },
      { name: "무령왕릉과 왕릉원", category: "역사", open: 9, close: 18, stayHours: 1.5, description: "백제 왕실의 고분 유적" },
      { name: "제민천", category: "문화", open: 0, close: 24, stayHours: 1, description: "근대 골목과 작은 상점이 이어진 산책길" }
    ], festival: { name: "백제문화제", start: "2026-09-12", end: "2026-09-20" }
  },
  {
    id: "gangneung", name: "강릉", region: "강원특별자치도", driveHours: 2.8, publicHours: 2.3,
    tags: ["자연", "문화", "미식"], summary: "바다와 커피, 옛집을 한 번에 즐기는 동해안 여행", food: "초당순두부 · 강릉 커피",
    attractions: [
      { name: "오죽헌", category: "문화", open: 9, close: 18, stayHours: 1.5, closedDays: [1], description: "신사임당과 율곡 이이의 생가" },
      { name: "경포호", category: "자연", open: 0, close: 24, stayHours: 1.5, description: "호수와 바다가 맞닿은 산책 명소" },
      { name: "안목 커피거리", category: "미식", open: 10, close: 22, stayHours: 1.5, description: "바다를 보며 쉬어가는 커피 거리" },
      { name: "정동진", category: "자연", open: 0, close: 24, stayHours: 2, description: "동해의 대표 해안 풍경" }
    ]
  }
];
