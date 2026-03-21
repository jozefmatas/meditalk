"use client";

import * as React from "react";
import { Switch as SwitchBase } from "@/components/generated/ui/switch";
import { cn } from "@/lib/utils";

type SwitchProps = React.ComponentProps<typeof SwitchBase>;

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchBase
      className={cn(
        "data-unchecked:border-input data-checked:border-secondary data-checked:bg-secondary! data-[size=default]:h-auto! data-[size=sm]:h-auto! **:data-[slot=switch-thumb]:data-checked:translate-x-[calc(100%-4px)]!",
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
    <div className="group/switch flex items-center gap-2">
      <Switch id={switchId} className={className} {...props} />
      <label
        htmlFor={switchId}
        className={cn(
          "text-sm font-normal text-foreground/65",
          props.disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer group-has-[button[data-state=checked]]/switch:text-foreground",
        )}
      >
        {label}
      </label>
    </div>
  );
}

export { Switch, LabeledSwitch };
