"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { toast } from "sonner";
import { Toaster } from "./index";
import { Button } from "@/components/shared/button";

const meta: Meta<typeof Toaster> = {
  title: "ui/Sonner",
  component: Toaster,
  decorators: [
    (Story) => (
      <div className="flex flex-col items-start gap-4 p-8">
        <Story />
        <Toaster />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Toaster>;

export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast("Default toast")}>Default</Button>
      <Button onClick={() => toast.success("Success toast")}>Success</Button>
      <Button onClick={() => toast.error("Error toast")}>Error</Button>
      <Button onClick={() => toast.info("Info toast")}>Info</Button>
      <Button onClick={() => toast.warning("Warning toast")}>Warning</Button>
      <Button onClick={() => toast.loading("Loading toast")}>Loading</Button>
    </div>
  ),
};
