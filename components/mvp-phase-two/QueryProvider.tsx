"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let browserClient: QueryClient | undefined;
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 60_000,
      },
      mutations: { retry: false },
    },
  });
}
export function QueryProvider({ children }: { children: ReactNode }) {
  const client =
    typeof window === "undefined"
      ? makeClient()
      : (browserClient ??= makeClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
