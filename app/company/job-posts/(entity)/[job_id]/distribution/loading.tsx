import { AskBoxSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <AskBoxSkeleton />
      <TableSkeleton columns={4} filters={0} />
      <TableSkeleton columns={3} filters={0} />
    </SectionSkeleton>
  );
}
