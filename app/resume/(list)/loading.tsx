import { TablePageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <TablePageSkeleton actions={1} columns={4} filters={1} />;
}
