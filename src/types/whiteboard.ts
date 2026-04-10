export type WhiteboardTool =
  | "select"
  | "pen"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
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

export type WhiteboardElement =
  | PenElement
  | RectangleElement
  | EllipseElement
  | LineElement
  | ArrowElement;

export interface WhiteboardData {
  id: string;
  title: string;
  elements: WhiteboardElement[];
  background: WhiteboardBackground;
  createdAt: number;
  updatedAt: number;
}
