import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./index";

const meta = {
  title: "UI/Accordion",
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Accordion type="single" collapsible className="w-96">
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>
          Yes. It adheres to the WAI-ARIA design pattern.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled?</AccordionTrigger>
        <AccordionContent>
          Yes. It comes with default styles that match the other components.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Is it animated?</AccordionTrigger>
        <AccordionContent>
          Yes. It&apos;s animated by default, but you can disable it if you
          prefer.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Bordered: Story = {
  render: () => (
    <Accordion type="single" collapsible className="flex w-96 flex-col gap-3">
      <AccordionItem value="item-1" variant="bordered">
        <AccordionTrigger>Recording transcript</AccordionTrigger>
        <AccordionContent>
          This is the transcript of the audio recording captured during the
          encounter.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2" variant="bordered">
        <AccordionTrigger>Doctor notes</AccordionTrigger>
        <AccordionContent>
          These are the notes the doctor entered during the visit.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3" variant="bordered">
        <AccordionTrigger>Uploaded file.pdf</AccordionTrigger>
        <AccordionContent>
          Extracted text content from the uploaded file would appear here.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Accordion type="single" collapsible className="w-96">
      <AccordionItem value="item-1">
        <AccordionTrigger>Active item</AccordionTrigger>
        <AccordionContent>This item can be expanded.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2" disabled>
        <AccordionTrigger>Disabled item</AccordionTrigger>
        <AccordionContent>This content is not reachable.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Another active item</AccordionTrigger>
        <AccordionContent>This item can also be expanded.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Default
        </p>
        <Accordion type="single" collapsible className="w-96">
          <AccordionItem value="item-1">
            <AccordionTrigger>First item</AccordionTrigger>
            <AccordionContent>Content for the first item.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Second item</AccordionTrigger>
            <AccordionContent>Content for the second item.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Bordered
        </p>
        <Accordion
          type="single"
          collapsible
          className="flex w-96 flex-col gap-3"
        >
          <AccordionItem value="item-1" variant="bordered">
            <AccordionTrigger>First item</AccordionTrigger>
            <AccordionContent>Content for the first item.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2" variant="bordered">
            <AccordionTrigger>Second item</AccordionTrigger>
            <AccordionContent>Content for the second item.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Disabled
        </p>
        <Accordion type="single" collapsible className="w-96">
          <AccordionItem value="item-1">
            <AccordionTrigger>Active</AccordionTrigger>
            <AccordionContent>Active content.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2" disabled>
            <AccordionTrigger>Disabled</AccordionTrigger>
            <AccordionContent>Disabled content.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  ),
};
