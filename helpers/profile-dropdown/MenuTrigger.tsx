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
            "flex items-center transition-colors",
            isVertical
              ? // px-2 centres the 32px avatar in the collapsed rail.
                "w-full gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              : "h-9 w-9 justify-center rounded-lg hover:bg-secondary",
          )}
        >
          <AvatarComponent
            user={user}
            open={open}
            isCompanyUser={isCompanyUser}
          />
          {isVertical && (
            <SidebarLabel
              open={isMenuOpen}
              trailing={
                roleLabel ? (
                  <Badge
                    variant="brand"
                    className="ml-2 px-1.5 py-0 text-[10px]"
                  >
                    {roleLabel}
                  </Badge>
                ) : undefined
              }
            >
              Profile
            </SidebarLabel>
          )}
        </button>
      </DropdownMenuTrigger>
    );
  },
);

MenuTrigger.displayName = "MenuTrigger";

export default MenuTrigger;
