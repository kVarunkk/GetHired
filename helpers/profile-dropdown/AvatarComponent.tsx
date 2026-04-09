import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/utils/utils";
import { User } from "@supabase/supabase-js";

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
