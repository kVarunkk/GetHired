"use client";

import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/utils";
import React from "react";
import AvatarComponent from "./AvatarComponent";
import SidebarLabel from "@/components/SidebarLabel";
import { Badge } from "@/components/ui/badge";

type MenuTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  user: React.ComponentProps<typeof AvatarComponent>["user"];
  open?: boolean;
  isMenuOpen: boolean;
  isCompanyUser: boolean;
  /** A company member's role ("Owner", "Admin", "Member"), shown in the vertical sidebar. */
  roleLabel?: string | null;
  /** In the vertical sidebar the trigger is a full-width row with a label. */
  isVertical?: boolean;
};

const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(
  (
    {
      user,
      open,
      isMenuOpen,
      isCompanyUser,
      roleLabel,
      isVertical = false,
      ...props
    },
    ref,
  ) => {
    return (
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          aria-label="Profile"
          {...props}
          className={cn(
            "flex items-center rounded-lg hover:bg-secondary transition-colors",
            isVertical
              ? // px-2 centres the 32px avatar in the collapsed rail.
                "w-full px-2 py-2 gap-2 overflow-hidden"
              : "h-9 w-9 justify-center",
          )}
        >
          <AvatarComponent
            user={user}
            open={open}
            isCompanyUser={isCompanyUser}
          />
          {isVertical && (
            <SidebarLabel open={isMenuOpen}>
              {roleLabel ? (
                <span className="flex items-center gap-2">
                  Profile
                  <Badge variant="brand" className="px-1.5 py-0 text-[10px]">
                    {roleLabel}
                  </Badge>
                </span>
              ) : (
                "Profile"
              )}
            </SidebarLabel>
          )}
        </button>
      </DropdownMenuTrigger>
    );
  },
);

MenuTrigger.displayName = "MenuTrigger";

export default MenuTrigger;
