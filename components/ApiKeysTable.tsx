"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { UserApiTokensRow } from "@/utils/types";
import DataTable, { SortableHeader, TextFilter } from "./DataTable";
import DynamicActions from "./DynamicTableActions";
import { useRouter } from "next/navigation";

interface ApiKeysTableProps {
  data: UserApiTokensRow[];
}

export default function ApiKeysTable({ data }: ApiKeysTableProps) {
  const [items, setItems] = useState<UserApiTokensRow[]>(data);
  const router = useRouter();

  const updateLocalItem = (updatedItem: UserApiTokensRow) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    );
    router.refresh();
  };

  const removeLocalItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    router.refresh();
  };

  const columns: ColumnDef<UserApiTokensRow>[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <SortableHeader column={column} label="Created at" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {format(new Date(row.original.created_at || ""), "d MMM yyyy")}
          </div>
        ),
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div
            className="max-w-[16rem] truncate text-sm font-medium"
            title={row.original.name ?? undefined}
          >
            {row.original.name}
          </div>
        ),
      },
      {
        accessorKey: "last_used_at",
        header: ({ column }) => (
          <SortableHeader column={column} label="Last Used" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {row.original.last_used_at
              ? format(new Date(row.original.last_used_at), "d MMM yyyy")
              : "-"}
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <DynamicActions
              tableName="user_api_tokens"
              entityName="API key"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: " Name",
                  required: true,
                },
              ]}
              updateLocalItem={updateLocalItem}
              removeLocalItem={removeLocalItem}
            />
          </div>
        ),
      },
    ],
    [items],
  );

  return (
    <DataTable
      data={items}
      columns={columns}
      noun="API keys"
      filters={(table) => (
        <TextFilter table={table} column="name" placeholder="Name" />
      )}
    />
  );
}
