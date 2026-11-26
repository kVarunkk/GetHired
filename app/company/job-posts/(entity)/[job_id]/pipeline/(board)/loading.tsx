import { AskBoxSkeleton, CardSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <AskBoxSkeleton />
      <div className="flex gap-4 overflow-hidden">
        <CardSkeleton lines={6} className="w-64 shrink-0" />
        <CardSkeleton lines={4} className="w-64 shrink-0" />
        <CardSkeleton lines={5} className="w-64 shrink-0" />
        <CardSkeleton lines={3} className="w-64 shrink-0" />
      </div>
    </SectionSkeleton>
  );
}
