import { AskBoxSkeleton, HeaderSkeleton, ListSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton />
      <AskBoxSkeleton />
      <ListSkeleton rows={5} />
    </SkeletonPage>
  );
}
