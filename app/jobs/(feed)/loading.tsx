import LoadingClientHelper from "@/components/LoadingClientHelper";
import { FeedSkeleton, SkeletonNote } from "@/components/skeletons";

export default function Loading() {
  return (
    <FeedSkeleton
      note={
        <SkeletonNote>
          <LoadingClientHelper />
        </SkeletonNote>
      }
    />
  );
}
