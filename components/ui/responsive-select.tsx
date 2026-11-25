"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Check, ChevronDown } from "lucide-react";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  useInDrawer,
} from "./drawer";
import {
  Select as DesktopSelect,
  SelectContent as DesktopSelectContent,
  SelectItem as DesktopSelectItem,
  SelectTrigger as DesktopSelectTrigger,
  SelectValue as DesktopSelectValue,
} from "./select";

// The Select from `sm` up and a bottom Drawer of options below it, with the
// same parts and props as components/ui/select.tsx, so swapping the import is
// enough. On a phone the options are in thumb reach and swipe away, like the
// other pickers (MultiKeywordSelect, LocationSearchSelect). Inside another
// drawer the options drawer stacks on it.
//
// The breakpoint matches ResponsiveDialog's.
const DESKTOP_QUERY = "(min-width: 640px)";

type MobileSelect = {
  value: string | undefined;
  choose: (value: string) => void;
  disabled: boolean;
  title: string | undefined;
  labels: Map<string, React.ReactNode>;
  register: (value: string, label: React.ReactNode) => void;
};

const IsDesktopContext = React.createContext(true);
const MobileSelectContext = React.createContext<MobileSelect | null>(null);
// True while SelectContent's children render only to report their labels to
// SelectValue, which shows the chosen one before the drawer has ever opened.
const CollectingContext = React.createContext(false);

function useMobileSelect() {
  const context = React.useContext(MobileSelectContext);
  if (!context) throw new Error("ResponsiveSelect parts must be inside <Select>.");
  return context;
}

type SelectProps = React.ComponentProps<typeof DesktopSelect> & {
  /** The drawer's heading on a phone, e.g. the field's label. */
  title?: string;
};

function Select({ title, ...props }: SelectProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return (
    <IsDesktopContext.Provider value={isDesktop}>
      {isDesktop ? <DesktopSelect {...props} /> : <MobileSelectRoot title={title} {...props} />}
    </IsDesktopContext.Provider>
  );
}

function MobileSelectRoot({
  title,
  value: controlled,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  disabled = false,
  children,
}: SelectProps) {
  const inDrawer = useInDrawer();
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const [openState, setOpenState] = React.useState(defaultOpen ?? false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const value = controlled ?? uncontrolled;

  const labelsRef = React.useRef(new Map<string, React.ReactNode>());
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const register = React.useCallback((itemValue: string, label: React.ReactNode) => {
    const labels = labelsRef.current;
    const previous = labels.get(itemValue);
    labels.set(itemValue, label);
    // Only a new item, or new text, needs SelectValue to render again.
    if (previous === undefined || (typeof label === "string" && previous !== label)) bump();
  }, []);

  const context: MobileSelect = {
    value,
    disabled,
    title,
    labels: labelsRef.current,
    register,
    choose: (next) => {
      if (controlled === undefined) setUncontrolled(next);
      onValueChange?.(next);
      setOpen(false);
    },
  };

  const Root = inDrawer ? DrawerPrimitive.NestedRoot : Drawer;
  return (
    <MobileSelectContext.Provider value={context}>
      <Root open={open} onOpenChange={setOpen}>
        {children}
      </Root>
    </MobileSelectContext.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof DesktopSelectTrigger>,
  React.ComponentPropsWithoutRef<typeof DesktopSelectTrigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  if (React.useContext(IsDesktopContext)) {
    return (
      <DesktopSelectTrigger ref={ref} className={className} {...props}>
        {children}
      </DesktopSelectTrigger>
    );
  }
  return (
    <MobileSelectTrigger ref={ref} className={className} {...props}>
      {children}
    </MobileSelectTrigger>
  );
});

const MobileSelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DesktopSelectTrigger>
>(function MobileSelectTrigger({ className, children, disabled, ...props }, ref) {
  const select = useMobileSelect();
  return (
    <DrawerTrigger asChild>
      <button
        ref={ref}
        type="button"
        // DrawerTrigger adds aria-expanded and aria-controls.
        // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
        role="combobox"
        aria-haspopup="dialog"
        disabled={disabled || select.disabled}
        data-placeholder={select.value ? undefined : ""}
        // The same look as SelectTrigger.
        className={cn(
          "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground transition-colors hover:border-foreground/20 focus:outline-none focus:border-foreground/30 focus:ring-2 focus:ring-foreground/5 aria-[invalid=true]:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </button>
    </DrawerTrigger>
  );
});

function SelectValue(props: React.ComponentProps<typeof DesktopSelectValue>) {
  if (React.useContext(IsDesktopContext)) return <DesktopSelectValue {...props} />;
  return <MobileSelectValue placeholder={props.placeholder} />;
}

function MobileSelectValue({ placeholder }: { placeholder?: React.ReactNode }) {
  const select = useMobileSelect();
  const label = select.value !== undefined ? select.labels.get(select.value) : undefined;
  return <span className="truncate text-left">{label ?? placeholder}</span>;
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof DesktopSelectContent>,
  React.ComponentPropsWithoutRef<typeof DesktopSelectContent>
>(function SelectContent({ children, ...props }, ref) {
  if (React.useContext(IsDesktopContext)) {
    return (
      <DesktopSelectContent ref={ref} {...props}>
        {children}
      </DesktopSelectContent>
    );
  }
  return <MobileSelectContent>{children}</MobileSelectContent>;
});

function MobileSelectContent({ children }: { children?: React.ReactNode }) {
  const select = useMobileSelect();
  return (
    <>
      <CollectingContext.Provider value={true}>{children}</CollectingContext.Provider>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className={cn(!select.title && "sr-only")}>
            {select.title ?? "Choose an option"}
          </DrawerTitle>
        </DrawerHeader>
        <div
          role="listbox"
          aria-label={select.title}
          className="flex min-h-0 flex-col overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {children}
        </div>
      </DrawerContent>
    </>
  );
}

const SelectItem = React.forwardRef<
  React.ElementRef<typeof DesktopSelectItem>,
  React.ComponentPropsWithoutRef<typeof DesktopSelectItem>
>(function SelectItem({ children, ...props }, ref) {
  if (React.useContext(IsDesktopContext)) {
    return (
      <DesktopSelectItem ref={ref} {...props}>
        {children}
      </DesktopSelectItem>
    );
  }
  return (
    <MobileSelectItem value={props.value} disabled={props.disabled}>
      {children}
    </MobileSelectItem>
  );
});

function MobileSelectItem({
  value,
  disabled,
  children,
}: {
  value: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const select = useMobileSelect();
  const collecting = React.useContext(CollectingContext);
  const { register } = select;

  React.useLayoutEffect(() => {
    if (collecting) register(value, children);
  });

  if (collecting) return null;
  const selected = select.value === value;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={() => select.choose(value)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-3 py-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50",
        selected && "font-medium",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <Check className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden />
    </button>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
