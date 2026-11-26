import { AskBoxSkeleton, CardSkeleton, ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton back>
      <AskBoxSkeleton />
      <CardSkeleton lines={2} />
      <ListSkeleton rows={5} action />
    </SectionSkeleton>
  );
}
