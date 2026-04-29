// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FeedbackModal } from "./feedback-modal";

// Mock next-intl — return key as label
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock Dialog to render children directly (avoid Radix portal)
vi.mock("@/components/shared/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Mock Button — plain HTML button
vi.mock("@/components/shared/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

// Mock textarea — plain HTML
vi.mock("@/components/shared/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  onSubmit: vi.fn(),
  sectionTitle: "History",
};

afterEach(cleanup);

describe("FeedbackModal", () => {
  it("renders category chips that can be toggled", async () => {
    const user = userEvent.setup();
    render(<FeedbackModal {...defaultProps} />);

    // All 7 categories should be visible
    const hallucination = screen.getByRole("button", {
      name: /hallucination/i,
    });
    expect(hallucination).toBeInTheDocument();

    // Click to select
    await user.click(hallucination);
    expect(hallucination).toHaveAttribute("data-selected", "true");

    // Click again to deselect
    await user.click(hallucination);
    expect(hallucination).toHaveAttribute("data-selected", "false");
  });

  it("shows textarea when a category is selected", async () => {
    const user = userEvent.setup();
    render(<FeedbackModal {...defaultProps} />);

    // No textarea initially
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Select a category
    await user.click(screen.getByRole("button", { name: /missing-info/i }));

    // Textarea appears
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("submits selected categories and detail text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FeedbackModal {...defaultProps} onSubmit={onSubmit} />);

    // Select two categories
    await user.click(screen.getByRole("button", { name: /hallucination/i }));
    await user.click(screen.getByRole("button", { name: /style/i }));

    // Type detail
    await user.type(
      screen.getByRole("textbox"),
      "Patient never mentioned fever",
    );

    // Submit
    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      categories: ["hallucination", "style"],
      detail: "Patient never mentioned fever",
    });
  });

  it("disables submit when no categories selected", () => {
    render(<FeedbackModal {...defaultProps} />);

    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeDisabled();
  });
});
