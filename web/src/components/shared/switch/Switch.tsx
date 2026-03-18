"use client";

import * as React from "react";
import { Switch as SwitchBase } from "@/components/generated/ui/switch";
import { cn } from "@/lib/utils";

type SwitchProps = React.ComponentProps<typeof SwitchBase>;

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchBase
      className={cn(
        "data-checked:bg-secondary data-unchecked:border-border p-0.5 data-[size=default]:h-5 data-[size=default]:w-9 **:data-[slot=switch-thumb]:data-checked:translate-x-full!",
        className,
      )}
      {...props}
    />
  );
}

interface LabeledSwitchProps extends SwitchProps {
  label?: string;
}

function LabeledSwitch({ label, className, id, ...props }: LabeledSwitchProps) {
  const generatedId = React.useId();
  const switchId = id || generatedId;

  if (!label) {
    return <Switch id={switchId} className={className} {...props} />;
  }

  return (
    <div className="flex items-center gap-2">
      <Switch id={switchId} className={className} {...props} />
      <label
        htmlFor={switchId}
        className="cursor-pointer text-sm font-normal text-foreground/65 peer-data-checked:text-foreground"
      >
        {label}
      </label>
    </div>
  );
}

export { Switch, LabeledSwitch };
