import { WhiteboardPanelWrapper } from "@/features/whiteboard/WhiteboardPanel";
import {
  CommentsPanel,
  NotePanelWrapper,
  TocPanel,
  ViewerPanel,
} from "./dockview-panels";
import { AiChatPanel } from "./panels/AiChatPanel";

export const dockviewComponents = {
  toc: TocPanel,
  pdfViewer: ViewerPanel,
  comments: CommentsPanel,
  aiChat: AiChatPanel,
  note: NotePanelWrapper,
  whiteboard: WhiteboardPanelWrapper,
};
