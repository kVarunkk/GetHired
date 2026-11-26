import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanySearchSelect from "./CompanySearchSelect";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const query = new URL(url, "http://localhost").searchParams.get("query");
    const names = query === "" ? ["Acme"] : query === "zeta" ? ["Zeta Labs"] : [];
    return { ok: true, json: async () => ({ companies: names.map((company_name) => ({ company_name })) }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const open = (onChange = vi.fn()) => {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CompanySearchSelect name="companyName" onChange={onChange} initialCompanies={[]} />
    </SWRConfig>,
  );
  fireEvent.click(screen.getByRole("combobox"));
  return onChange;
};

const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: text } });

describe("CompanySearchSelect", () => {
  it("searches the server, so a company outside the default list can be picked", async () => {
    const onChange = open();
    expect(await screen.findByText("Acme")).toBeInTheDocument();

    type("zeta");
    fireEvent.click(await screen.findByText("Zeta Labs"));

    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/filters?query=zeta");
    expect(onChange).toHaveBeenCalledWith("companyName", ["Zeta Labs"]);
  });

  it("says when nothing matches", async () => {
    open();
    await screen.findByText("Acme");

    type("nothing");

    expect(await screen.findByText("No companies found")).toBeInTheDocument();
  });

  it("says when the list couldn't load, not that there are no companies", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) });
    open();

    await waitFor(() => expect(screen.getByText("Couldn't load companies. Try again.")).toBeInTheDocument());
  });
});
