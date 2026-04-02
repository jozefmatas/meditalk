"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Settings01Icon,
  UserIcon,
  SmileIcon,
  CalculatorIcon,
} from "@hugeicons/core-free-icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./index";

const meta = {
  title: "UI/Command",
  component: Command,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <HugeiconsIcon icon={Calendar03Icon} />
            Calendar
          </CommandItem>
          <CommandItem>
            <HugeiconsIcon icon={SmileIcon} />
            Search Emoji
          </CommandItem>
          <CommandItem>
            <HugeiconsIcon icon={CalculatorIcon} />
            Calculator
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <HugeiconsIcon icon={UserIcon} />
            Profile
            <CommandShortcut>Ctrl+P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <HugeiconsIcon icon={Settings01Icon} />
            Settings
            <CommandShortcut>Ctrl+S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

export const WithCheckedItems: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Languages">
          <CommandItem data-checked={true}>Slovak</CommandItem>
          <CommandItem>Czech</CommandItem>
          <CommandItem>English</CommandItem>
          <CommandItem>German</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

export const WithDisabledItems: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem>Edit</CommandItem>
          <CommandItem>Duplicate</CommandItem>
          <CommandItem disabled>Archive (unavailable)</CommandItem>
          <CommandItem>Delete</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

export const Empty: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
      </CommandList>
    </Command>
  ),
};

export const MultipleGroups: Story = {
  render: () => (
    <Command className="rounded-lg border shadow-md">
      <CommandInput placeholder="Search templates..." />
      <CommandList>
        <CommandEmpty>No templates found.</CommandEmpty>
        <CommandGroup heading="General">
          <CommandItem>General Consultation</CommandItem>
          <CommandItem>Follow-up Visit</CommandItem>
          <CommandItem>Preventive Checkup</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Specialized">
          <CommandItem>Cardiology</CommandItem>
          <CommandItem>Dermatology</CommandItem>
          <CommandItem>Orthopedics</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Emergency">
          <CommandItem>Acute Care</CommandItem>
          <CommandItem>Trauma Assessment</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
