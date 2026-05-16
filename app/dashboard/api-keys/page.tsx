import ApiKeysTable from "@/components/ApiKeysTable";
import BackButton from "@/components/BackButton";
import CreateApiKeyDialog from "@/components/CreateApiKeyDialog";
import ErrorComponent from "@/components/Error";
import { createClient } from "@/lib/supabase/server";

export default async function ApiKeysPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: apiKeys, error: apiKeysError } = await supabase
      .from("user_api_tokens")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (apiKeysError) {
      throw apiKeysError;
    }

    const tableKey = `${apiKeys?.length || 0}-${apiKeys?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-8 p-4">
        <div>
          <BackButton />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h1 className="text-3xl font-medium ">API keys</h1>
            <CreateApiKeyDialog />
          </div>
          <p className="text-lg text-muted-foreground">
            Create API keys for MCP clients, CLI tools, and external
            integrations
          </p>
        </div>
        <ApiKeysTable key={tableKey} data={apiKeys || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
