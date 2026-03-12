"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  useFloating,
  offset,
  flip,
  shift,
} from "@floating-ui/react-dom";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/shared/command";
import type { FlatSection } from "@/lib/templates";

export interface SlashCommandItem {
  id: string;
  label: string;
  level: 2 | 3;
  parentLabel?: string;
}

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
  }));

  useEffect(() => {
    // Focus the command input when mounted
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const sections = items.filter((i) => i.level === 2);
  const subsections = items.filter((i) => i.level === 3);

  return (
    <div className="z-50 w-64 rounded-lg border bg-popover shadow-md">
      <Command className="gap-2" shouldFilter={true}>
        <CommandInput
          ref={inputRef}
          placeholder="Search sections..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No sections found.</CommandEmpty>
          {sections.length > 0 && (
            <CommandGroup heading="Sections">
              {sections.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  onSelect={() => command(item)}
                >
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {subsections.length > 0 && (
            <CommandGroup heading="Subsections">
              {subsections.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.parentLabel} ${item.label}`}
                  onSelect={() => command(item)}
                >
                  <span className="text-muted-foreground">
                    {item.parentLabel} /
                  </span>
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
});

/**
 * Creates a TipTap extension that triggers a searchable command palette
 * when the user types `#` at the start of a line.
 */
export function createSlashCommand(
  getItems: () => SlashCommandItem[],
) {
  return Extension.create({
    name: "slashCommand",

    addOptions() {
      return {
        suggestion: {
          char: "#",
          startOfLine: true,
          command: ({
            editor,
            range,
            props,
          }: {
            editor: ReturnType<typeof import("@tiptap/core").Editor.prototype.chain> extends never ? never : import("@tiptap/core").Editor;
            range: { from: number; to: number };
            props: SlashCommandItem;
          }) => {
            const item = props as SlashCommandItem;
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "heading",
                attrs: { level: item.level },
                content: [{ type: "text", text: item.label }],
              })
              .run();
          },
          items: () => getItems(),
          render: () => {
            let component: ReactRenderer<SlashCommandListRef> | null = null;
            let popup: HTMLDivElement | null = null;

            return {
              onStart: (props: SuggestionProps) => {
                popup = document.createElement("div");
                popup.style.position = "absolute";
                popup.style.zIndex = "50";
                document.body.appendChild(popup);

                // Position near the cursor
                const coords = props.clientRect?.();
                if (coords && popup) {
                  popup.style.left = `${coords.x}px`;
                  popup.style.top = `${coords.y + coords.height + 4}px`;
                }

                component = new ReactRenderer(SlashCommandList, {
                  props: {
                    items: props.items,
                    command: props.command,
                  },
                  editor: props.editor,
                });

                if (popup && component.element) {
                  popup.appendChild(component.element);
                }
              },

              onUpdate: (props: SuggestionProps) => {
                component?.updateProps({
                  items: props.items,
                  command: props.command,
                });

                const coords = props.clientRect?.();
                if (coords && popup) {
                  popup.style.left = `${coords.x}px`;
                  popup.style.top = `${coords.y + coords.height + 4}px`;
                }
              },

              onKeyDown: (props: { event: KeyboardEvent }) => {
                if (props.event.key === "Escape") {
                  component?.destroy();
                  popup?.remove();
                  popup = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },

              onExit: () => {
                component?.destroy();
                popup?.remove();
                popup = null;
              },
            };
          },
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
