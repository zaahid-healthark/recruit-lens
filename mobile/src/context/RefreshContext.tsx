import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Tiny cross-screen refresh signal: bump() after an import/delete so list and
 * dashboard screens (which depend on `version`) refetch on their next focus.
 */
interface RefreshContextValue {
  version: number;
  bump: () => void;
}

const RefreshContext = createContext<RefreshContextValue>({ version: 0, bump: () => undefined });

export function RefreshProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ version, bump }), [version, bump]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshContextValue {
  return useContext(RefreshContext);
}
