"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type Direction = "inbound" | "outbound" | "all";

interface DirectionContextType {
  direction: Direction;
  setDirection: (direction: Direction) => void;
}

const DirectionContext = createContext<DirectionContextType | undefined>(undefined);

export function DirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirection] = useState<Direction>("all");

  return (
    <DirectionContext.Provider value={{ direction, setDirection }}>
      {children}
    </DirectionContext.Provider>
  );
}

export function useDirection() {
  const context = useContext(DirectionContext);
  if (context === undefined) {
    throw new Error("useDirection must be used within a DirectionProvider");
  }
  return context;
}
