import { AskBoxSkeleton, FormSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton actions={1}>
      <AskBoxSkeleton />
      <FormSkeleton fields={6} />
    </SectionSkeleton>
  );
}
