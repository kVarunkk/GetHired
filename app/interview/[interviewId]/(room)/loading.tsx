import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton, ListSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <HeaderSkeleton back />
      <Skeleton aria-hidden className="h-80 w-full rounded-xl" />
      <ListSkeleton rows={2} />
    </SkeletonPage>
  );
}
