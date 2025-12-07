import Error from "@/components/Error";
import NavbarParent, { INavItem } from "@/components/NavbarParent";
import { v4 as uuidv4 } from "uuid";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const navItems: INavItem[] = [
      {
        id: uuidv4(),
        label: "Home",
        href: "/",
        type: "equals",
      },
      {
        id: uuidv4(),
        label: "Jobs",
        href: "/jobs",
        type: "startswith",
      },
      {
        id: uuidv4(),
        label: "Companies",
        href: "/companies",
        type: "startswith",
      },
    ];

    return (
      <div className="h-screen w-screen overflow-x-hidden">
        <NavbarParent navItems={navItems} />
        <div className="w-full px-4 py-5 lg:px-20 xl:px-40 2xl:px-80">
          {children}
        </div>
      </div>
    );
  } catch {
    return <Error />;
  }
}
