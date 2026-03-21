"use client";

import { useState, useEffect, useMemo } from "react";
import type { Template } from "@/lib/templates";

/** Module-level cache shared across all hook instances. */
const cache = new Map<string, Template>();
const inflight = new Map<string, Promise<Template | null>>();

/**
 * Fetch and cache a single template by ID from the API.
 * Returns `{ template, isLoading }`.
 */
export function useTemplate(id: string | undefined) {
  // Resolve synchronously from cache when possible
  const cached = useMemo(() => (id ? cache.get(id) : undefined), [id]);

  const [fetched, setFetched] = useState<Template | null | undefined>(
    undefined,
  );

  const needsFetch = !!id && !cached && fetched === undefined;

  useEffect(() => {
    if (!id || cache.has(id)) return;

    // Deduplicate inflight requests for the same ID
    let request = inflight.get(id);
    if (!request) {
      request = fetch(`/api/templates/${id}`)
        .then((res) => (res.ok ? (res.json() as Promise<Template>) : null))
        .then((data) => {
          if (data) cache.set(id, data);
          inflight.delete(id);
          return data;
        })
        .catch(() => {
          inflight.delete(id);
          return null;
        });
      inflight.set(id, request);
    }

    let cancelled = false;
    request.then((data) => {
      if (!cancelled) {
        setFetched(data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Reset fetched state when id changes
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setFetched(undefined);
  }

  const template = cached ?? (fetched !== null ? fetched : undefined);

  return { template, isLoading: needsFetch };
}
