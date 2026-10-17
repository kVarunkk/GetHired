"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { sendSignupEmail } from "@/app/actions/sign-up-email";
import { acceptInviteAction } from "@/app/actions/team/accept-invite";
import { APPLICANT_INVITE_MESSAGE, INVALID_INVITE_MESSAGE } from "@/helpers/team/errors";

export type JoinState = "invalid" | "signed_out" | "ready" | "wrong_email" | "applicant" | "already_member";

export type JoinInvite = {
  companyName: string;
  inviterName: string | null;
  /** The role they'll join with; null if the company has none to give. */
  roleName: string | null;
  /** RP-REQ-007: the invite's role was deleted, so they get the default role. */
  roleFellBack?: boolean;
  email: string;
};

type Props = {
  state: JoinState;
  token: string;
  invite?: JoinInvite;
  /** The signed-in user's email, when there is one. */
  signedInEmail?: string | null;
};

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 py-12">
      <div className="rounded-xl border p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-3 flex flex-col gap-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}

/** TM-REQ-003 / TMT-041: the invite landing page, for every account state. */
export default function JoinCompany({ state, token, invite, signedInEmail }: Props) {
  if (state === "invalid" || !invite) {
    return (
      <Panel title="Invite not valid">
        <p className="text-muted-foreground">{INVALID_INVITE_MESSAGE}</p>
      </Panel>
    );
  }

  const title = `Join ${invite.companyName}`;
  const intro = (
    <p className="text-muted-foreground">
      {invite.inviterName ? `${invite.inviterName} invited you` : "You've been invited"} to join{" "}
      {invite.companyName}&apos;s hiring team on GetHired
      {invite.roleName ? <> with the {invite.roleName} role</> : null}.
      {invite.roleFellBack && invite.roleName && (
        <> The role this invite was for has since been removed, so you&apos;ll join as {invite.roleName}.</>
      )}
    </p>
  );

  switch (state) {
    case "applicant":
      return (
        <Panel title={title}>
          <ErrorAlert message={APPLICANT_INVITE_MESSAGE} />
          <SignOutButton />
        </Panel>
      );
    case "wrong_email":
      return (
        <Panel title={title}>
          {intro}
          <p>
            You&apos;re signed in as <span className="font-medium [overflow-wrap:anywhere]">{signedInEmail}</span>, but this invite is for{" "}
            <span className="font-medium [overflow-wrap:anywhere]">{invite.email}</span>. Sign out, then open the link again.
          </p>
          <SignOutButton />
        </Panel>
      );
    case "already_member":
      return (
        <Panel title={title}>
          <p className="text-muted-foreground">
            Your account is already part of a company on GetHired. An account can belong to one company.
          </p>
          <Button asChild variant="outline">
            <Link href="/company">Go to your company</Link>
          </Button>
        </Panel>
      );
    case "ready":
      return (
        <Panel title={title}>
          {intro}
          <AcceptButton token={token} companyName={invite.companyName} />
        </Panel>
      );
    case "signed_out":
      return (
        <Panel title={title}>
          {intro}
          <SignedOutForms token={token} email={invite.email} companyName={invite.companyName} />
        </Panel>
      );
  }
}

function AcceptButton({ token, companyName }: { token: string; companyName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {error && <ErrorAlert message={error} />}
      <Button
        variant="brand"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await acceptInviteAction({ token });
          if (!result.ok) {
            setError(result.error);
            setBusy(false);
            return;
          }
          router.push("/company");
          router.refresh();
        }}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Join {companyName}
      </Button>
    </>
  );
}

function SignedOutForms({ token, email, companyName }: { token: string; email: string; companyName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign_up" | "sign_in">("sign_up");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p>
        Check <span className="font-medium [overflow-wrap:anywhere]">{email}</span> for a confirmation link. It brings you back here to join{" "}
        {companyName}.
      </p>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (mode === "sign_up" && password !== repeat) return setError("Passwords do not match.");

    setBusy(true);
    try {
      if (mode === "sign_up") {
        const result = await sendSignupEmail(email, password, true, { inviteToken: token, fullName: name });
        if (!result.success) return setError(result.error ?? "Couldn't sign you up. Please try again.");
        setSent(true);
      } else {
        const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
        if (signInError) return setError(signInError.message);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="join-email">Email</Label>
        <Input id="join-email" type="email" value={email} readOnly disabled />
      </div>
      {mode === "sign_up" && (
        <div className="grid gap-2">
          <Label htmlFor="join-name">Your name</Label>
          <Input
            id="join-name"
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="join-password">Password</Label>
        <Input
          id="join-password"
          type="password"
          value={password}
          autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {mode === "sign_up" && (
        <div className="grid gap-2">
          <Label htmlFor="join-repeat">Repeat password</Label>
          <Input
            id="join-repeat"
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>
      )}
      {error && <ErrorAlert message={error} />}
      <Button type="submit" variant="brand" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {mode === "sign_up" ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-muted-foreground">
        {mode === "sign_up" ? "Already have an account? " : "New to GetHired? "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
          onClick={() => {
            setMode(mode === "sign_up" ? "sign_in" : "sign_up");
            setError(null);
          }}
        >
          {mode === "sign_up" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
}
