import { HeaderSkeleton, SkeletonPage, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage>
      <HeaderSkeleton back />
      <TableSkeleton columns={5} filters={1} />
    </SkeletonPage>
  );
}
