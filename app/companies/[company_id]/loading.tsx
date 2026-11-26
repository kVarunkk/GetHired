import { CardSkeleton, HeaderSkeleton, SkeletonPage, TitledListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back actions={1} />
      <CardSkeleton lines={5} />
      <TitledListSkeleton rows={4} />
    </SkeletonPage>
  );
}
