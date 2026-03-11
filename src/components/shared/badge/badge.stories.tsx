import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "./index";

const meta = {
  title: "UI/Badge",
  component: Badge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "ghost",
        "link",
        "status-started",
        "status-recording",
        "status-processing",
        "status-to_review",
        "status-completed",
        "status-archived",
      ],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Badge", variant: "default" },
};

export const Secondary: Story = {
  args: { children: "Secondary", variant: "secondary" },
};

export const Destructive: Story = {
  args: { children: "Destructive", variant: "destructive" },
};

export const Outline: Story = {
  args: { children: "Outline", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "Ghost", variant: "ghost" },
};

export const Link: Story = {
  render: () => (
    <Badge variant="link">
      Open Link
      <HugeiconsIcon icon={ArrowUpRight01Icon} />
    </Badge>
  ),
};

export const AllBaseVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Open Link <HugeiconsIcon icon={ArrowUpRight01Icon} /></Badge>
    </div>
  ),
};

export const StatusStarted: Story = {
  args: { children: "Started", variant: "status-started" },
};

export const StatusRecording: Story = {
  args: { children: "Recording", variant: "status-recording" },
};

export const StatusProcessing: Story = {
  args: { children: "Processing", variant: "status-processing" },
};

export const StatusToReview: Story = {
  args: { children: "To Review", variant: "status-to_review" },
};

export const StatusCompleted: Story = {
  args: { children: "Completed", variant: "status-completed" },
};

export const StatusArchived: Story = {
  args: { children: "Archived", variant: "status-archived" },
};

export const AllStatusVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="status-started">Started</Badge>
      <Badge variant="status-recording">Recording</Badge>
      <Badge variant="status-processing">Processing</Badge>
      <Badge variant="status-to_review">To Review</Badge>
      <Badge variant="status-completed">Completed</Badge>
      <Badge variant="status-archived">Archived</Badge>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Base</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
          <Badge variant="link">Open Link <HugeiconsIcon icon={ArrowUpRight01Icon} /></Badge>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Status</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="status-started">Started</Badge>
          <Badge variant="status-recording">Recording</Badge>
          <Badge variant="status-processing">Processing</Badge>
          <Badge variant="status-to_review">To Review</Badge>
          <Badge variant="status-completed">Completed</Badge>
          <Badge variant="status-archived">Archived</Badge>
        </div>
      </div>
    </div>
  ),
};
