/**
 * Small helpers shared between CourseSpacePage and CourseSections so
 * neither has to import the other (avoids a circular import between
 * the page shell and its main-column component).
 */
import {
  BookOpen,
  FileText,
  Globe,
  ListChecks,
  Map as MapIcon,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import type { SpaceContent, SpaceContentKind } from "@/types/space";

export const KIND_ICON: Record<SpaceContentKind, LucideIcon> = {
  book: BookOpen,
  resource: Globe,
  quiz: ListChecks,
  roadmap: MapIcon,
  note: FileText,
  whiteboard: Shapes,
  link: Globe,
  file: FileText,
  label: FileText,
};

/** Internal route for a content item by kind (when no external url is set). */
export function internalHref(item: SpaceContent): string | null {
  if (!item.ref_id) return null;
  switch (item.kind) {
    case "book":
      return `/reader/${item.ref_id}`;
    case "resource":
      return `/resources/${item.ref_id}`;
    case "quiz":
      return `/quizzes/${item.ref_id}`;
    case "roadmap":
      return `/roadmaps/${item.ref_id}`;
    case "note":
      return `/notes/${item.ref_id}`;
    case "whiteboard":
      return `/whiteboards/${item.ref_id}`;
    default:
      return null;
  }
}

export const isExternal = (url: string) => /^https?:\/\//i.test(url);
