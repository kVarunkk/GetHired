"use client";

import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/utils";
import React from "react";
import AvatarComponent from "./AvatarComponent";
import SidebarLabel from "@/components/SidebarLabel";

type MenuTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  user: React.ComponentProps<typeof AvatarComponent>["user"];
  open?: boolean;
  isMenuOpen: boolean;
  isCompanyUser: boolean;
  /** In the vertical sidebar the trigger is a full-width row with a label. */
  isVertical?: boolean;
};

const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(
  (
    { user, open, isMenuOpen, isCompanyUser, isVertical = false, ...props },
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
          {isVertical && <SidebarLabel open={isMenuOpen}>Profile</SidebarLabel>}
        </button>
      </DropdownMenuTrigger>
    );
  },
);

MenuTrigger.displayName = "MenuTrigger";

export default MenuTrigger;
