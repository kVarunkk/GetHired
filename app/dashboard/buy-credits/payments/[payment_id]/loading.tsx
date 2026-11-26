import { CardGridSkeleton, CardSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back />
      <CardGridSkeleton lines={2} />
      <CardSkeleton lines={6} />
    </SkeletonPage>
  );
}
