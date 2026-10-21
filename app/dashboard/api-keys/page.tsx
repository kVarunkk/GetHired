import ApiKeysTable from "@/components/ApiKeysTable";
import CreateApiKeyDialog from "@/components/CreateApiKeyDialog";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Keys",
  description:
    "Create API keys for MCP clients, CLI tools, and external integrations.",
  robots: { index: false, follow: false },
};

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
      <div className="flex flex-col w-full gap-6 p-4">
        <PageHeader
          title="API keys"
          description="Create API keys for MCP clients, CLI tools, and external integrations."
          actions={<CreateApiKeyDialog />}
          backHref="/dashboard"
          backLabel="Back to dashboard"
        />
        <ApiKeysTable key={tableKey} data={apiKeys || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
