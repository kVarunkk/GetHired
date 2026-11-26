import { AskBoxSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <AskBoxSkeleton />
      <TableSkeleton columns={5} filters={1} />
    </SectionSkeleton>
  );
}
