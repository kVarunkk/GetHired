"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { SWITCH_TARGETS, type AccountKind } from "@/helpers/user/account-switch";
import { GENERIC_EMAIL_EXAMPLES } from "@/helpers/user/company-email";
import { APPLICANT_HOME, COMPANY_HOME } from "@/helpers/user/home-path";

const COPY: Record<
  AccountKind,
  { title: string; current: string; needs: string; points: string[]; signUp: string; login: string; stay: string; home: string }
> = {
  company: {
    title: "Hire on GetHired",
    current: "a candidate account",
    needs: "Hiring needs a separate company account",
    points: [
      `Use your work email, on your company's own domain. Personal addresses such as ${GENERIC_EMAIL_EXAMPLES} aren't accepted.`,
      "Company accounts sign in with email and password, not Google.",
      "Your candidate account stays as it is. Sign back in to it any time.",
    ],
    signUp: "Sign out and create a company account",
    login: "Sign out and log in to a company account",
    stay: "Stay signed in as a candidate",
    home: APPLICANT_HOME,
  },
  applicant: {
    title: "Look for a job on GetHired",
    current: "a company account",
    needs: "Looking for a job needs a separate candidate account",
    points: [
      "Use a different email from this one: each email has one account. A personal email works, and so does Google sign-in.",
      "Your company account stays as it is. Sign back in to it any time.",
    ],
    signUp: "Sign out and create a candidate account",
    login: "Sign out and log in to a candidate account",
    stay: "Stay signed in to your company",
    home: COMPANY_HOME,
  },
};

/** Signs the user out, then opens sign-up or login for the other kind of account. */
export default function SwitchAccount({ to, email }: { to: AccountKind; email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"signUp" | "login" | null>(null);
  const copy = COPY[to];

  const switchTo = async (action: "signUp" | "login") => {
    setBusy(action);
    await createClient().auth.signOut();
    router.replace(SWITCH_TARGETS[to][action]);
    router.refresh();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 py-12">
      <div className="rounded-xl border p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <div className="mt-3 flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            You&apos;re signed in
            {email ? (
              <>
                {" "}as <span className="font-medium text-foreground">{email}</span>
              </>
            ) : null}{" "}
            with {copy.current}. {copy.needs}, so you&apos;ll be signed out first.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {copy.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <Button variant="brand" disabled={busy !== null} onClick={() => switchTo("signUp")}>
              {busy === "signUp" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {copy.signUp}
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => switchTo("login")}>
              {busy === "login" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {copy.login}
            </Button>
          </div>
          <Link
            href={copy.home}
            className="text-center text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            {copy.stay}
          </Link>
        </div>
      </div>
    </div>
  );
}
