import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { DataTableFooter, SelectFilter, SortableHeader, TextFilter } from "./DataTable";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

type Row = { id: string; name: string; status: string };

const COLUMNS: ColumnDef<Row>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    filterFn: "includesString",
  },
  { accessorKey: "status", header: "Status", filterFn: "equals" },
];

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Row ${String(i + 1).padStart(2, "0")}`,
    status: i % 2 ? "closed" : "open",
  }));

const bodyNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

const renderTable = (props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
  render(
    <DataTable
      data={rows(12)}
      columns={COLUMNS}
      noun="rows"
      filters={(table) => (
        <>
          <TextFilter table={table} column="name" placeholder="Name" />
          <SelectFilter
            table={table}
            column="status"
            allLabel="All Statuses"
            options={["open", "closed"]}
            label="Filter by status"
          />
        </>
      )}
      {...props}
    />,
  );

describe("DataTable", () => {
  it("pages ten rows at a time", async () => {
    renderTable();
    expect(bodyNames()).toHaveLength(10);
    expect(screen.getByText("Showing 1-10 of 12 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(bodyNames()).toEqual(["Row 11", "Row 12"]);
    expect(screen.getByText("Showing 11-12 of 12 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("filters, goes back to the first page and clears", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), { target: { value: "closed" } });

    expect(screen.getByText("Showing 1-6 of 6 rows")).toBeInTheDocument();
    expect(bodyNames().every((name) => Number(name!.slice(4)) % 2 === 0)).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(screen.getByText("Showing 1-10 of 12 rows")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear Filters/ })).not.toBeInTheDocument();
  });

  it("sorts from a sortable header", async () => {
    renderTable({ data: rows(3) });
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyNames()).toEqual(["Row 03", "Row 02", "Row 01"]);
  });

  it("shows the empty message across every column", async () => {
    renderTable({ emptyMessage: "Nothing here." });
    await userEvent.type(screen.getByLabelText("Filter by name"), "zzz");
    const cell = screen.getByText("Nothing here.");
    expect(cell).toHaveAttribute("colspan", "2");
    expect(screen.getByText("Showing 0-0 of 0 rows")).toBeInTheDocument();
  });

  it("counts outside filters and clears them too", async () => {
    const onClearFilters = vi.fn();
    renderTable({ externalFiltersActive: true, onClearFilters });
    await userEvent.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("uses a custom footer for server paging and shows every loaded row", () => {
    renderTable({ footer: <DataTableFooter summary="Showing 12 rows" /> });
    expect(bodyNames()).toHaveLength(12);
    expect(screen.getByText("Showing 12 rows")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("stays on a real page when rows go away", async () => {
    const { rerender } = renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    rerender(<DataTable data={rows(4)} columns={COLUMNS} noun="rows" />);
    expect(screen.getByText("Showing 1-4 of 4 rows")).toBeInTheDocument();
  });
});
