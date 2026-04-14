"use client";

import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Camera01Icon,
  Image02Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/shared/drawer";

interface FilePickerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTakePhoto: () => void;
  onChooseFromGallery: () => void;
  onFileManager: () => void;
}

const options = [
  { key: "takePhoto" as const, icon: Camera01Icon },
  { key: "chooseFromGallery" as const, icon: Image02Icon },
  { key: "fileManager" as const, icon: Folder01Icon },
] as const;

export function FilePickerDrawer({
  open,
  onOpenChange,
  onTakePhoto,
  onChooseFromGallery,
  onFileManager,
}: FilePickerDrawerProps) {
  const t = useTranslations("encounters.detail");

  const handlers: Record<(typeof options)[number]["key"], () => void> = {
    takePhoto: onTakePhoto,
    chooseFromGallery: onChooseFromGallery,
    fileManager: onFileManager,
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("addFileTitle")}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-4 pb-6">
          {options.map(({ key, icon }) => (
            <button
              key={key}
              type="button"
              onClick={handlers[key]}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent active:bg-accent"
            >
              <HugeiconsIcon
                icon={icon}
                size={20}
                className="shrink-0 text-foreground/65"
              />
              {t(key)}
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
