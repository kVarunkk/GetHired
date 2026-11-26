import { CardGridSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <HeaderSkeleton />
      <CardGridSkeleton count={4} lines={3} className="md:grid-cols-2" />
    </SkeletonPage>
  );
}
