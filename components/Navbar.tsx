"use client";

import { AuthButton } from "./auth-button";
import ProfileDropdown from "./ProfileDropdown";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import Brand from "./Brand";
import { cn } from "@/lib/utils";
import { INavItemWithActive } from "./NavbarParent";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { Link as ModifiedLink } from "react-transition-progress/next";
import FeedbackForm from "./FeedbackForm";

export default function NavbarComponent({
  items,
}: {
  items: INavItemWithActive[];
}) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    })();
  }, []);

  return (
    <div className="w-full flex items-center justify-between px-4 py-3 lg:px-20 xl:px-40 2xl:px-80 border-b">
      <div className="flex items-center gap-1">
        {items ? <NavbarSheet items={items} /> : ""}
        <Link href={"/"}>
          <Brand type="long" />
        </Link>
      </div>
      {items ? (
        <div className=" items-center gap-4 text-sm hidden md:flex">
          {items.map((item) => (
            <ModifiedLink
              key={item.id}
              href={item.href}
              className={cn(
                "hover:underline underline-offset-2",
                item.active && "underline underline-offset-2"
              )}
            >
              {item.label}
            </ModifiedLink>
          ))}
        </div>
      ) : (
        ""
      )}
      <div>
        {user ? (
          <div className="flex items-center gap-5">
            <FeedbackForm user={user} />
            <ProfileDropdown user={user} />
          </div>
        ) : (
          <div className="">
            <AuthButton />
          </div>
        )}
      </div>
    </div>
  );
}

const NavbarSheet = ({ items }: { items: INavItemWithActive[] }) => {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button onClick={() => setOpen(true)} className="md:hidden p-2">
        <Menu />
      </button>
      <SheetContent
        side={"left"}
        className="overflow-y-auto flex flex-col gap-4 items-start"
      >
        <SheetHeader>
          <SheetTitle>
            <Link href={"/"}>
              <Brand type="long" />
            </Link>
          </SheetTitle>
        </SheetHeader>

        {items ? (
          <div className="flex flex-col gap-3 items-start ">
            {items.map((item) => (
              <ModifiedLink
                key={item.id}
                href={item.href}
                className={cn(
                  "hover:underline underline-offset-2",
                  item.active && "underline underline-offset-2"
                )}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </ModifiedLink>
            ))}
          </div>
        ) : (
          ""
        )}
      </SheetContent>
    </Sheet>
  );
};
