"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Combobox } from "./index";

const meta = {
  title: "UI/Combobox",
  component: Combobox,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

const LANGUAGES = [
  { value: "sk", label: "Slovak" },
  { value: "cs", label: "Czech" },
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
];

const ENCOUNTER_TYPES = [
  { value: "consultation", label: "Consultation" },
  { value: "follow_up", label: "Follow-up" },
  { value: "preventive", label: "Preventive" },
  { value: "acute", label: "Acute" },
  { value: "telemedicine", label: "Telemedicine" },
  { value: "home_visit", label: "Home Visit" },
];

export const Default: Story = {
  args: {
    options: LANGUAGES,
    placeholder: "Select language...",
    searchPlaceholder: "Search language...",
    className: "w-56",
  },
};

export const WithDefaultValue: Story = {
  args: {
    value: "en",
    options: LANGUAGES,
    placeholder: "Select language...",
    searchPlaceholder: "Search language...",
    className: "w-56",
  },
};

export const WithGroups: Story = {
  args: {
    groups: [
      {
        label: "In-person",
        options: [
          { value: "consultation", label: "Consultation" },
          { value: "follow_up", label: "Follow-up" },
          { value: "preventive", label: "Preventive" },
          { value: "acute", label: "Acute" },
        ],
      },
      {
        label: "Remote",
        options: [
          { value: "telemedicine", label: "Telemedicine" },
          { value: "home_visit", label: "Home Visit" },
        ],
      },
    ],
    placeholder: "Encounter type...",
    searchPlaceholder: "Search type...",
    className: "w-56",
  },
};

export const Disabled: Story = {
  args: {
    options: LANGUAGES,
    placeholder: "Disabled...",
    disabled: true,
    className: "w-56",
  },
};

function ControlledDemo() {
  const [value, setValue] = useState("cs");

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        value={value}
        onValueChange={setValue}
        options={LANGUAGES}
        placeholder="Select language..."
        searchPlaceholder="Search language..."
        className="w-56"
      />
      <p className="text-xs text-muted-foreground">
        Selected: <strong>{value || "none"}</strong>
      </p>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

export const WithDisabledItems: Story = {
  args: {
    options: ENCOUNTER_TYPES.map((t) => ({
      ...t,
      disabled: t.value === "home_visit",
    })),
    placeholder: "Search type...",
    searchPlaceholder: "Search type...",
    className: "w-56",
  },
};
