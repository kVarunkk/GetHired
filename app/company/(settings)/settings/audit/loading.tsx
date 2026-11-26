import {
  AskBoxSkeleton,
  SectionHeaderSkeleton,
  SkeletonPage,
  TableSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage className="mb-20 max-w-4xl p-0">
      <SectionHeaderSkeleton />
      <AskBoxSkeleton />
      <TableSkeleton columns={4} filters={2} />
    </SkeletonPage>
  );
}
