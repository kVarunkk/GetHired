import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/utils/utils";
import type { SessionUser } from "@/lib/supabase/get-session-user";

function AvatarComponent({
  user,
  open,
  isCompanyUser,
}: {
  user: SessionUser | null;
  open?: boolean;
  isCompanyUser: boolean;
}) {
  return (
    <Avatar
      className={cn(
        "bg-muted h-8 w-8",
        open && "-ml-1",
        isCompanyUser ? "rounded-sm" : "",
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

export default AvatarComponent;
