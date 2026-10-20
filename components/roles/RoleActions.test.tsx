import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { deleteRoleAction } from "@/app/actions/roles/delete-role";
import { DeleteRoleDialog, type RoleActionsRole } from "./RoleActions";

vi.mock("@/app/actions/roles/delete-role", () => ({ deleteRoleAction: vi.fn() }));
vi.mock("@/app/actions/roles/set-default-role", () => ({ setDefaultRoleAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const RECRUITER: RoleActionsRole = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Recruiter",
  isDefault: false,
  memberCount: 2,
  inviteCount: 1,
};
const MEMBER = { id: "c0000000-0000-4000-8000-000000000002", name: "Member" };

beforeEach(() => vi.clearAllMocks());

describe("DeleteRoleDialog (RPT-034, RP-REQ-008)", () => {
  it("deletes an unused role without asking for a replacement", async () => {
    vi.mocked(deleteRoleAction).mockResolvedValue({ ok: true, moved: 0 });
    const onDeleted = vi.fn();
    render(
      <DeleteRoleDialog
        role={{ ...RECRUITER, memberCount: 0, inviteCount: 0 }}
        replacements={[MEMBER]}
        onClose={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    expect(screen.queryByLabelText("Replacement role")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete role" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteRoleAction).toHaveBeenCalledWith({ roleId: RECRUITER.id, replacementRoleId: null });
  });

  it("needs a replacement while members or invites hold the role", () => {
    render(<DeleteRoleDialog role={RECRUITER} replacements={[MEMBER]} onClose={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByText(/2 members and 1 open invite have this role/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete role" })).toBeDisabled();
  });
});
