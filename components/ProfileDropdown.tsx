"use client";

import { cn } from "@/lib/utils";
import { LayoutDashboard, LogOut, User as UserIcon } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { useRouter } from "next/navigation";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "./ui/badge";
import SocialsComponent from "./SocialsComponent";

export default function ProfileDropdown({
  user,
  open,
}: {
  user: User | null;
  open?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [isCompanyUser, setIsCompanyUser] = useState(false);

  const router = useRouter();
  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  };

  useEffect(() => {
    (async () => {
      if (user && user.app_metadata.type) {
        setIsCompanyUser(user.app_metadata.type === "company");
      }
    })();
  }, [user]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button>
          <AvatarComponent
            user={user}
            open={open}
            isCompanyUser={isCompanyUser}
          />
        </button>
      </DropdownMenuTrigger>
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
        <DropdownMenuItem>
          <Link
            className="w-full flex items-center cursor-default gap-4"
            href={isCompanyUser ? "/company" : "/dashboard"}
          >
            <LayoutDashboard className="text-muted-foreground h-4 w-4" />
            Dashboard
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem>
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

function AvatarComponent({
  user,
  open,
  isCompanyUser,
}: {
  user: User | null;
  open?: boolean;
  isCompanyUser: boolean;
}) {
  return (
    <Avatar
      className={cn(
        "bg-muted",
        open && "-ml-1",
        isCompanyUser ? "rounded-sm" : ""
      )}
    >
      <AvatarImage
        src={user?.user_metadata.avatar_url || "/default-avatar.png"}
      />
      <AvatarFallback className="text-xs uppercase">
        {user?.email?.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}
