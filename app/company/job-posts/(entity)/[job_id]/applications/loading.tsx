import { SectionSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={2}>
      <TableSkeleton columns={5} filters={3} />
    </SectionSkeleton>
  );
}
