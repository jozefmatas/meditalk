"use client";

import { createContext, useContext, useState, useEffect } from "react";

interface AdminContextValue {
  isAdmin: boolean;
}

const AdminContext = createContext<AdminContextValue>({ isAdmin: false });

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (window.location.pathname.endsWith("/login")) return;

    let cancelled = false;

    fetch("/api/auth/admin-check")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setIsAdmin(data.isAdmin);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminContext.Provider value={{ isAdmin }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useIsAdmin() {
  return useContext(AdminContext).isAdmin;
}
