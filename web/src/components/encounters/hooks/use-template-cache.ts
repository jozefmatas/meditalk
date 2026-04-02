"use client";

import { useCallback, useRef } from "react";

interface CachedTemplate {
  generatedNote: string;
  letter: string;
}

export function useTemplateCache() {
  const cacheRef = useRef<Map<string, CachedTemplate>>(new Map());

  const getCachedTemplate = useCallback((templateId: string) => {
    return cacheRef.current.get(templateId);
  }, []);

  const setCachedTemplate = useCallback(
    (templateId: string, data: CachedTemplate) => {
      cacheRef.current.set(templateId, data);
    },
    [],
  );

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return { getCachedTemplate, setCachedTemplate, clearCache };
}
