import Image from "next/image";
import { cn } from "@/lib/utils";

interface TemplateIconProps {
  specialty?: string;
  size?: number;
  className?: string;
}

const specialtyImages: Record<string, string> = {
  cardiology: "/specialties/cardiology.png",
  general: "/specialties/general.png",
};

/**
 * Template icon component that shows a specialty-specific image
 */
export function TemplateIcon({
  specialty,
  size = 56,
  className,
}: TemplateIconProps) {
  const key = specialty?.toLowerCase();
  const image = (key && specialtyImages[key]) || specialtyImages.general;

  return (
    <Image
      src={image}
      alt={specialty ?? ""}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-xl object-cover", className)}
    />
  );
}
