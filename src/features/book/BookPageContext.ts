import { createContext, useContext } from "react";
import type { ResolvedBook } from "./useBookData";

export const BookPageContext = createContext<ResolvedBook | null>(null);

export function useBook(): ResolvedBook {
  const ctx = useContext(BookPageContext);
  if (!ctx) {
    throw new Error("useBook must be used inside a <BookPage> subtree");
  }
  return ctx;
}
