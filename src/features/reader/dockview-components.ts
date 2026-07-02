import { WhiteboardPanelWrapper } from "@/features/whiteboard/WhiteboardPanel";
import {
  CommentsPanel,
  NotePanelWrapper,
  TocPanel,
  ViewerPanel,
} from "./dockview-panels";
import { ReaderToolsPanel } from "./panels/ReaderToolsPanel";

export const dockviewComponents = {
  toc: TocPanel,
  pdfViewer: ViewerPanel,
  comments: CommentsPanel,
  // Keeps the `aiChat` id (toggle logic, persisted layouts, the mobile
  // slide-over, and "Send to AI" all reference it) but now mounts the
  // multi-tool switcher whose default tab is the AI chat.
  aiChat: ReaderToolsPanel,
  note: NotePanelWrapper,
  whiteboard: WhiteboardPanelWrapper,
};
