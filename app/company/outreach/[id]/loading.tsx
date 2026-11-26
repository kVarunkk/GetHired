import { AskBoxSkeleton, CardSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="max-w-3xl">
      <HeaderSkeleton back />
      <AskBoxSkeleton />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
    </SkeletonPage>
  );
}
