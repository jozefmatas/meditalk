"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shared/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/shared/command";
import { Button } from "@/components/shared/button";

/* ── Combobox (Popover + Command) ── */

interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxGroup {
  label?: string;
  options: ComboboxOption[];
}

interface ComboboxProps {
  /** Currently selected value (single-select) */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Flat list of options */
  options?: ComboboxOption[];
  /** Grouped options (takes precedence over `options`) */
  groups?: ComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

function Combobox({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);

  const allOptions = React.useMemo(() => {
    if (groups) return groups.flatMap((g) => g.options);
    return options;
  }, [groups, options]);

  const selectedLabel = allOptions.find((o) => o.value === value)?.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selectedLabel ?? placeholder}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command className="gap-2">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups
              ? groups.map((group, i) => (
                  <React.Fragment key={group.label ?? i}>
                    {i > 0 && <CommandSeparator />}
                    <CommandGroup heading={group.label}>
                      {group.options.map((opt) => (
                        <CommandItem
                          key={opt.value}
                          value={opt.label}
                          disabled={opt.disabled}
                          onSelect={() => {
                            onValueChange?.(opt.value);
                            setOpen(false);
                          }}
                          data-checked={value === opt.value}
                        >
                          {opt.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </React.Fragment>
                ))
              : options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    disabled={opt.disabled}
                    onSelect={() => {
                      onValueChange?.(opt.value);
                      setOpen(false);
                    }}
                    data-checked={value === opt.value}
                  >
                    {opt.label}
                  </CommandItem>
                ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
export type { ComboboxProps, ComboboxOption, ComboboxGroup };
