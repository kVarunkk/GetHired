"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { ArrowLeft } from "lucide-react";

export default function Error() {
  const router = useRouter();

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="flex flex-col gap-4 items-center">
        <h1 className="font-bold text-muted-foreground">
          Something went wrong, please try again later.
        </h1>
        <Button variant={"link"} onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> Go Back
        </Button>
        {/* <div className="flex  gap-3">
          <Link href={"/"} className="hover:underline">
            Home
          </Link>
        </div> */}
      </div>
    </div>
  );
}
