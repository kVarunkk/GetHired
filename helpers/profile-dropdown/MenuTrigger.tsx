"use client";

import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/utils";
import React from "react";
import AvatarComponent from "./AvatarComponent";

const MenuTrigger = React.forwardRef<HTMLButtonElement, any>(
  ({ user, open, isMenuOpen, isCompanyUser, ...props }, ref) => {
    return (
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          {...props}
          className={cn(
            "flex items-center w-full p-2 gap-2 hover:bg-secondary transition-all rounded-lg",
            isMenuOpen ? "justify-start" : "justify-center",
          )}
        >
          <AvatarComponent
            user={user}
            open={open}
            isCompanyUser={isCompanyUser}
          />
          {isMenuOpen && <span className="text-sm">Profile</span>}
        </button>
      </DropdownMenuTrigger>
    );
  },
);

MenuTrigger.displayName = "MenuTrigger";

export default MenuTrigger;
