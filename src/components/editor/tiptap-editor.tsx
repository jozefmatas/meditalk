"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import {
  createSlashCommand,
  type SlashCommandItem,
} from "./slash-command";

interface TiptapEditorProps {
  content: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  /** Callback to expose the editor instance to the parent. */
  onEditorReady?: (editor: Editor) => void;
  /** Flat list of template sections for the # slash command. */
  slashCommandItems?: SlashCommandItem[];
}

export function TiptapEditor({
  content,
  onChange,
  placeholder,
  editable = true,
  className,
  onEditorReady,
  slashCommandItems,
}: TiptapEditorProps) {
  const slashItemsRef = useRef<SlashCommandItem[]>(slashCommandItems ?? []);
  slashItemsRef.current = slashCommandItems ?? [];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder || "",
      }),
      ...(slashCommandItems
        ? [createSlashCommand(() => slashItemsRef.current)]
        : []),
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-[4rem]",
      },
    },
  });

  // Expose editor to parent
  const readyFired = useRef(false);
  useEffect(() => {
    if (editor && onEditorReady && !readyFired.current) {
      readyFired.current = true;
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  if (!editor) return null;

  return (
    <div className={cn("rounded-lg border bg-background", className)}>
      <EditorContent
        editor={editor}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none px-3 py-2",
          "[&_.ProseMirror]:outline-none",
          "[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-1",
          "[&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1",
          "[&_.ProseMirror_p]:text-sm [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_p]:mb-2",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
        )}
      />
    </div>
  );
}

export type { Editor, SlashCommandItem };
