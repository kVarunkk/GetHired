"use client";

import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { ChevronsUpDown } from "lucide-react";
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
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./ui/drawer";
import { CSSProperties, ReactElement, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { cn } from "@/utils/utils";

type Props = {
  items: string[];
  selectedItem: string;
  handleItemChange: (val: string) => void;
  isLoading: boolean;
  placeholder: string;
};

export default function VirtualizedSelect({
  items,
  selectedItem,
  handleItemChange,
  isLoading,
  placeholder,
}: Props) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const filteredAvailableItems = useMemo(() => {
    return items.filter((item) =>
      item.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [items, searchTerm]);

  const Row = ({
    index,
    style,
  }: {
    index: number;
    style: CSSProperties;
  }): ReactElement => {
    const itemData = filteredAvailableItems[index];
    return (
      <div style={style}>
        <CommandItem
          value={itemData}
          onSelect={() => {
            handleItemChange(itemData);
            setOpen(false);
          }}
          className="cursor-pointer"
        >
          {itemData}
        </CommandItem>
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2 ")}>
      {isDesktop ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between bg-input",
                !selectedItem && "text-muted-foreground",
              )}
              disabled={isLoading}
            >
              <span className="truncate">{selectedItem || placeholder}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 " style={{ pointerEvents: "auto" }}>
            <ItemsList
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              filteredAvailableItems={filteredAvailableItems}
              Row={Row}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between bg-input",
                !selectedItem && "text-muted-foreground",
              )}
              disabled={isLoading}
            >
              <span className="truncate">{selectedItem || placeholder}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle></DrawerTitle>
            </DrawerHeader>
            <div className=" border-t">
              <ItemsList
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                filteredAvailableItems={filteredAvailableItems}
                Row={Row}
              />
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

function ItemsList({
  searchTerm,
  setSearchTerm,
  filteredAvailableItems,
  Row,
}: {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  filteredAvailableItems: string[];
  Row: ({
    index,
    style,
  }: {
    index: number;
    style: CSSProperties;
  }) => ReactElement;
}) {
  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search..."
        value={searchTerm}
        onValueChange={(value) => {
          setSearchTerm(value);
        }}
      />
      <CommandList>
        <CommandEmpty>No items available</CommandEmpty>
        <CommandGroup>
          <div className="h-60 w-full">
            <AutoSizer>
              {({ height, width }) => (
                <List
                  height={height}
                  itemCount={filteredAvailableItems.length}
                  itemSize={40}
                  width={width}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          </div>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
