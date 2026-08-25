import { Book, Building2, Folder } from "lucide-react";
import type { AiContextBindingKind } from "./types";

export const BINDING_KIND_ICONS: Record<AiContextBindingKind, typeof Book> = {
  books: Book,
  folders: Folder,
  orgs: Building2,
};
