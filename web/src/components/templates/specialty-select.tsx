"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shared/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/shared/command";
import { Button } from "@/components/shared/button";
import { Badge } from "@/components/shared/badge";
import { MEDICAL_SPECIALTIES } from "@/lib/constants/specialties";

interface SpecialtySelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function SpecialtySelect({
  value,
  onChange,
  disabled,
  className,
}: SpecialtySelectProps) {
  const t = useTranslations("templateEditor");
  const [open, setOpen] = React.useState(false);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const selectedLabels = value
    .map((id) => MEDICAL_SPECIALTIES.find((s) => s.id === id)?.label)
    .filter(Boolean) as string[];

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              value.length === 0 && "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {value.length === 0
                ? t("specialtiesPlaceholder")
                : `${value.length} selected`}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className="size-4 shrink-0 text-foreground/65"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command className="gap-2">
            <CommandInput placeholder={t("specialtiesPlaceholder")} />
            <CommandList className="max-h-64">
              <CommandEmpty>{t("specialtiesEmpty")}</CommandEmpty>
              {MEDICAL_SPECIALTIES.map((specialty) => (
                <CommandItem
                  key={specialty.id}
                  value={specialty.label}
                  onSelect={() => toggle(specialty.id)}
                >
                  <div
                    className={cn(
                      "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                      value.includes(specialty.id)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {value.includes(specialty.id) && (
                      <HugeiconsIcon icon={Tick02Icon} size={12} />
                    )}
                  </div>
                  {specialty.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedLabels.map((label) => (
            <Badge key={label} variant="secondary" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
