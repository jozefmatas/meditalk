"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
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
import { Badge } from "@/components/shared/badge";

/* ── Types ── */

interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxGroup {
  label?: string;
  options: ComboboxOption[];
}

interface ComboboxBaseProps {
  /** Flat list of options */
  options?: ComboboxOption[];
  /** Grouped options (takes precedence over `options`) */
  groups?: ComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "ghost";
  size?: "default" | "sm" | "lg";
  /** Prefix label rendered before the value, e.g. "Template" → "Template: Value" */
  label?: string;
}

interface ComboboxSingleProps extends ComboboxBaseProps {
  multiple?: false;
  /** Currently selected value (single-select) */
  value?: string;
  onValueChange?: (value: string) => void;
  maxDisplayedValues?: never;
}

interface ComboboxMultipleProps extends ComboboxBaseProps {
  multiple: true;
  /** Currently selected values (multi-select) */
  value?: string[];
  onValueChange?: (value: string[]) => void;
  /** Max badges visible in trigger before "+N more" (default: 3) */
  maxDisplayedValues?: number;
}

type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps;

/* ── Trigger variants ── */

const triggerVariants: Record<string, string> = {
  default: "border-input bg-background",
  ghost: "border-transparent bg-transparent shadow-none",
};

/* ── Component ── */

function Combobox(props: ComboboxProps) {
  const {
    options = [],
    groups,
    placeholder = "Select...",
    searchPlaceholder = "Search...",
    emptyText = "No results found.",
    disabled,
    className,
    variant = "default",
    size = "default",
    label,
  } = props;

  const [open, setOpen] = React.useState(false);

  const allOptions = React.useMemo(() => {
    if (groups) return groups.flatMap((g) => g.options);
    return options;
  }, [groups, options]);

  const isMultiple = props.multiple === true;
  const selectedValues: string[] = isMultiple
    ? (props.value ?? [])
    : props.value
      ? [props.value]
      : [];

  function isChecked(val: string) {
    return selectedValues.includes(val);
  }

  function handleSelect(val: string) {
    if (isMultiple) {
      const next = isChecked(val)
        ? selectedValues.filter((v) => v !== val)
        : [...selectedValues, val];
      (props as ComboboxMultipleProps).onValueChange?.(next);
      // keep dropdown open for multi-select
    } else {
      (props as ComboboxSingleProps).onValueChange?.(val);
      setOpen(false);
    }
  }

  function handleRemove(val: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!isMultiple) return;
    const next = selectedValues.filter((v) => v !== val);
    (props as ComboboxMultipleProps).onValueChange?.(next);
  }

  /* ── Render trigger content ── */

  function renderTriggerContent() {
    if (isMultiple) {
      const maxDisplay =
        (props as ComboboxMultipleProps).maxDisplayedValues ?? 3;
      if (selectedValues.length === 0) {
        return (
          <span className="text-foreground/65 truncate">{placeholder}</span>
        );
      }
      const visible = selectedValues.slice(0, maxDisplay);
      const remaining = selectedValues.length - maxDisplay;
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {visible.map((val) => {
            const opt = allOptions.find((o) => o.value === val);
            return (
              <Badge
                key={val}
                variant="status-started"
                className="gap-0.5 pr-0.5"
              >
                {opt?.label ?? val}
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={16}
                  role="button"
                  aria-label={`Remove ${opt?.label ?? val}`}
                  onClick={(e) => handleRemove(val, e)}
                  className="cursor-pointer"
                />
              </Badge>
            );
          })}
          {remaining > 0 && (
            <Badge variant="outline" className="pointer-events-none">
              +{remaining}
            </Badge>
          )}
        </span>
      );
    }

    // Single-select
    const selectedLabel = allOptions.find(
      (o) => o.value === props.value,
    )?.label;
    if (label) {
      return (
        <span className="flex min-w-0 items-center gap-0.5">
          <span className="text-foreground/65 shrink-0">{label}:</span>
          <span className="truncate">{selectedLabel ?? placeholder}</span>
        </span>
      );
    }
    return <span className="truncate">{selectedLabel ?? placeholder}</span>;
  }

  /* ── Render items ── */

  function renderItem(opt: ComboboxOption) {
    return (
      <CommandItem
        key={opt.value}
        value={opt.label}
        disabled={opt.disabled}
        onSelect={() => handleSelect(opt.value)}
        data-checked={isChecked(opt.value) || undefined}
      >
        {opt.label}
      </CommandItem>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal pl-2.5 pr-2",
            triggerVariants[variant],
            isMultiple && "h-auto min-h-9 py-1.5",
            !isMultiple && !props.value && "text-foreground/65",
            className,
          )}
        >
          {renderTriggerContent()}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 shrink-0 text-foreground/65"
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
                      {group.options.map(renderItem)}
                    </CommandGroup>
                  </React.Fragment>
                ))
              : options.map(renderItem)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
export type { ComboboxProps, ComboboxOption, ComboboxGroup };
