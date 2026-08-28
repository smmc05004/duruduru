import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DURUDURU | 국내 여행 추천",
  description: "목적지를 정하지 않아도 되는 국내 여행 계획 도우미",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
