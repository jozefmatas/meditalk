"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface HeaderActionsContextValue {
  headerActions: React.ReactNode | null;
  setHeaderActions: (actions: React.ReactNode | null) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  headerActions: null,
  setHeaderActions: () => {},
});

export function HeaderActionsProvider({ children }: { children: React.ReactNode }) {
  const [headerActions, setHeaderActionsState] = useState<React.ReactNode | null>(null);
  const setHeaderActions = useCallback((actions: React.ReactNode | null) => {
    setHeaderActionsState(actions);
  }, []);

  return (
    <HeaderActionsContext.Provider value={{ headerActions, setHeaderActions }}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}
