"use client";

import { cn } from "@/lib/utils";
import { DiscordLogoIcon, GitHubLogoIcon } from "@radix-ui/react-icons";
import { BriefcaseBusiness } from "lucide-react";
import Link from "next/link";

export default function SocialsComponent({
  isFooter = false,
}: {
  isFooter?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center   text-muted-foreground",
        isFooter
          ? "gap-4 mb-5 justify-center md:justify-start"
          : "justify-between"
      )}
    >
      <Link
        className="hover:text-primary p-2"
        href={"mailto:varun@devhub.co.in"}
        aria-label="Contact Support"
        title="Contact Support"
      >
        <BriefcaseBusiness size={16} />
      </Link>
      <Link
        className="hover:text-primary p-2"
        href={"https://discord.gg/6xvKBqW5eW"}
        target="_blank"
        aria-label="Join Community"
        title="Join Community"
      >
        <DiscordLogoIcon />
      </Link>

      <Link
        className="hover:text-primary p-2"
        href={"https://github.com/kVarunkk/GetHired"}
        target="_blank"
        aria-label="View Code"
        title="View Code"
      >
        <GitHubLogoIcon />
      </Link>
    </div>
  );
}
