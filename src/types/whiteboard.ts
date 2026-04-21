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
   *  for backward compatibility — readers should treat undefined as 0. */
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
}
