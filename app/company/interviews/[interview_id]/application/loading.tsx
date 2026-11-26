import { DocumentSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <DocumentSkeleton sections={2} />
    </SectionSkeleton>
  );
}
