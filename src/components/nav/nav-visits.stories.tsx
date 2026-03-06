import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NavVisits } from "./nav-visits";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
} from "@/components/shared/sidebar";

const meta = {
  title: "Nav/NavVisits",
  component: NavVisits,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Sidebar collapsible="icon" style={{ width: 256, height: 400 }}>
          <SidebarContent className="p-2">
            <Story />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof NavVisits>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
