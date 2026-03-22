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
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MEDICAL_SPECIALTIES } from "@/lib/specialties";

interface SpecialtyComboboxProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function SpecialtyCombobox({ value, onChange }: SpecialtyComboboxProps) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  const selectedLabels = value
    .map((id) => MEDICAL_SPECIALTIES.find((s) => s.id === id))
    .filter(Boolean);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" className="w-full justify-between" />
          }
        >
          {value.length === 0
            ? "Select specialties..."
            : `${value.length} selected`}
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search specialties..." />
            <CommandList>
              <CommandEmpty>No specialties found.</CommandEmpty>
              <CommandGroup>
                {MEDICAL_SPECIALTIES.map((s) => {
                  const isSelected = value.includes(s.id);
                  return (
                    <CommandItem
                      key={s.id}
                      value={s.label}
                      onSelect={() => toggle(s.id)}
                      data-checked={isSelected || undefined}
                    >
                      {s.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedLabels.map(
            (s) =>
              s && (
                <Badge key={s.id} variant="secondary" className="gap-1 pr-1">
                  {s.label}
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ),
          )}
        </div>
      )}
    </div>
  );
}
