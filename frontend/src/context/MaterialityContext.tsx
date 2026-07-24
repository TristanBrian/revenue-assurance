"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface MaterialityContextType {
  materiality: number;
  setMateriality: (value: number) => void;
}

const MaterialityContext = createContext<MaterialityContextType | undefined>(undefined);

export function MaterialityProvider({ children }: { children: React.ReactNode }) {
  const [materiality, setMaterialityState] = useState<number>(100000);

  // Load from localStorage if available on mount
  useEffect(() => {
    const saved = localStorage.getItem("kpc_materiality_threshold");
    if (saved) {
      const parsed = Number(saved);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        setMaterialityState(parsed);
      }
    }
  }, []);

  const setMateriality = (value: number) => {
    setMaterialityState(value);
    localStorage.setItem("kpc_materiality_threshold", String(value));
  };

  return (
    <MaterialityContext.Provider value={{ materiality, setMateriality }}>
      {children}
    </MaterialityContext.Provider>
  );
}

export function useMateriality() {
  const context = useContext(MaterialityContext);
  if (!context) {
    throw new Error("useMateriality must be used within a MaterialityProvider");
  }
  return context;
}
