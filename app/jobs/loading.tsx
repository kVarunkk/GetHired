import LoadingClientHelper from "@/components/LoadingClientHelper";
import { Suspense } from "react";

export default function Loading() {
  // Add fallback UI that will be shown while the route is loading.
  return (
    <div className="h-screen w-screen flex items-center justify-center text-muted-foreground text-center">
      <div className="flex flex-col gap-4 items-center">
        <div>Loading 2200+ Jobs...</div>
        <Suspense>
          <LoadingClientHelper />
        </Suspense>
      </div>
    </div>
  );
}
