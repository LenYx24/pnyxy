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

/**
 * Record of a text selection that was actually shipped to the AI in
 * a chat conversation. Rendered in the PDF as a thin dotted underline
 * (visually distinct from highlights) so the user can see which
 * passages they've already asked about; clicking the underline opens
 * a popover that lists every conversation message the selection rode
 * along with.
 *
 * Only the "Send to chat" annotation flow creates these — typed or
 * copy-pasted quotes don't trigger one, since we can't reliably
 * recover the source rects from arbitrary text.
 */
export interface AiCitation {
  id: AnnotationId;
  documentId: string;
  selection: TextSelection;
  conversationId: string;
  messageId: string;
  /** First ~60 chars of the user message the selection was attached
   *  to. Kept in-record so the popover doesn't need to load the
   *  whole conversation just to render a label. */
  messageSnippet: string;
  /** Conversation title at the time of the citation; same rationale
   *  as `messageSnippet`. May be empty if the conversation was
   *  unnamed at the time. */
  conversationTitle: string;
  createdAt: number;
}
