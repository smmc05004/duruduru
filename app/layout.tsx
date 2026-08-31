import type { Metadata } from "next";
import { Gaegu, Gothic_A1, Jua } from "next/font/google";
import "./globals.css";
import "./tokens.css";

/*
 * 확정 방향 H의 서체(docs/design/DESIGN_TOKENS.md 타이포그래피 표).
 *
 * `@import url(...)`(PoC가 쓰는 방식) 대신 next/font/google을 쓴 근거:
 * `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`가 Google Font를 자동으로
 * self-host해 외부 요청과 레이아웃 이동을 없앤다고 설명하고,
 * `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`의 `variable` 옵션이
 * CSS 커스텀 프로퍼티로 넘기는 방법을 제공한다. 토큰이 이미 CSS 변수라 이 방식이 그대로 맞물린다.
 * `@import`는 CSS 안에서 렌더를 막는 추가 왕복을 만들고 self-host 이점을 못 쓴다.
 * PoC의 기존 `@import`는 기준선 외관을 지키기 위해 그대로 둔다.
 *
 * `subsets: ["latin"]`은 preload 대상 지정이다. 세 서체 모두 Google 메타데이터의 선택 가능한
 * subset이 latin뿐이지만(`node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`),
 * next/font는 CSS에 있는 @font-face 전부를 self-host하므로 한글 글리프도 함께 서비스된다.
 * preload만 latin으로 제한된다.
 *
 * `.variable`만 쓰고 `.className`은 쓰지 않는다. `.className`은 요소에 font-family를 직접
 * 적용해서 PoC 화면의 서체까지 바꾼다.
 */
const jua = Jua({ weight: "400", subsets: ["latin"], variable: "--font-jua", display: "swap" });
const gaegu = Gaegu({ weight: "700", subsets: ["latin"], variable: "--font-gaegu", display: "swap" });
const gothicA1 = Gothic_A1({
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-gothic-a1",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DURUDURU | 국내 여행 추천",
  description: "목적지를 정하지 않아도 되는 국내 여행 계획 도우미",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${jua.variable} ${gaegu.variable} ${gothicA1.variable}`}>
      <body>{children}</body>
    </html>
  );
}
