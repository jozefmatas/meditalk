"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";
import { createSlashCommand, type SlashCommandItem } from "./slash-command";

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
  useEffect(() => {
    slashItemsRef.current = slashCommandItems ?? [];
  }, [slashCommandItems]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder || "",
        showOnlyCurrent: true,
      }),
      ...(slashCommandItems
        ? // eslint-disable-next-line react-hooks/refs -- callback is invoked at event time, not render
          [createSlashCommand(() => slashItemsRef.current)]
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
    <div
      className={cn(
        "rounded-lg border bg-background transition-colors hover:border-ring focus-within:border-ring focus-within:bg-accent",
        className,
      )}
      onClick={() => {
        if (!editor.isFocused) editor.commands.focus("end");
      }}
    >
      <EditorContent
        editor={editor}
        className={cn(
          "prose dark:prose-invert max-w-none p-6 text-foreground",
          "[&_.ProseMirror]:outline-none",
          "[&_.ProseMirror_h2]:text-lg/6 [&_.ProseMirror_h2]:font-medium [&_.ProseMirror_h2]:mt-0 [&_.ProseMirror_h2]:mb-1 [&_.ProseMirror_h2]:pt-0",
          "[&_.ProseMirror_h3]:text-base/6 [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_h3]:mt-0 [&_.ProseMirror_h3]:mb-1 [&_.ProseMirror_h3]:pt-0",
          "[&_.ProseMirror_p]:text-sm/6 [&_.ProseMirror_p]:font-normal [&_.ProseMirror_p]:mb-2",
          "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:mb-2",
          "[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:mb-2",
          "[&_.ProseMirror_li]:text-base/6",
          "[&_.ProseMirror_.is-empty::before]:text-foreground/65 [&_.ProseMirror_.is-empty::before]:content-[attr(data-placeholder)] [&_.ProseMirror_.is-empty::before]:float-left [&_.ProseMirror_.is-empty::before]:h-0 [&_.ProseMirror_.is-empty::before]:pointer-events-none",
        )}
      />
    </div>
  );
}

export type { Editor, SlashCommandItem };
