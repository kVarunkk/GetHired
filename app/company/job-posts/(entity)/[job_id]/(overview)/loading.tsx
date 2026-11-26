import { CardGridSkeleton, DocumentSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <DocumentSkeleton className="xl:col-span-2" />
        <CardGridSkeleton count={3} lines={2} className="content-start sm:grid-cols-2 xl:grid-cols-1" />
      </div>
    </SectionSkeleton>
  );
}
