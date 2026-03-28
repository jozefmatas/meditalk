import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Mail01Icon,
  ViewIcon,
  ViewOffIcon,
  Copy01Icon,
  Link01Icon,
  AtIcon,
} from "@hugeicons/core-free-icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
} from "./index";

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Enter text..." />
    </InputGroup>
  ),
};

export const WithIconStart: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Search..." />
    </InputGroup>
  ),
};

export const WithIconEnd: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Email" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>
          <HugeiconsIcon icon={Mail01Icon} />
        </InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithIconsBothSides: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs">
          <HugeiconsIcon icon={Copy01Icon} />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithTextAddon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="example.com" />
    </InputGroup>
  ),
};

export const WithButtonEnd: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <HugeiconsIcon icon={Link01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Enter URL..." />
      <InputGroupAddon align="inline-end">
        <InputGroupButton>Copy</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const PasswordToggle: Story = {
  render: function PasswordToggleStory() {
    return (
      <InputGroup>
        <InputGroupInput type="password" placeholder="Password" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" variant="ghost">
            <HugeiconsIcon icon={ViewOffIcon} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  },
};

export const WithTextarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea placeholder="Write a message..." rows={3} />
      <InputGroupAddon align="block-end">
        <InputGroupButton>Send</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const BlockStartAddon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon align="block-start">
        <InputGroupText>
          <HugeiconsIcon icon={AtIcon} />
          Email address
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="you@example.com" />
    </InputGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <InputGroup data-disabled="true">
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Disabled input" disabled />
    </InputGroup>
  ),
};

export const Ghost: Story = {
  render: () => (
    <InputGroup variant="ghost">
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Search templates..." />
    </InputGroup>
  ),
};

export const ButtonSizes: Story = {
  render: () => (
    <div className="flex w-full flex-col gap-4">
      <InputGroup>
        <InputGroupInput placeholder="xs button" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs">Action</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="icon-xs button" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs">
            <HugeiconsIcon icon={ViewIcon} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput placeholder="icon-sm button" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm">
            <HugeiconsIcon icon={ViewIcon} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};
