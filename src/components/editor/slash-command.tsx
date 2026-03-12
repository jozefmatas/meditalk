"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { useTranslations } from "next-intl";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/shared/command";

export interface SlashCommandItem {
  id: string;
  label: string;
  level: 2 | 3;
  parentLabel?: string;
  /** When true, the parent h2 heading should be inserted before this h3. */
  needsParentHeading?: boolean;
}

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  onDismiss: () => void;
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command, onDismiss }, ref) {
  const t = useTranslations("templates");
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
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const sections = items.filter((i) => i.level === 2);
  const subsections = items.filter((i) => i.level === 3);

  return (
    <div
      className="z-50 w-64 rounded-lg border bg-popover shadow-md"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      <Command className="gap-2" shouldFilter={true}>
        <CommandInput
          ref={inputRef}
          placeholder={t("slashSearchPlaceholder")}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>{t("slashNoResults")}</CommandEmpty>
          {sections.length > 0 && (
            <CommandGroup heading={t("slashSections")}>
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
            <CommandGroup heading={t("slashSubsections")}>
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
 * when the user types `/` in the editor.
 */
export function createSlashCommand(
  getItems: () => SlashCommandItem[],
) {
  return Extension.create({
    name: "slashCommand",

    addOptions() {
      return {
        suggestion: {
          char: "/",
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
            const content: Record<string, unknown>[] = [];

            if (item.needsParentHeading && item.parentLabel) {
              content.push({
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: item.parentLabel }],
              });
            }

            content.push(
              {
                type: "heading",
                attrs: { level: item.level },
                content: [{ type: "text", text: item.label }],
              },
              { type: "paragraph" },
            );

            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(content)
              .run();
          },
          items: () => getItems(),
          render: () => {
            let component: ReactRenderer<SlashCommandListRef> | null = null;
            let popup: HTMLDivElement | null = null;

            const cleanup = () => {
              component?.destroy();
              popup?.remove();
              popup = null;
              component = null;
            };

            return {
              onStart: (props: SuggestionProps) => {
                popup = document.createElement("div");
                popup.style.position = "absolute";
                popup.style.zIndex = "50";
                document.body.appendChild(popup);

                const coords = props.clientRect?.();
                if (coords && popup) {
                  popup.style.left = `${coords.x}px`;
                  popup.style.top = `${coords.y + coords.height + 4}px`;
                }

                component = new ReactRenderer(SlashCommandList, {
                  props: {
                    items: props.items,
                    command: props.command,
                    onDismiss: () => {
                      cleanup();
                      props.editor.commands.focus();
                    },
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
                  cleanup();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },

              onExit: () => {
                cleanup();
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
