import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type CardSkin = "recolored" | "classic";

export const CARD_SKIN_STORAGE_KEY = "hana-card-skin";

export const CARD_SKIN_OPTIONS: ReadonlyArray<{
  value: CardSkin;
  label: string;
  description: string;
}> = [
  {
    value: "recolored",
    label: "リカラー版",
    description: "鮮やかな現代色の札",
  },
  {
    value: "classic",
    label: "原色版",
    description: "Louie Mantia のオリジナル配色",
  },
];

function normalizeCardSkin(value: string | null): CardSkin {
  return value === "classic" ? "classic" : "recolored";
}

export function readCardSkin(): CardSkin {
  if (typeof window === "undefined") return "recolored";
  return normalizeCardSkin(window.localStorage.getItem(CARD_SKIN_STORAGE_KEY));
}

interface CardSkinContextValue {
  skin: CardSkin;
  setSkin: (skin: CardSkin) => void;
}

const CardSkinContext = createContext<CardSkinContextValue | null>(null);

export function CardSkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkinState] = useState<CardSkin>(readCardSkin);
  const setSkin = useCallback((next: CardSkin) => {
    setSkinState(next);
    window.localStorage.setItem(CARD_SKIN_STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CARD_SKIN_STORAGE_KEY) {
        setSkinState(normalizeCardSkin(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ skin, setSkin }), [skin, setSkin]);
  return <CardSkinContext.Provider value={value}>{children}</CardSkinContext.Provider>;
}

export function useCardSkin(): CardSkinContextValue {
  const context = useContext(CardSkinContext);
  if (!context) {
    throw new Error("useCardSkin must be used inside CardSkinProvider");
  }
  return context;
}
