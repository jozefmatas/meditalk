import * as React from "react";

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-separator"
      className="flex items-center px-1"
      role="separator"
      {...props}
    >
      <div className="h-px w-3 bg-border" />
    </div>
  );
}

export { InputOTPSeparator };
