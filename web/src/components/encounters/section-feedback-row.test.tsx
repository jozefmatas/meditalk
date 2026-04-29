// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionFeedbackRow } from "./section-feedback-row";

// Mock hugeicons
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <span data-testid={testId} />
  ),
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  ThumbsUpIcon: { name: "ThumbsUpIcon" },
  ThumbsDownIcon: { name: "ThumbsDownIcon" },
}));

vi.mock("@/components/shared/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

afterEach(cleanup);

describe("SectionFeedbackRow", () => {
  it("renders thumbs-up and thumbs-down buttons", () => {
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onThumbsDown={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Thumbs up")).toBeInTheDocument();
    expect(screen.getByLabelText("Thumbs down")).toBeInTheDocument();
  });

  it("calls onThumbsUp when up button clicked", async () => {
    const onUp = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={onUp}
        onThumbsDown={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Thumbs up"));
    expect(onUp).toHaveBeenCalledOnce();
  });

  it("calls onThumbsDown when down button clicked", async () => {
    const onDown = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onThumbsDown={onDown}
      />,
    );

    await user.click(screen.getByLabelText("Thumbs down"));
    expect(onDown).toHaveBeenCalledOnce();
  });

  it("highlights up button when rating is up", () => {
    render(
      <SectionFeedbackRow
        rating="up"
        onThumbsUp={vi.fn()}
        onThumbsDown={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Thumbs up")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByLabelText("Thumbs down")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights down button when rating is down", () => {
    render(
      <SectionFeedbackRow
        rating="down"
        onThumbsUp={vi.fn()}
        onThumbsDown={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Thumbs up")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.getByLabelText("Thumbs down")).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});
