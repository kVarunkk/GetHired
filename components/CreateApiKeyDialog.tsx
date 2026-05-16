"use client";

import { Loader2, Plus, Copy, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useState } from "react";
import toast from "react-hot-toast";
import useSWR from "swr";
import { copyToClipboard, fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useRouter } from "next/navigation";

export default function CreateApiKeyDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const router = useRouter();

  const { mutate } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  const handleCreateApiKey = async () => {
    try {
      if (!name) throw new Error("Please enter a valid name.");
      setIsCreating(true);

      const response = await fetch("/api/user/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to create API key");
      }

      setGeneratedToken(data.token);

      toast.success("API key created successfully");

      await mutate();
      router.refresh();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = (open: boolean) => {
    setIsOpen(open);

    if (!open) {
      setName("");
      setGeneratedToken("");
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4" />
          Create API key
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {generatedToken ? "API key created" : "Create API key"}
          </DialogTitle>

          <DialogDescription>
            Create API keys for MCP clients, CLI tools, and external
            integrations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!generatedToken ? (
            <>
              <div className="space-y-2">
                <Label>Name</Label>

                <Input
                  placeholder="Claude Desktop"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="bg-input"
                />

                <p className="text-xs text-muted-foreground">
                  Use a descriptive name so you can identify this key later.
                </p>
              </div>

              <div className="rounded-lg border p-4 bg-muted/40 space-y-2">
                <div className="flex items-start gap-2">
                  <KeyRound className="w-4 h-4 mt-0.5 text-muted-foreground" />

                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Your API key will only be shown once
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Store it securely. You will not be able to view it again
                      after closing this dialog.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleCreateApiKey}
                disabled={isCreating}
                className="w-full"
              >
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create API key
              </Button>
            </>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Your new API key</p>

                  <Button
                    size={"icon"}
                    variant={"ghost"}
                    onClick={() =>
                      copyToClipboard(generatedToken, "Copied to Clipboard")
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                <div className="rounded-md border bg-background px-3 py-2 font-mono text-sm break-all">
                  {generatedToken}
                </div>
              </div>

              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                <p className="text-sm font-medium">Save this API key now</p>

                <p className="text-xs text-muted-foreground mt-1">
                  For security reasons, you will not be able to view this key
                  again after closing this dialog.
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setIsOpen(false)}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
