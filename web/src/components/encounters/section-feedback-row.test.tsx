// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionFeedbackRow } from "./section-feedback-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    // Strip "encounters.detail.feedback." prefix for test keys
    return key.replace("encounters.detail.feedback.", "");
  },
}));

// Mock hugeicons
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <span data-testid={testId} />
  ),
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  CheckmarkCircle01Icon: { name: "CheckmarkCircle01Icon" },
  AlertCircleIcon: { name: "AlertCircleIcon" },
}));

vi.mock("@/components/shared/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/shared/textarea", () => ({
  Textarea: ({
    value,
    onChange,
    disabled,
    placeholder,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  ),
}));

vi.mock("@/components/shared/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      disabled={disabled}
      aria-label="checkbox"
    />
  ),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("SectionFeedbackRow", () => {
  it("renders Looks good and Needs work buttons", () => {
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("looksGood")).toBeInTheDocument();
    expect(screen.getByText("needsWork")).toBeInTheDocument();
  });

  it("calls onThumbsUp when Looks good clicked", async () => {
    const onUp = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={onUp}
        onSubmitFeedback={vi.fn()}
      />,
    );

    await user.click(screen.getByText("looksGood"));
    expect(onUp).toHaveBeenCalledOnce();
  });

  it("highlights Looks good green when rating=up", () => {
    render(
      <SectionFeedbackRow
        rating="up"
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
      />,
    );

    const looksGoodButton = screen.getByText("looksGood").closest("button");
    expect(looksGoodButton).toHaveClass("bg-green-600");
  });

  it("expands textarea when Needs work clicked", async () => {
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
      />,
    );

    expect(
      screen.queryByPlaceholderText("feedbackPlaceholder"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("needsWork"));

    expect(
      screen.getByPlaceholderText("feedbackPlaceholder"),
    ).toBeInTheDocument();
    expect(screen.getByText("rememberForFuture")).toBeInTheDocument();
    expect(screen.getByText("cancel")).toBeInTheDocument();
    expect(screen.getByText("submit")).toBeInTheDocument();
  });

  it("calls onSubmitFeedback with text and remember=false when submitted unchecked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={onSubmit}
      />,
    );

    await user.click(screen.getByText("needsWork"));
    await user.type(
      screen.getByPlaceholderText("feedbackPlaceholder"),
      "Fix this issue",
    );
    await user.click(screen.getByText("submit"));

    expect(onSubmit).toHaveBeenCalledWith("Fix this issue", false);
  });

  it("calls onSubmitFeedback with text and remember=true when checkbox checked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={onSubmit}
      />,
    );

    await user.click(screen.getByText("needsWork"));
    await user.type(
      screen.getByPlaceholderText("feedbackPlaceholder"),
      "Remember this",
    );
    await user.click(screen.getByLabelText("checkbox"));
    await user.click(screen.getByText("submit"));

    expect(onSubmit).toHaveBeenCalledWith("Remember this", true);
  });

  it("disables submit when textarea is empty", async () => {
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
      />,
    );

    await user.click(screen.getByText("needsWork"));

    const submitButton = screen.getByText("submit");
    expect(submitButton).toBeDisabled();
  });

  it("collapses textarea when Cancel clicked", async () => {
    const user = userEvent.setup();
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
      />,
    );

    await user.click(screen.getByText("needsWork"));
    expect(
      screen.getByPlaceholderText("feedbackPlaceholder"),
    ).toBeInTheDocument();

    await user.click(screen.getByText("cancel"));
    expect(
      screen.queryByPlaceholderText("feedbackPlaceholder"),
    ).not.toBeInTheDocument();
  });

  it("disables all inputs when isRegenerating=true", () => {
    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
        isRegenerating={true}
      />,
    );

    const looksGood = screen.getByText("looksGood").closest("button");
    const needsWork = screen.getByText("needsWork").closest("button");

    expect(looksGood).toBeDisabled();
    expect(needsWork).toBeDisabled();
  });

  it("persists draft to sessionStorage", async () => {
    const user = userEvent.setup();
    const storageKey = "visit-123-section-abc";

    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
        storageKey={storageKey}
      />,
    );

    await user.click(screen.getByText("needsWork"));
    await user.type(
      screen.getByPlaceholderText("feedbackPlaceholder"),
      "Draft text",
    );
    await user.click(screen.getByLabelText("checkbox"));

    const stored = sessionStorage.getItem(storageKey);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({ text: "Draft text", remember: true });
  });

  it("loads draft from sessionStorage on mount", () => {
    const storageKey = "visit-123-section-xyz";
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ text: "Loaded draft", remember: true }),
    );

    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
        storageKey={storageKey}
      />,
    );

    // Textarea should be expanded with draft text
    expect(
      screen.getByPlaceholderText("feedbackPlaceholder"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("feedbackPlaceholder")).toHaveValue(
      "Loaded draft",
    );
    expect(screen.getByLabelText("checkbox")).toBeChecked();
  });

  it("clears sessionStorage when submitted", async () => {
    const user = userEvent.setup();
    const storageKey = "visit-123-section-clear";

    render(
      <SectionFeedbackRow
        rating={null}
        onThumbsUp={vi.fn()}
        onSubmitFeedback={vi.fn()}
        storageKey={storageKey}
      />,
    );

    await user.click(screen.getByText("needsWork"));
    await user.type(
      screen.getByPlaceholderText("feedbackPlaceholder"),
      "Submit this",
    );
    await user.click(screen.getByText("submit"));

    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
});
