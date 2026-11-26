import { AskBoxSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <AskBoxSkeleton />
      <TableSkeleton columns={4} filters={0} />
    </SectionSkeleton>
  );
}
