import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch, LabeledSwitch } from "./index";

const meta = {
  title: "UI/Switch",
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="rounded-lg bg-sidebar p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const SmallChecked: Story = {
  args: { size: "sm", defaultChecked: true },
};

export const WithLabel: Story = {
  render: () => <LabeledSwitch label="Enable notifications" />,
};

export const WithLabelChecked: Story = {
  render: () => <LabeledSwitch label="Enable notifications" defaultChecked />,
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Switch />
        <Switch defaultChecked />
        <Switch disabled />
        <Switch disabled defaultChecked />
      </div>
      <div className="flex items-center gap-4">
        <Switch size="sm" />
        <Switch size="sm" defaultChecked />
        <Switch size="sm" disabled />
        <Switch size="sm" disabled defaultChecked />
      </div>
      <LabeledSwitch label="With label (off)" />
      <LabeledSwitch label="With label (on)" defaultChecked />
    </div>
  ),
};
