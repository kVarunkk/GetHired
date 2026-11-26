import { CardGridSkeleton, CardSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-4xl">
      <HeaderSkeleton />
      <CardSkeleton lines={4} />
      <CardGridSkeleton lines={5} />
    </SkeletonPage>
  );
}
