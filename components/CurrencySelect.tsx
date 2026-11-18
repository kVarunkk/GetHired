"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  CURRENCY_CODES,
  POPULAR_CURRENCIES,
  currencyName,
  currencySymbol,
  toIsoCurrency,
} from "@/helpers/currency/currencies";
import { cn } from "@/utils/utils";

type Option = { code: string; name: string; symbol: string };

/**
 * A searchable picker over every ISO 4217 currency, common ones first. The
 * value is a code; an old symbol ("₹") is read as its code. With `anyLabel`,
 * the empty value is an option too (filters).
 */
export default function CurrencySelect({
  value,
  onChange,
  id,
  name,
  anyLabel,
  placeholder = "Currency",
  disabled,
  className,
  "aria-label": ariaLabel = "Currency",
  "aria-invalid": ariaInvalid,
}: {
  value: string | null | undefined;
  onChange: (code: string) => void;
  id?: string;
  name?: string;
  /** Adds an option for no currency (value ""), with this label. */
  anyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const code = toIsoCurrency(value);

  const { popular, rest } = useMemo(() => {
    const toOption = (c: string): Option => ({ code: c, name: currencyName(c), symbol: currencySymbol(c) });
    const top: readonly string[] = POPULAR_CURRENCIES;
    return {
      popular: top.map(toOption),
      rest: CURRENCY_CODES.filter((c) => !top.includes(c)).map(toOption),
    };
  }, []);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const item = (o: Option) => (
    <CommandItem
      key={o.code}
      value={`${o.code} ${o.name} ${o.symbol}`}
      onSelect={() => pick(o.code)}
      className="cursor-pointer"
    >
      <Check className={cn("h-4 w-4", code === o.code ? "opacity-100" : "opacity-0")} />
      <span className="w-10 font-medium">{o.code}</span>
      <span className="truncate text-muted-foreground">{o.name}</span>
      {o.symbol !== o.code && <span className="ml-auto text-muted-foreground">{o.symbol}</span>}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          name={name}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !code && "text-muted-foreground")}>
            {code ? `${code} · ${currencyName(code)}` : (anyLabel ?? placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currencies..." />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            {anyLabel && (
              <CommandGroup>
                <CommandItem value={anyLabel} onSelect={() => pick("")} className="cursor-pointer">
                  <Check className={cn("h-4 w-4", !code ? "opacity-100" : "opacity-0")} />
                  {anyLabel}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Common">{popular.map(item)}</CommandGroup>
            <CommandGroup heading="All currencies">{rest.map(item)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
