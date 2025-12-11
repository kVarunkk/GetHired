"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/button";
import Image from "next/image";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

export default function GoogleAuthBtn() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      const returnToPath = searchParams.get("returnTo");
      let callbackUrl = `${window.location.origin}/auth/callback`;

      if (returnToPath) {
        callbackUrl += `?next=${encodeURIComponent(returnToPath)}`;
      } else callbackUrl += `?next=/get-started`;
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl,
        },
      });
    } catch {
    } finally {
      setTimeout(() => {
        setLoading(false);
      }, 5000);
    }
  };
  return (
    <Button
      variant={"outline"}
      type="button"
      className="w-full"
      onClick={handleGoogleLogin}
      disabled={loading}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      <Image
        src={"/google-icon.svg"}
        height={15}
        width={15}
        alt="Google Icon"
      />
      Log in with Google
    </Button>
  );
}
