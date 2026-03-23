import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "./index";
import { Button } from "../button";

const meta = {
  title: "UI/Drawer",
  component: Drawer,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open Drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Drawer Title</DrawerTitle>
          <DrawerDescription>
            This is a description of the drawer content.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <p className="text-sm text-muted-foreground">
            Drawer body content goes here. The drawer slides up from the bottom
            of the screen.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open Drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit Profile</DrawerTitle>
          <DrawerDescription>
            Make changes to your profile here.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <p className="text-sm text-muted-foreground">
            Form fields or other interactive content would go here.
          </p>
        </div>
        <DrawerFooter>
          <Button>Save changes</Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};
