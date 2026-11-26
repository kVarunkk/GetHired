import { AskBoxSkeleton, FormSkeleton, ListSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton back>
      <AskBoxSkeleton />
      <FormSkeleton fields={4} />
      <ListSkeleton rows={4} />
    </SectionSkeleton>
  );
}
