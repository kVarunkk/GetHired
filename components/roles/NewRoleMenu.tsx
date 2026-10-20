"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_TEMPLATES } from "@/helpers/companies/role-templates";

const NEW_ROLE_PATH = "/company/settings/roles/new";

/** RP-REQ-014: "New role": blank, from a template, or a copy of an existing role. */
export default function NewRoleMenu({ roles }: { roles: { id: string; name: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="brand">
          <Plus className="mr-2 h-4 w-4" />
          New role
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={NEW_ROLE_PATH}>Blank role</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>From template</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {ROLE_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.key} asChild>
                <Link href={`${NEW_ROLE_PATH}?template=${t.key}`}>{t.name}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {roles.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Duplicate</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {roles.map((r) => (
                <DropdownMenuItem key={r.id} asChild>
                  <Link href={`${NEW_ROLE_PATH}?from=${r.id}`}>{r.name}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
