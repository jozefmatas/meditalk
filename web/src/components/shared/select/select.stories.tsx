import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./index";

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="consultation">Consultation</SelectItem>
        <SelectItem value="follow_up">Follow-up</SelectItem>
        <SelectItem value="preventive">Preventive</SelectItem>
        <SelectItem value="acute">Acute</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Encounter type" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>In-person</SelectLabel>
          <SelectItem value="consultation">Consultation</SelectItem>
          <SelectItem value="follow_up">Follow-up</SelectItem>
          <SelectItem value="preventive">Preventive</SelectItem>
          <SelectItem value="acute">Acute</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Remote</SelectLabel>
          <SelectItem value="telemedicine">Telemedicine</SelectItem>
          <SelectItem value="home_visit">Home Visit</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Small: Story = {
  render: () => (
    <Select>
      <SelectTrigger size="sm" className="w-40">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="started">Started</SelectItem>
        <SelectItem value="completed">Completed</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithDefaultValue: Story = {
  render: () => (
    <Select defaultValue="consultation">
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="consultation">Consultation</SelectItem>
        <SelectItem value="follow_up">Follow-up</SelectItem>
        <SelectItem value="preventive">Preventive</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <Select defaultValue="complex">
      <SelectTrigger label="Template">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="complex">Komplexné lekárske vyšetrenie</SelectItem>
        <SelectItem value="preventive">Preventívna prehliadka</SelectItem>
        <SelectItem value="follow_up">Kontrolné vyšetrenie</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithLabelGhost: Story = {
  render: () => (
    <Select defaultValue="complex">
      <SelectTrigger label="Template" variant="ghost">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="complex">Komplexné lekárske vyšetrenie</SelectItem>
        <SelectItem value="preventive">Preventívna prehliadka</SelectItem>
        <SelectItem value="follow_up">Kontrolné vyšetrenie</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Select disabled>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Disabled" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="one">Option 1</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const WithDisabledItems: Story = {
  render: () => (
    <Select>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select language" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sk">Slovak</SelectItem>
        <SelectItem value="cs">Czech</SelectItem>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="de" disabled>
          German (coming soon)
        </SelectItem>
      </SelectContent>
    </Select>
  ),
};
