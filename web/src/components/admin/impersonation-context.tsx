"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

interface ImpersonationTarget {
  id: string;
  email?: string;
  name?: string;
}

interface ImpersonationContextValue {
  isAdmin: boolean;
  isImpersonating: boolean;
  target: ImpersonationTarget | null;
  startImpersonating: (userId: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  isAdmin: false,
  isImpersonating: false,
  target: null,
  startImpersonating: async () => {},
  stopImpersonating: async () => {},
});

export function ImpersonationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [target, setTarget] = useState<ImpersonationTarget | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/impersonate/status");
      const data = await res.json();
      setIsAdmin(data.isAdmin);
      setIsImpersonating(data.isImpersonating);
      setTarget(data.target || null);
    } catch {
      // Silently fail — non-admin users get defaults
    }
  }, []);

  useEffect(() => {
    // All setState calls in fetchStatus happen asynchronously (after await)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus();
  }, [fetchStatus]);

  const startImpersonating = useCallback(async (userId: string) => {
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) throw new Error("Failed to start impersonation");
    window.location.reload();
  }, []);

  const stopImpersonating = useCallback(async () => {
    await fetch("/api/admin/impersonate", { method: "DELETE" });
    window.location.reload();
  }, []);

  return (
    <ImpersonationContext.Provider
      value={{
        isAdmin,
        isImpersonating,
        target,
        startImpersonating,
        stopImpersonating,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
