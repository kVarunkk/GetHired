"use client";

import React, {
  useState,
  useCallback,
  useMemo,
  CSSProperties,
  ReactElement,
  useRef,
  useEffect,
} from "react";
import useSWR from "swr";
import { X, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn, fetcher } from "@/utils/utils";
import { VariableSizeList } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./ui/drawer";
import { useDebounce } from "@/hooks/useDebounce";

export interface GenericFormData {
  [key: string]: string | number | string[];
}

interface LocationSearchSelectProps {
  name: keyof GenericFormData;
  onChange: (name: keyof GenericFormData, keywords: string[]) => void;
  placeholder?: string;
  initialLocations?: string[];
  className?: string;
  showBadges?: boolean;
  isSingleSelect?: boolean;
}

export default function LocationSearchSelect({
  name,
  onChange,
  placeholder = "Search cities or countries...",
  initialLocations = [],
  className = "",
  showBadges = true,
  isSingleSelect = false,
}: LocationSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const debouncedQuery = useDebounce(searchTerm, 300);

  const { data: apiResponse, isValidating: loading } = useSWR(
    open ? `/api/locations?query=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    },
  );

  const availableItems = useMemo(() => {
    if (!apiResponse?.data) return [{ location: "Remote" }];
    return apiResponse.data;
  }, [apiResponse]);

  const addLocation = useCallback(
    (locationToAdd: string) => {
      const trimmed = locationToAdd.trim();
      if (
        !trimmed ||
        initialLocations.some((k) => k.toLowerCase() === trimmed.toLowerCase())
      ) {
        return;
      }
      if (isSingleSelect) {
        onChange(name, [trimmed]);
        setOpen(false); // Auto close dropdown on single select item target
      } else {
        onChange(name, [...initialLocations, trimmed]);
      }
    },
    [name, onChange, initialLocations, isSingleSelect],
  );

  const removeLocation = useCallback(
    (locationToRemove: string) => {
      onChange(
        name,
        initialLocations.filter((loc) => loc !== locationToRemove),
      );
    },
    [name, onChange, initialLocations],
  );

  const renderContent = () => (
    <ItemsList
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      availableItems={availableItems}
      initialLocations={initialLocations}
      addLocation={addLocation}
      removeLocation={removeLocation}
      loading={loading}
    />
  );

  return (
    <div className={cn("flex flex-col gap-2 ", className)}>
      {isDesktop ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between bg-input text-muted-foreground"
            >
              <span className="truncate">
                {initialLocations.length > 0
                  ? isSingleSelect
                    ? initialLocations[0]
                    : `${initialLocations.length} items selected`
                  : placeholder}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent className="p-0 " style={{ pointerEvents: "auto" }}>
            {renderContent()}
          </PopoverContent>
        </Popover>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between bg-input text-muted-foreground"
            >
              <span className="truncate">{placeholder}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle></DrawerTitle>
              <DrawerDescription>
                {initialLocations.length} items selected
              </DrawerDescription>
            </DrawerHeader>
            <div className="border-t">{renderContent()}</div>
          </DrawerContent>
        </Drawer>
      )}

      {initialLocations.length > 0 && showBadges && !isSingleSelect && (
        <div className="flex flex-wrap gap-2">
          {initialLocations.map((loc) => (
            <span
              key={loc}
              className="flex items-center border border-border px-2 py-1 rounded text-sm"
            >
              {loc}
              <button
                type="button"
                onClick={() => removeLocation(loc)}
                className="p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  index: number;
  style: CSSProperties;
  data: {
    availableItems: { location: string }[];
    initialLocations: string[];
    addLocation: (loc: string) => void;
    removeLocation: (loc: string) => void;
    onResize: (index: number, size: number) => void;
  };
}

const Row = React.memo(({ index, style, data }: RowProps): ReactElement => {
  const {
    availableItems,
    initialLocations,
    addLocation,
    removeLocation,
    onResize,
  } = data;
  const itemData = availableItems[index]?.location;
  const rowRef = useRef<HTMLDivElement>(null);

  const checked = initialLocations.includes(itemData);

  useEffect(() => {
    if (rowRef.current) {
      onResize(index, rowRef.current.scrollHeight);
    }
  }, [index, onResize, itemData]);

  if (!itemData) return <div style={style} />;

  return (
    <div style={style}>
      <div ref={rowRef} className="py-0.5 px-1">
        <CommandItem
          value={itemData}
          onSelect={() => {
            if (checked) {
              removeLocation(itemData);
            } else {
              addLocation(itemData);
            }
          }}
          className="cursor-pointer flex items-center"
        >
          <Check
            className={cn(
              "mr-2 h-4 w-4 shrink-0",
              checked ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="truncate">{itemData}</span>
        </CommandItem>
      </div>
    </div>
  );
});
Row.displayName = "Row";

function ItemsList({
  searchTerm,
  setSearchTerm,
  availableItems,
  initialLocations,
  addLocation,
  removeLocation,
  loading,
}: {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  availableItems: { location: string }[];
  initialLocations: string[];
  addLocation: (loc: string) => void;
  removeLocation: (loc: string) => void;
  loading: boolean;
}) {
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const listRef = useRef<VariableSizeList | null>(null);

  const handleResize = useCallback((index: number, size: number) => {
    setRowHeights((prev) => {
      if (prev[index] === size) return prev;
      return { ...prev, [index]: size };
    });
    if (listRef.current) {
      listRef.current.resetAfterIndex(index);
    }
  }, []);

  const getItemSize = useCallback(
    (index: number) => rowHeights[index] || 38,
    [rowHeights],
  );

  const RowWithDynamicHeight = useCallback(
    ({ index, style }: { index: number; style: CSSProperties }) => (
      <Row
        index={index}
        style={style}
        data={{
          availableItems,
          initialLocations,
          addLocation,
          removeLocation,
          onResize: handleResize,
        }}
      />
    ),
    [
      availableItems,
      initialLocations,
      addLocation,
      removeLocation,
      handleResize,
    ],
  );

  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder="Type a location..."
        value={searchTerm}
        onValueChange={setSearchTerm}
      />
      <CommandList>
        {!loading && availableItems.length === 0 && (
          <CommandEmpty className="text-muted-foreground text-center py-6 text-sm">
            No matching items found
          </CommandEmpty>
        )}

        {loading ? (
          <CommandGroup>
            <div className="h-60 w-full flex items-center justify-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          </CommandGroup>
        ) : (
          <CommandGroup>
            {availableItems.length > 0 && (
              <div className="h-60 w-full">
                <AutoSizer>
                  {({ height, width }) => (
                    <VariableSizeList
                      ref={listRef}
                      height={height}
                      itemCount={availableItems.length}
                      itemSize={getItemSize}
                      width={width}
                    >
                      {RowWithDynamicHeight}
                    </VariableSizeList>
                  )}
                </AutoSizer>
              </div>
            )}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
