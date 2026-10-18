import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { changeRoleAction } from "@/app/actions/team/change-role";
import { makePrimaryOwnerAction } from "@/app/actions/team/make-primary-owner";
import { removeMemberAction } from "@/app/actions/team/remove-member";
import { inviteMemberAction } from "@/app/actions/team/invite-member";
import { revokeInviteAction } from "@/app/actions/team/revoke-invite";
import { setOwnerAction } from "@/app/actions/team/set-owner";
import type { TeamInvite, TeamMember } from "@/helpers/team/list-team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, OWNER_A, ROLES_A, memberOf, type MemberFixture } from "@/test/utils/team";
import InviteDialog from "./InviteDialog";
import { inviteHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import type { InviteRoleOption } from "@/helpers/team/invite-roles";
import TeamTable, { type TeamRoleOption, type TeamViewer } from "./TeamTable";

vi.mock("@/app/actions/team/change-role", () => ({ changeRoleAction: vi.fn() }));
vi.mock("@/app/actions/team/remove-member", () => ({ removeMemberAction: vi.fn() }));
vi.mock("@/app/actions/team/resend-invite", () => ({ resendInviteAction: vi.fn() }));
vi.mock("@/app/actions/team/revoke-invite", () => ({ revokeInviteAction: vi.fn() }));
vi.mock("@/app/actions/team/set-owner", () => ({ setOwnerAction: vi.fn() }));
vi.mock("@/app/actions/team/make-primary-owner", () => ({ makePrimaryOwnerAction: vi.fn() }));
vi.mock("@/app/actions/team/invite-member", () => ({ inviteMemberAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const CO_OWNER = memberOf(COMPANY_A, "custom", { isOwner: true, displayName: "Cora Coowner" });

const asMember = (m: MemberFixture): TeamMember => ({
  userId: m.user.id,
  email: m.user.email ?? null,
  name: m.row.display_name,
  isOwner: m.myCompany.isOwner,
  isPrimaryOwner: m.myCompany.isPrimaryOwner,
  role: m.myCompany.role,
  assignedJobIds: [],
  joinedAt: "2026-01-01T00:00:00.000Z",
  lastActiveAt: null,
});
const MEMBERS = [OWNER_A, CO_OWNER, ADMIN_A, MEMBER_A].map(asMember);
const INVITES: TeamInvite[] = [
  {
    id: "f1000000-0000-4000-8000-000000000001",
    email: "priya@gmail.com",
    role: { id: ROLES_A.member.id, name: "Member", color: "slate" },
    invitedBy: "Olive Owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
];

const role = (r: typeof ROLES_A.admin, withinCeiling: boolean): TeamRoleOption => ({
  id: r.id,
  name: r.name,
  color: r.color,
  withinCeiling,
});
/** As an owner sees them: everything is within the ceiling. */
const ALL_ROLES = [role(ROLES_A.admin, true), role(ROLES_A.member, true), role(ROLES_A.hiringManager, true)];

const viewer = (m: MemberFixture, over: Partial<TeamViewer> = {}): TeamViewer => ({
  userId: m.user.id,
  isOwner: m.myCompany.isOwner,
  isPrimaryOwner: m.myCompany.isPrimaryOwner,
  canAssignRoles: false,
  canRemove: false,
  canInvite: false,
  ...over,
});

function renderAs(me: TeamViewer, roles = ALL_ROLES) {
  render(<TeamTable members={MEMBERS} invites={INVITES} roles={roles} me={me} companyName="Acme" />);
}

const row = (name: string) => {
  const table = screen.getByRole("table", { name: name.includes("@") ? "Pending invites" : "Members" });
  return within(table).getByText(name, { exact: false }).closest("tr") as HTMLElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select needs these, which jsdom lacks.
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.releasePointerCapture ??= vi.fn();
});

/** Opens a Radix select from the keyboard (jsdom has no pointer capture). */
const openSelect = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });

describe("TeamTable (RP-REQ-013, RPT-035/042)", () => {
  it("shows each member's role badge, Owner with a Primary tag for the primary owner", () => {
    renderAs(viewer(MEMBER_A));

    expect(within(row("Olive Owner")).getByText("Owner")).toBeInTheDocument();
    expect(within(row("Olive Owner")).getByText("Primary")).toBeInTheDocument();
    expect(within(row("Cora Coowner")).getByText("Owner")).toBeInTheDocument();
    expect(within(row("Cora Coowner")).queryByText("Primary")).not.toBeInTheDocument();
    expect(within(row("Ada Admin")).getByText("Admin")).toBeInTheDocument();
    expect(within(row("Max Member")).getByText("Member")).toBeInTheDocument();
  });

  it("gives a role without team permissions no actions on others, only Leave team for themselves", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ ok: true, left: true });
    renderAs(viewer(MEMBER_A));

    expect(within(row("Ada Admin")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row("priya@gmail.com")).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(within(row("Max Member")).getByRole("button", { name: "Leave team" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Leave Acme?");
    expect(removeMemberAction).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Leave team" }));
    await waitFor(() => expect(removeMemberAction).toHaveBeenCalledWith({ userId: MEMBER_A.user.id }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/company"));
  });

  it("doesn't leave when the confirmation is cancelled", async () => {
    renderAs(viewer(MEMBER_A));

    fireEvent.click(within(row("Max Member")).getByRole("button", { name: "Leave team" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(removeMemberAction).not.toHaveBeenCalled();
  });

  it("asks before removing a member", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ ok: true, left: false });
    renderAs(viewer(ADMIN_A, { canRemove: true }));

    fireEvent.click(within(row("Max Member")).getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Remove Max Member?");
    expect(removeMemberAction).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeMemberAction).toHaveBeenCalledWith({ userId: MEMBER_A.user.id }));
  });

  it("gives team.assign_roles a picker, but never on owners, and disabled on their own row (rule 5)", () => {
    renderAs(viewer(ADMIN_A, { canAssignRoles: true, canRemove: true, canInvite: true }));

    expect(within(row("Olive Owner")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row("Cora Coowner")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row("Max Member")).getByRole("combobox", { name: /Role for/ })).toBeEnabled();
    expect(within(row("Ada Admin")).getByRole("combobox", { name: /Role for/ })).toBeDisabled();
    expect(within(row("Max Member")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    // Owners are acted on by owners only (rule 4).
    expect(within(row("Cora Coowner")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("disables the picker on a member whose role is above the viewer's (rule 4)", () => {
    renderAs(viewer(ADMIN_A, { canAssignRoles: true, canRemove: true }), [
      role(ROLES_A.admin, true),
      role(ROLES_A.member, false),
      role(ROLES_A.hiringManager, true),
    ]);

    expect(within(row("Max Member")).getByRole("combobox", { name: /Role for/ })).toBeDisabled();
    expect(within(row("Max Member")).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("offers only roles within the viewer's ceiling (rule 3) and changes the role", async () => {
    vi.mocked(changeRoleAction).mockResolvedValue({ ok: true });
    renderAs(viewer(OWNER_A, { canAssignRoles: true }), [
      role(ROLES_A.admin, false),
      role(ROLES_A.member, true),
      role(ROLES_A.hiringManager, true),
    ]);

    openSelect(within(row("Max Member")).getByRole("combobox", { name: /Role for/ }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
    fireEvent.click(within(listbox).getByRole("option", { name: "Hiring manager" }));

    await waitFor(() =>
      expect(changeRoleAction).toHaveBeenCalledWith({ userId: MEMBER_A.user.id, roleId: ROLES_A.hiringManager.id }),
    );
  });

  it("gives resend and revoke on invites with team.invite", async () => {
    vi.mocked(revokeInviteAction).mockResolvedValue({ ok: true });
    renderAs(viewer(ADMIN_A, { canInvite: true }));

    const invite = row("priya@gmail.com");
    expect(within(invite).getByText("Member")).toBeInTheDocument();
    expect(within(invite).getByRole("button", { name: "Resend" })).toBeInTheDocument();
    fireEvent.click(within(invite).getByRole("button", { name: "Revoke" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("priya@gmail.com");
    expect(revokeInviteAction).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke invite" }));
    await waitFor(() => expect(revokeInviteAction).toHaveBeenCalledWith({ inviteId: INVITES[0].id }));
  });

  describe("owner actions (RP-REQ-006)", () => {
    it("are only for owners", () => {
      renderAs(viewer(ADMIN_A, { canAssignRoles: true, canRemove: true, canInvite: true }));

      expect(screen.queryByRole("button", { name: /Owner actions/ })).not.toBeInTheDocument();
    });

    it("make a member an owner", async () => {
      vi.mocked(setOwnerAction).mockResolvedValue({ ok: true });
      renderAs(viewer(OWNER_A, { canAssignRoles: true, canRemove: true, canInvite: true }));

      fireEvent.pointerDown(within(row("Max Member")).getByRole("button", { name: /Owner actions/ }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Make owner" }));

      await waitFor(() => expect(setOwnerAction).toHaveBeenCalledWith({ userId: MEMBER_A.user.id, isOwner: true }));
    });

    it("remove a co-owner's owner role with a role picked in the same step", async () => {
      vi.mocked(setOwnerAction).mockResolvedValue({ ok: true });
      renderAs(viewer(OWNER_A, { canAssignRoles: true }));

      fireEvent.pointerDown(within(row("Cora Coowner")).getByRole("button", { name: /Owner actions/ }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove owner role" }));
      const confirm = screen.getByRole("button", { name: "Remove owner role" });
      expect(confirm).toBeDisabled();

      openSelect(screen.getByRole("combobox", { name: "New role" }));
      fireEvent.click(await screen.findByRole("option", { name: "Admin" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove owner role" }));

      await waitFor(() =>
        expect(setOwnerAction).toHaveBeenCalledWith({
          userId: CO_OWNER.user.id,
          isOwner: false,
          roleId: ROLES_A.admin.id,
        }),
      );
    });

    it("make a co-owner primary after naming the billing change and typing the company name", async () => {
      vi.mocked(makePrimaryOwnerAction).mockResolvedValue({ ok: true });
      renderAs(viewer(OWNER_A));

      fireEvent.pointerDown(within(row("Cora Coowner")).getByRole("button", { name: /Owner actions/ }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Make primary owner" }));
      expect(screen.getByText(/becomes the billing contact/)).toBeInTheDocument();
      const confirm = screen.getByRole("button", { name: "Make primary owner" });
      expect(confirm).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Type Acme to confirm"), { target: { value: "acme" } });
      fireEvent.click(confirm);

      await waitFor(() =>
        expect(makePrimaryOwnerAction).toHaveBeenCalledWith({ userId: CO_OWNER.user.id, confirmName: "acme" }),
      );
    });

    it("never offer actions on the primary owner, who can't leave until they hand over", () => {
      renderAs(viewer(OWNER_A, { canAssignRoles: true, canRemove: true }));

      const primary = row("Olive Owner");
      expect(within(primary).queryByRole("button", { name: /Owner actions/ })).not.toBeInTheDocument();
      expect(within(primary).queryByRole("button", { name: "Leave team" })).not.toBeInTheDocument();
      expect(within(primary).getByText("Make another owner primary to leave.")).toBeInTheDocument();
    });
  });
});

describe("InviteDialog (RP-REQ-007, TM-REQ-010)", () => {
  const ROLES: InviteRoleOption[] = [
    { kind: "role", id: ROLES_A.admin.id, name: "Admin", description: null, isDefault: false },
    { kind: "role", id: ROLES_A.member.id, name: "Member", description: "Applicants and outreach", isDefault: true },
  ];
  const RECRUITER_TEMPLATE: InviteRoleOption = {
    kind: "template",
    key: "recruiter",
    name: "Recruiter",
    description: "Runs hiring end to end.",
  };

  function open(ownerEmail: string | null, seats = { used: 2, limit: 5 }, roles = ROLES) {
    render(<InviteDialog ownerEmail={ownerEmail} seats={seats} roles={roles} />);
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
  }

  it("shows seat usage", () => {
    render(<InviteDialog ownerEmail="founder@acme.com" seats={{ used: 2, limit: 5 }} roles={ROLES} />);
    expect(screen.getByText("2 of 5 seats used")).toBeInTheDocument();
  });

  it("disables Invite at the limit and links to an upgrade", () => {
    render(<InviteDialog ownerEmail="founder@acme.com" seats={{ used: 5, limit: 5 }} roles={ROLES} />);

    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Upgrade for more seats" })).toHaveAttribute("href", "/company/billing");
  });

  it("shows the domain notice for a different, non-free-mail owner domain", () => {
    open("founder@acme.com");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "friend@gmail.com" } });

    expect(screen.getByText("Not an @acme.com address. Make sure you trust this person.")).toBeInTheDocument();
  });

  it("shows no notice when the owner is on free mail (TM-TEST-006)", () => {
    open("founder@gmail.com");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "recruiter@agency.io" } });

    expect(screen.queryByText(/Make sure you trust this person/)).not.toBeInTheDocument();
  });

  it("validates the email before sending", async () => {
    open("founder@acme.com");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(inviteMemberAction).not.toHaveBeenCalled();
  });

  it("preselects the default role, lists the company's roles and sends the role id", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({
      ok: true,
      invite: { id: "i1", email: "eng@acme.com", role: { id: ROLES_A.member.id, name: "Member" } },
    });
    open("founder@acme.com");

    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent("Member");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "eng@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(inviteMemberAction).toHaveBeenCalledWith({ email: "eng@acme.com", roleId: ROLES_A.member.id }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows only the role's name in the picker, not its description", () => {
    open("founder@acme.com");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(/^Member$/);
  });

  it("links to the role editor only for someone who can manage roles", () => {
    open("founder@acme.com");
    expect(screen.queryByRole("link", { name: "Create a custom role" })).not.toBeInTheDocument();
    cleanup();

    render(<InviteDialog ownerEmail="founder@acme.com" seats={{ used: 2, limit: 5 }} roles={ROLES} canCreateRole />);
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByRole("link", { name: "Create a custom role" })).toHaveAttribute(
      "href",
      "/company/settings/roles/new?next=invite",
    );
  });

  it("opens with the role just created picked, and clears it from the URL on close", () => {
    render(
      <InviteDialog
        ownerEmail="founder@acme.com"
        seats={{ used: 2, limit: 5 }}
        roles={ROLES}
        initialRoleId={ROLES_A.admin.id}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(/^Admin$/);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(router.replace).toHaveBeenCalledWith("/company/settings/team", { scroll: false });
  });

  it("sends a template key for a template role and says the role will be added", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({
      ok: true,
      invite: { id: "i1", email: "eng@acme.com", role: { id: "r-new", name: "Recruiter" } },
    });
    const roles = [{ ...RECRUITER_TEMPLATE }, ...ROLES.map((r) => ({ ...r, isDefault: false }))];
    open("founder@acme.com", undefined, roles);

    expect(screen.getByText(/adds the Recruiter role to your company/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "eng@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(inviteMemberAction).toHaveBeenCalledWith({ email: "eng@acme.com", templateKey: "recruiter" }),
    );
  });

  it("offers the agent only with agent.use, and hands the invite over to it", () => {
    open("founder@acme.com");
    expect(screen.queryByRole("form", { name: "Or tell the agent who to invite" })).not.toBeInTheDocument();
    cleanup();

    render(<InviteDialog ownerEmail="founder@acme.com" seats={{ used: 2, limit: 5 }} roles={ROLES} canUseAgent />);
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const handoff = screen.getByRole("form", { name: "Or tell the agent who to invite" });
    // Not nested in the invite form, so its submit doesn't send an invite.
    expect(handoff.parentElement?.closest("form")).toBeNull();

    fireEvent.change(within(handoff).getByLabelText("Describe it for the assistant"), {
      target: { value: "priya@acme.com as a recruiter" },
    });
    fireEvent.click(within(handoff).getByRole("button", { name: "Open in the assistant" }));

    expect(router.push).toHaveBeenCalledWith(
      agentPromptHref(inviteHandoffPrompt("priya@acme.com as a recruiter"), COMPANY_AGENT_PATH),
    );
    expect(inviteMemberAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
  });
});
