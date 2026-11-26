import { CardGridSkeleton, DocumentSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <CardGridSkeleton count={3} lines={2} />
      <DocumentSkeleton sections={2} />
    </SectionSkeleton>
  );
}
