import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "./index";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "secondary",
        "ghost",
        "destructive",
        "link",
      ],
    },
    size: {
      control: "select",
      options: [
        "default",
        "xs",
        "sm",
        "lg",
        "icon",
        "icon-xs",
        "icon-sm",
        "icon-lg",
      ],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Button",
    variant: "default",
    size: "default",
  },
};

export const Outline: Story = {
  args: { children: "Outline", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "Ghost", variant: "ghost" },
};

export const Destructive: Story = {
  args: { children: "Destructive", variant: "destructive" },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="default">Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra Small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const WithIconAllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs">
          <HugeiconsIcon icon={PlusSignIcon} />
          xs
        </Button>
        <Button size="sm">
          <HugeiconsIcon icon={PlusSignIcon} />
          sm
        </Button>
        <Button size="default">
          <HugeiconsIcon icon={PlusSignIcon} />
          default
        </Button>
        <Button size="lg">
          <HugeiconsIcon icon={PlusSignIcon} />
          lg
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-xs" variant="ghost">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
        <Button size="icon-sm" variant="ghost">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
        <Button size="icon" variant="ghost">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
        <Button size="icon-lg" variant="ghost">
          <HugeiconsIcon icon={Settings01Icon} />
        </Button>
      </div>
    </div>
  ),
};

export const IconButtonAllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon" variant="default">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
      <Button size="icon" variant="outline">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
      <Button size="icon" variant="secondary">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
      <Button size="icon" variant="ghost">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
      <Button size="icon" variant="destructive">
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
    </div>
  ),
};
