import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsLineWithAction,
} from "./index";
import type { TabOption } from "./index";

const meta = {
  title: "UI/Tabs",
  component: Tabs,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Account</TabsTrigger>
        <TabsTrigger value="tab2">Password</TabsTrigger>
        <TabsTrigger value="tab3">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <p className="text-sm text-muted-foreground">
          Make changes to your account here.
        </p>
      </TabsContent>
      <TabsContent value="tab2">
        <p className="text-sm text-muted-foreground">
          Change your password here.
        </p>
      </TabsContent>
      <TabsContent value="tab3">
        <p className="text-sm text-muted-foreground">
          Manage your settings here.
        </p>
      </TabsContent>
    </Tabs>
  ),
};

export const Line: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList variant="line">
        <TabsTrigger value="tab1">Transcript</TabsTrigger>
        <TabsTrigger value="tab2">Note</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <p className="text-sm text-muted-foreground">
          Transcript content goes here.
        </p>
      </TabsContent>
      <TabsContent value="tab2">
        <p className="text-sm text-muted-foreground">Note content goes here.</p>
      </TabsContent>
    </Tabs>
  ),
};

export const TwoTabs: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[300px]">
      <TabsList>
        <TabsTrigger value="tab1">Overview</TabsTrigger>
        <TabsTrigger value="tab2">Details</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <p className="text-sm text-muted-foreground">Overview content.</p>
      </TabsContent>
      <TabsContent value="tab2">
        <p className="text-sm text-muted-foreground">Details content.</p>
      </TabsContent>
    </Tabs>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Active</TabsTrigger>
        <TabsTrigger value="tab2" disabled>
          Disabled
        </TabsTrigger>
        <TabsTrigger value="tab3">Another</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <p className="text-sm text-muted-foreground">Active tab content.</p>
      </TabsContent>
      <TabsContent value="tab3">
        <p className="text-sm text-muted-foreground">Another tab content.</p>
      </TabsContent>
    </Tabs>
  ),
};

const ALL_TABS: TabOption[] = [
  { value: "transcript", label: "Transcript" },
  { value: "note", label: "Note" },
  { value: "letter", label: "Patient Letter" },
  { value: "files", label: "Files" },
  { value: "summary", label: "Summary" },
];

function LineWithActionDemo() {
  const [visibleTabs, setVisibleTabs] = useState<TabOption[]>([
    ALL_TABS[0],
    ALL_TABS[1],
  ]);
  const [activeTab, setActiveTab] = useState("transcript");

  const handleAddTab = (value: string) => {
    const tab = ALL_TABS.find((t) => t.value === value);
    if (tab) {
      setVisibleTabs((prev) => [...prev, tab]);
      setActiveTab(value);
    }
  };

  return (
    <TabsLineWithAction
      tabs={visibleTabs}
      availableTabs={ALL_TABS}
      value={activeTab}
      onValueChange={setActiveTab}
      onAddTab={handleAddTab}
      actionLabel="Add document"
      className="w-[500px]"
    >
      {visibleTabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <p className="text-sm text-muted-foreground">
            {tab.label} content goes here.
          </p>
        </TabsContent>
      ))}
    </TabsLineWithAction>
  );
}

export const LineWithAction: Story = {
  render: () => <LineWithActionDemo />,
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Default (pill)
        </p>
        <Tabs defaultValue="tab1" className="w-[400px]">
          <TabsList>
            <TabsTrigger value="tab1">Account</TabsTrigger>
            <TabsTrigger value="tab2">Password</TabsTrigger>
            <TabsTrigger value="tab3">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <p className="text-sm text-muted-foreground">Account content.</p>
          </TabsContent>
        </Tabs>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Line variant
        </p>
        <Tabs defaultValue="tab1" className="w-[400px]">
          <TabsList variant="line">
            <TabsTrigger value="tab1">Transcript</TabsTrigger>
            <TabsTrigger value="tab2">Note</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <p className="text-sm text-muted-foreground">Transcript content.</p>
          </TabsContent>
        </Tabs>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Line with action dropdown
        </p>
        <LineWithActionDemo />
      </div>
    </div>
  ),
};
