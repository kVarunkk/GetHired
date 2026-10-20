import Link from "next/link";

/** RP-REQ-016: the state shown on a page the user's role can't open. */
export default function Forbidden({ what }: { what: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="rounded-lg border p-6">
        <p className="font-semibold">You can&apos;t open {what}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your role doesn&apos;t include this. Ask an owner or someone who manages roles to change it.
        </p>
        <Link href="/company" className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-brand">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
