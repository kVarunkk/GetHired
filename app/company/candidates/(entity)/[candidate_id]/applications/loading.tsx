import { SectionSkeleton, TableSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <TableSkeleton columns={4} filters={0} />
    </SectionSkeleton>
  );
}
