"use client";

import { LogOut, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { Badge } from "./ui/badge";
import SocialsComponent from "./SocialsComponent";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import React from "react";
import MenuTrigger from "@/helpers/profile-dropdown/MenuTrigger";

export default function ProfileDropdown({
  user,
  open,
  isMenuOpen,
  isVertical = false,
}: {
  user: User | null;
  open?: boolean;
  isMenuOpen: boolean;
  isVertical?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const isCompanyUser = user?.app_metadata?.type === "company";
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <DropdownMenu>
      {isVertical ? (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <MenuTrigger
              user={user}
              open={open}
              isMenuOpen={isMenuOpen}
              isCompanyUser={isCompanyUser}
            />
          </TooltipTrigger>
          <TooltipContent side="right" hidden={isMenuOpen}>
            <p>Profile</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <MenuTrigger
          user={user}
          open={open}
          isMenuOpen={isMenuOpen}
          isCompanyUser={isCompanyUser}
        />
      )}

      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="flex items-center gap-2">
          <div
            title={user?.user_metadata.full_name || user?.email || "User"}
            className="truncate max-w-[120px]"
          >
            {user?.user_metadata.full_name || user?.email || "User"}
          </div>
          <Badge className="w-fit">
            {isCompanyUser ? "Company" : "Applicant"}
          </Badge>
        </DropdownMenuLabel>

        <DropdownMenuItem asChild>
          <Link
            href={`/get-started${isCompanyUser ? "?company=true" : ""}`}
            className="w-full flex items-center cursor-default gap-4"
          >
            <UserIcon className="text-muted-foreground  h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "light" ? (
              <Sun key="light" size={16} className={"text-muted-foreground"} />
            ) : theme === "dark" ? (
              <Moon key="dark" size={16} className={"text-muted-foreground"} />
            ) : (
              <Laptop
                key="system"
                size={16}
                className={"text-muted-foreground"}
              />
            )}
            <span className="ml-2">Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(e) => setTheme(e)}
              >
                <DropdownMenuRadioItem className="flex gap-2" value="light">
                  <Sun size={16} className="text-muted-foreground" />{" "}
                  <span>Light</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="flex gap-2" value="dark">
                  <Moon size={16} className="text-muted-foreground" />{" "}
                  <span>Dark</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="flex gap-2" value="system">
                  <Laptop size={16} className="text-muted-foreground" />{" "}
                  <span>System</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
          Logout
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SocialsComponent />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
