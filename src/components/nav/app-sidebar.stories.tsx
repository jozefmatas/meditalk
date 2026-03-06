import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "@/components/shared/sidebar";

const meta = {
  title: "Nav/AppSidebar",
  component: AppSidebar,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div style={{ display: "flex", height: "100vh" }}>
          <Story />
          <main style={{ flex: 1, padding: 16 }}>
            <p>Main content area</p>
          </main>
        </div>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof AppSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = {
  decorators: [
    (Story) => (
      <SidebarProvider defaultOpen={false}>
        <div style={{ display: "flex", height: "100vh" }}>
          <Story />
          <main style={{ flex: 1, padding: 16 }}>
            <p>Main content area</p>
          </main>
        </div>
      </SidebarProvider>
    ),
  ],
};
