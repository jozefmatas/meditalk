"use client";

import { useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { cn } from "@/lib/utils";

interface SubsectionData {
  id: string;
  title: string;
  content: string;
}

interface NoteSectionCardProps {
  id?: string;
  sectionId: string;
  title: string;
  content: string;
  subsections?: SubsectionData[];
  onContentChange?: (sectionId: string, newContent: string) => void;
  onRemove?: (sectionId: string) => void;
  /** Which section/subsection ID to auto-focus (set after re-adding from sidebar) */
  autoFocusId?: string | null;
  /** Called after auto-focus completes, so the parent can clear the state */
  onAutoFocused?: () => void;
}

const editorClassName = cn(
  "prose prose-sm dark:prose-invert max-w-none text-foreground",
  "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[1.5em]",
  "[&_.ProseMirror_p]:text-sm [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:mb-2",
  "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:mb-2",
  "[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:mb-2",
  "[&_.ProseMirror_li]:text-sm [&_.ProseMirror_li]:leading-relaxed",
  "[&_.ProseMirror_.is-empty::before]:text-foreground/65 [&_.ProseMirror_.is-empty::before]:content-[attr(data-placeholder)] [&_.ProseMirror_.is-empty::before]:float-left [&_.ProseMirror_.is-empty::before]:h-0 [&_.ProseMirror_.is-empty::before]:pointer-events-none",
);

function InlineEditor({
  sectionId,
  content,
  onContentChange,
  autoFocus,
  onAutoFocused,
}: {
  sectionId: string;
  content: string;
  onContentChange?: (sectionId: string, newContent: string) => void;
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}) {
  const lastEmittedRef = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: "Type here...",
      }),
    ],
    content: content ? `<p>${content.replace(/\n/g, "</p><p>")}</p>` : "",
    editable: !!onContentChange,
    immediatelyRender: false,
    onBlur: ({ editor }) => {
      if (!onContentChange) return;
      const text = editor.getText({ blockSeparator: "\n" }).trim();
      if (text !== lastEmittedRef.current) {
        lastEmittedRef.current = text;
        onContentChange(sectionId, text);
      }
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-[1.5em]",
      },
    },
  });

  // Sync content when it changes externally (e.g. after regeneration)
  const initialContentRef = useRef(content);
  useEffect(() => {
    if (!editor || content === initialContentRef.current) return;
    initialContentRef.current = content;
    lastEmittedRef.current = content;
    editor.commands.setContent(`<p>${content.replace(/\n/g, "</p><p>")}</p>`);
  }, [editor, content]);

  // Auto-focus when section is re-added from sidebar (without triggering scroll)
  useEffect(() => {
    if (!autoFocus || !editor) return;
    requestAnimationFrame(() => {
      const { doc } = editor.state;
      editor.commands.setTextSelection(doc.content.size - 1);
      editor.view.dom.focus({ preventScroll: true });
      onAutoFocused?.();
    });
  }, [autoFocus, editor, onAutoFocused]);

  if (!editor) return null;

  return <EditorContent editor={editor} className={editorClassName} />;
}

function SectionHeader({
  title,
  sectionId,
  onRemove,
  className,
}: {
  title: string;
  sectionId: string;
  onRemove?: (sectionId: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("group/header flex items-center gap-2", className)}>
      <h3 className="text-lg font-medium">{title}</h3>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(sectionId)}
          className="shrink-0 rounded-md p-1 text-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover/header:opacity-100"
        >
          <HugeiconsIcon icon={Delete01Icon} size={14} />
        </button>
      )}
    </div>
  );
}

export function NoteSectionCard({
  id,
  sectionId,
  title,
  content,
  subsections,
  onContentChange,
  onRemove,
  autoFocusId,
  onAutoFocused,
}: NoteSectionCardProps) {
  return (
    <div
      id={id}
      className="group relative rounded-2xl border p-6 transition-colors hover:border-ring focus-within:border-ring focus-within:bg-accent"
    >
      {onRemove && (
        <Button
          variant="destructive"
          size="icon-lg"
          className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => onRemove(sectionId)}
        >
          <HugeiconsIcon icon={Delete01Icon} />
        </Button>
      )}
      <div className="flex flex-col gap-3 text-foreground">
        <SectionHeader
          title={title}
          sectionId={sectionId}
        />

        <InlineEditor
          sectionId={sectionId}
          content={content}
          onContentChange={onContentChange}
          autoFocus={autoFocusId === sectionId}
          onAutoFocused={onAutoFocused}
        />

        {subsections?.map((sub) => (
          <div
            key={sub.id}
            id={`note-section-${sub.id}`}
            className="flex flex-col gap-1 mt-2"
          >
            <SectionHeader
              title={sub.title}
              sectionId={sub.id}
              onRemove={onRemove}
              className="[&_h3]:text-base"
            />
            <InlineEditor
              sectionId={sub.id}
              content={sub.content}
              onContentChange={onContentChange}
              autoFocus={autoFocusId === sub.id}
              onAutoFocused={onAutoFocused}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
