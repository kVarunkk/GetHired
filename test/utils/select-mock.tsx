import { Children, isValidElement, type ReactNode } from "react";

// Radix Select doesn't run in jsdom. This stands in for "@/components/ui/select"
// with a native <select> that takes the trigger's id and aria-label, so
// getByLabelText and fireEvent.change keep working:
//   vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

type TriggerProps = { id?: string; "aria-label"?: string; children?: ReactNode };

export const SelectTrigger: (props: TriggerProps) => null = () => null;

export function Select({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const trigger = Children.toArray(children).find(
    (child) => isValidElement(child) && child.type === SelectTrigger,
  ) as { props: TriggerProps } | undefined;
  return (
    <select
      id={trigger?.props.id}
      aria-label={trigger?.props["aria-label"]}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  );
}

export const SelectValue = () => null;

export const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;

export const SelectItem = ({ value, children }: { value: string; children: ReactNode }) => (
  <option value={value}>{children}</option>
);
