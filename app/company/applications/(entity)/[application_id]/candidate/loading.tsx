import { CardSkeleton, DocumentSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DocumentSkeleton className="lg:col-span-2" />
        <CardSkeleton lines={5} />
      </div>
    </SectionSkeleton>
  );
}
