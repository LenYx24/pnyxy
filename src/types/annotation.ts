export type AnnotationId = string;
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";

/** Rectangle relative to a PDF page, percentage coordinates (0-1) */
export interface PageRect {
  pageNum: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Serialized text selection */
export interface TextSelection {
  text: string;
  rects: PageRect[];
}

export interface Highlight {
  id: AnnotationId;
  documentId: string;
  color: HighlightColor;
  selection: TextSelection;
  createdAt: number;
}

export interface CommentMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface Comment {
  id: AnnotationId;
  documentId: string;
  selection: TextSelection;
  highlightId?: AnnotationId;
  messages: CommentMessage[];
  resolved: boolean;
  createdAt: number;
}
