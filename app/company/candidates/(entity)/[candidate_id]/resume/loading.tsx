import { DocumentSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <DocumentSkeleton sections={4} />
    </SectionSkeleton>
  );
}
