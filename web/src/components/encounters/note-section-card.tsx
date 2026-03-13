"use client";

interface NoteSectionCardProps {
  id?: string;
  title: string;
  content: string;
}

export function NoteSectionCard({ id, title, content }: NoteSectionCardProps) {
  return (
    <div id={id} className="rounded-2xl border p-6">
      <div className="flex flex-col gap-3 text-foreground">
        <h3 className="text-lg font-medium">{title}</h3>
        {content && (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-base leading-relaxed [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:ml-6 [&_li]:mb-1"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        )}
      </div>
    </div>
  );
}
