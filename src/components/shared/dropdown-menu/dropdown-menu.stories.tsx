"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare01Icon,
  Delete01Icon,
  Tick02Icon,
  Settings01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuShortcut,
} from "./index";

const meta = {
  title: "UI/DropdownMenu",
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuItem className="gap-2">
          <HugeiconsIcon icon={LinkSquare01Icon} size={16} />
          Open visit
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2">
          <HugeiconsIcon icon={Copy01Icon} size={16} />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2">
          <HugeiconsIcon icon={Tick02Icon} size={16} />
          Mark complete
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="gap-2">
          <HugeiconsIcon icon={Delete01Icon} size={16} />
          Delete visit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithLabelsAndShortcuts: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Options</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2">
            <HugeiconsIcon icon={Settings01Icon} size={16} />
            Settings
            <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2">
            <HugeiconsIcon icon={Copy01Icon} size={16} />
            Copy
            <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="gap-2">
          <HugeiconsIcon icon={Delete01Icon} size={16} />
          Delete
          <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
