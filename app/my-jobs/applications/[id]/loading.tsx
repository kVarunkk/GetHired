import { CardSkeleton, HeaderSkeleton, ListSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="max-w-3xl">
      <HeaderSkeleton back actions={1} />
      <CardSkeleton lines={4} />
      <ListSkeleton rows={3} />
    </SkeletonPage>
  );
}
