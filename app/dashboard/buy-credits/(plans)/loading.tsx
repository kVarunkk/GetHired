import { CardGridSkeleton, HeaderSkeleton, ListSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton actions={1} />
      <CardGridSkeleton lines={4} />
      <ListSkeleton rows={5} />
    </SkeletonPage>
  );
}
