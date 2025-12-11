"use client";

import NavbarComponent from "./Navbar";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface INavItem {
  id: string;
  label: string;
  href: string;
  type: "equals" | "includes" | "startswith";
}

// For state, require active
export type INavItemWithActive = INavItem & { active: boolean };

export default function NavbarParent({
  navItems = [],
}: {
  navItems?: INavItem[];
}) {
  const [navbarItems, setNavbarItems] = useState<INavItemWithActive[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    if (navItems.length > 0 && pathname) {
      setNavbarItems(() => {
        return navItems.map((each) => ({
          ...each,
          active:
            each.type === "equals"
              ? pathname === each.href
              : each.type === "startswith"
                ? pathname.startsWith(each.href)
                : pathname.includes(each.href),
        }));
      });
    }
  }, [navItems, pathname]);

  return <NavbarComponent items={navbarItems} />;
}
