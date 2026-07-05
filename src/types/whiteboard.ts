export type WhiteboardTool =
  | "select"
  | "pen"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "eraser";

export type WhiteboardBackground = "solid" | "grid";

export interface Point {
  x: number;
  y: number;
}

interface BaseElement {
  id: string;
  strokeColor: string;
  strokeWidth: number;
  createdAt: number;
  /** Rotation around the element's bbox centre, in radians. Optional
   *  for backward compatibility, readers should treat undefined as 0. */
  rotation?: number;
}

export interface PenElement extends BaseElement {
  type: "pen";
  points: Point[];
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseElement extends BaseElement {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface LineElement extends BaseElement {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ArrowElement extends BaseElement {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  x: number;
  y: number;
  /** Layout width (world units). Height is re-measured on edit and
   *  cached so hit-testing / selection boxes don't need a canvas. */
  width: number;
  height: number;
  text: string;
  fontSize: number;
  /** Text colour. Reuses strokeColor from BaseElement if you want; kept
   *  explicit here so "text color" feels distinct from stroke color. */
  color: string;
}

export type WhiteboardElement =
  | PenElement
  | RectangleElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | TextElement;

export interface WhiteboardData {
  id: string;
  title: string;
  elements: WhiteboardElement[];
  background: WhiteboardBackground;
  createdAt: number;
  updatedAt: number;
  /** Optional book this whiteboard belongs to. Set when the user
   *  creates the whiteboard from a book detail page so it groups
   *  cleanly under "Whiteboards" on that book. Freestanding
   *  whiteboards (created from the OverviewTab "Create Whiteboard"
   *  button or the dedicated /workspace surface later) leave it
   *  undefined. The reader's "auto-create draw whiteboard" path
   *  also leaves it undefined, those exist per-session inside the
   *  reader's dockview, not as book artifacts. */
  bookId?: string;
  /** Library folder this whiteboard lives in, or null/undefined for
   *  the root. Lets whiteboards appear in the library filetree
   *  alongside books + notes. Stored inside this jsonb blob (like
   *  bookId), the whiteboard sync upserts the whole WhiteboardData,
   *  so it round-trips with no schema change. */
  folderId?: string | null;
}
