import { CardSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <HeaderSkeleton />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={3} />
    </SkeletonPage>
  );
}
