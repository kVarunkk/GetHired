import { AskBoxSkeleton, FormSkeleton, SectionSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SectionSkeleton>
      <AskBoxSkeleton />
      <FormSkeleton fields={5} />
    </SectionSkeleton>
  );
}
