"use client";

import { useCallback, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
// import { IBookmark } from "@/utils/types";
import { ExternalLink } from "lucide-react";
import AlertStatusSwitch from "./AlertStatusSwitch";
import InfoTooltip from "./InfoTooltip";
import DataTable, { FilterSelect, SortableHeader, TextFilter } from "./DataTable";
import DynamicActions from "./DynamicTableActions";
import { BookmarkRow } from "@/utils/types";

interface JobsBookmarkTableProps {
  data: BookmarkRow[];
}

const alertStatuses = [
  { label: "Active", value: "true" },
  { label: "Disabled", value: "false" },
];

export default function JobsBookmarkTable({ data }: JobsBookmarkTableProps) {
  const [items, setItems] = useState<BookmarkRow[]>(data);
  const alertCount = data.filter((each) => each.is_alert_on).length;

  const updateLocalItem = useCallback(
    (updatedItem: BookmarkRow) => {
      setItems((prev) =>
        prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
      );
    },
    [setItems],
  );

  const removeLocalItem = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [setItems],
  );

  const columns: ColumnDef<BookmarkRow>[] = useMemo(
    () => [
      {
        accessorKey: "is_alert_on",
        header: () => (
          <div className="flex items-center">
            Alert
            <InfoTooltip
              content={
                "You will receive weekly update of the latest jobs for the bookmark on your email."
              }
            />
          </div>
        ),
        cell: ({ row }) => (
          <AlertStatusSwitch
            bookmark={row.original}
            updateLocalItem={updateLocalItem}
            alertCount={alertCount}
          />
        ),
        filterFn: "equals",
        size: 100,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortableHeader column={column} label="Name" />
        ),
        cell: ({ row }) => (
          <Link
            href={row.original.url ?? ""}
            target="_blank"
            className="font-medium hover:underline flex items-center"
            title={row.original.name}
          >
            <div className="truncate">{row.original.name}</div>{" "}
            <ExternalLink className="shrink-0 h-4 w-4" />
          </Link>
        ),
        size: 170,
      },

      {
        accessorKey: "url",
        header: "URL",
        cell: ({ row }) => (
          <div className="flex items-center ">
            <div className="text-sm  truncate" title={row.original.url ?? ""}>
              {row.original.url}
            </div>
            <InfoTooltip content={row.original.url} />
          </div>
        ),
        filterFn: "includesString",
        size: 350,
      },

      {
        id: "actions2",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <DynamicActions
              tableName="bookmarks"
              entityName="Bookmark"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: "Name",
                  required: true,
                },
                {
                  name: "url",
                  label: "URL",
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
    [removeLocalItem, updateLocalItem, alertCount],
  );

  return (
    <DataTable
      data={items}
      columns={columns}
      noun="bookmarks"
      fixedLayout
      cellClassName="px-6"
      filters={(table) => (
        <>
          <TextFilter
            table={table}
            column="name"
            placeholder="Bookmark Name"
            className="w-[160px]"
          />
          <FilterSelect
            value={
              table.getColumn("is_alert_on")?.getFilterValue()?.toString() ??
              null
            }
            onChange={(value) =>
              table
                .getColumn("is_alert_on")
                ?.setFilterValue(value === null ? undefined : value === "true")
            }
            allLabel="All"
            options={alertStatuses}
            label="Filter by alert status"
            className="w-[120px]"
          />
        </>
      )}
    />
  );
}
