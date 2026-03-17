import type { Meta, StoryObj } from "@storybook/react";
import { ErrorAlert } from "./ErrorAlert";

const meta: Meta<typeof ErrorAlert> = {
  title: "UI/ErrorAlert",
  component: ErrorAlert,
  parameters: {
    layout: "padded",
  },
  argTypes: {
    message: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorAlert>;

export const Default: Story = {
  args: {
    message: "Something went wrong. Please try again.",
  },
};

export const InsufficientContext: Story = {
  args: {
    message:
      "Nedostatok klinických informácií na vygenerovanie záznamu. Nahrajte konzultáciu, pridajte poznámky s klinickými detailmi alebo nahrajte relevantné súbory.",
  },
};

export const Short: Story = {
  args: {
    message: "Authentication failed.",
  },
};

export const Long: Story = {
  args: {
    message:
      "Generation failed: The model returned an unexpected response format. This may be caused by a temporary service disruption. Please wait a moment and try again. If the problem persists, contact support.",
  },
};
