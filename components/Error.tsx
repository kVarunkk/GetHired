"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="h-full w-full flex items-center justify-center flex-col gap-10 p-4 mt-10">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          An unexpected error occurred while processing your request.
        </p>
      </div>
      <div className="flex items-center gap-4 ">
        <Button asChild variant={"outline"}>
          <Link href={"/"}>Home</Link>
        </Button>
        <Button onClick={() => router.back()} variant="brand">
          Go Back
        </Button>
      </div>
    </div>
  );
}
