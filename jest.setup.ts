// React Testing Library의 DOM 매처(toBeVisible, toBeDisabled 등)를 등록한다.
// `@jest/globals`의 expect를 쓰기 때문에 jest-globals 진입점을 써야 타입까지 확장된다.
import "@testing-library/jest-dom/jest-globals";
