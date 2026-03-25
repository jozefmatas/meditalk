"use client";

import { useState } from "react";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LOCALES } from "@/lib/template-types";

const LOCALE_LABELS: Record<string, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
};

interface LocaleComboboxProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function LocaleCombobox({ value, onChange }: LocaleComboboxProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    if (value.includes(id)) {
      // Prevent removing the last locale
      if (value.length <= 1) return;
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  function remove(id: string) {
    // Prevent removing the last locale
    if (value.length <= 1) return;
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" className="w-full justify-between" />
          }
        >
          {value.length === 0
            ? "Select locales..."
            : `${value.length} selected`}
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandList>
              <CommandEmpty>No locales found.</CommandEmpty>
              <CommandGroup>
                {LOCALES.map((l) => {
                  const isSelected = value.includes(l);
                  return (
                    <CommandItem
                      key={l}
                      value={LOCALE_LABELS[l] ?? l}
                      onSelect={() => toggle(l)}
                      data-checked={isSelected || undefined}
                    >
                      {LOCALE_LABELS[l] ?? l}{" "}
                      <span className="ml-auto text-xs text-muted-foreground uppercase">
                        {l}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((l) => (
            <Badge key={l} variant="secondary" className="gap-1 pr-1">
              {LOCALE_LABELS[l] ?? l}
              <button
                type="button"
                onClick={() => remove(l)}
                disabled={value.length <= 1}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
