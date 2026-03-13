import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ClinicSwitcher } from "./clinic-switcher";
import {
  SidebarProvider,
  Sidebar,
  SidebarFooter,
} from "@/components/shared/sidebar";

const meta = {
  title: "Nav/ClinicSwitcher",
  component: ClinicSwitcher,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Sidebar collapsible="icon" style={{ width: 256 }}>
          <SidebarFooter className="p-0">
            <Story />
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof ClinicSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
