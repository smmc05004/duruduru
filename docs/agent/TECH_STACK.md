# 에이전트 공통 기술 기준

- Next.js App Router와 React를 사용한다. 프레임워크 API는 학습 지식 대신 현재 설치된 Next.js 문서와 코드로 확인한다.
- TypeScript를 우선하고, JavaScript는 설정·스크립트·호환 경계에 한정한다.
- 서버 상태는 TanStack Query, HTTP 요청은 Axios, 클라이언트 UI 상태는 Zustand로 구분한다.
- 스타일은 Tailwind CSS를 사용한다.
- 기본 검증은 Jest와 React Testing Library, 브라우저 핵심 흐름은 Playwright로 다룬다.
- React·Next.js 변경에서는 Vercel React Best Practices를 적용한다. 도구에서 해당 스킬을 사용할 수 없으면 관련 성능 원칙을 확인하지 않은 채 단정하지 않는다.
- 외부 공공 API는 UI가 직접 호출하지 않고 정규화된 내부 데이터 계약 뒤에 둔다.
