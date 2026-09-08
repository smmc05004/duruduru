import { QueryProvider } from "@/components/mvp-phase-two/QueryProvider";
import { TripPlanner } from "@/components/mvp-phase-two/TripPlanner";

export default function Page() {
  return (
    <QueryProvider>
      <TripPlanner />
    </QueryProvider>
  );
}
