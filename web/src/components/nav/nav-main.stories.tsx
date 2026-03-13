import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NavMain } from "./nav-main";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
} from "@/components/shared/sidebar";

const meta = {
  title: "Nav/NavMain",
  component: NavMain,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Sidebar collapsible="icon" style={{ width: 256 }}>
          <SidebarContent className="p-2">
            <Story />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof NavMain>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onSearchClick: () => console.log("Search clicked"),
  },
};
