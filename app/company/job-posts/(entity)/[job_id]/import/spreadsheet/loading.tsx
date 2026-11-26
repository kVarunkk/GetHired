import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="p-0">
      <FormSkeleton fields={2} />
      <Skeleton aria-hidden className="h-48 w-full rounded-xl" />
    </SkeletonPage>
  );
}
