import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  File01Icon,
  Delete01Icon,
  Mic01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./index";

const meta = {
  title: "UI/Table",
  component: Table,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

const invoices = [
  { id: "INV001", status: "Paid", method: "Credit Card", amount: "$250.00" },
  { id: "INV002", status: "Pending", method: "PayPal", amount: "$150.00" },
  {
    id: "INV003",
    status: "Unpaid",
    method: "Bank Transfer",
    amount: "$350.00",
  },
];

export const Default: Story = {
  render: () => (
    <Table className="w-[500px]">
      <TableCaption>A list of recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium">{inv.id}</TableCell>
            <TableCell>{inv.status}</TableCell>
            <TableCell>{inv.method}</TableCell>
            <TableCell className="text-right">{inv.amount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

const files = [
  { name: "report.pdf", type: "application/pdf" },
  { name: "scan-results.jpg", type: "image/jpeg" },
  { name: "notes.txt", type: "text/plain" },
  {
    name: "very-long-filename-that-should-truncate.pdf",
    type: "application/pdf",
  },
  { name: "AUD-20260310-WA0006.ogg", type: "audio/ogg" },
];

export const Compact: Story = {
  name: "Compact (Files)",
  render: () => (
    <div className="w-[240px]">
      <span className="text-xs text-foreground/65">Uploaded files</span>
      <Table variant="compact">
        <TableBody>
          {files.map((file) => (
            <TableRow key={file.name} className="group border-border">
              <TableCell>
                <div className="flex min-w-0 items-center gap-1">
                  <HugeiconsIcon
                    icon={
                      file.type.startsWith("audio/") ? Mic01Icon : File01Icon
                    }
                    size={14}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <HugeiconsIcon icon={Delete01Icon} size={12} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};
