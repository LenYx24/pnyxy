# Chat feature

The /chat page is split by responsibility so it can be read and edited by hand.
One rule: **the page composes; each piece owns its state.** `page/ChatPage.tsx`
only lays things out and passes data down; nothing else reaches across pieces.

## Folder map

- `ChatPage.tsx`: re-export for the router; the real page is in `page/`.
- `page/ChatPage.tsx`: desk + sheet layout, wires sidebar, header, thread, composer.
- `page/useChatPageState.ts`: store slice, scope filtering, initial-load "settling"
  layout (the only place that logic lives), reader hand-off draft, auto-open,
  new-chat shortcut, composer draft, branch-from id.
- `page/ChatSheetHeader.tsx`: desktop title bar + mobile top bar, kebab menu
  (graph, export, quotas), mounts `page/ChatGraphOverlay.tsx`.
- `page/ComposerDock.tsx`: composer column: roadmap / branch chips, submit mapping
  to the chat store, reading-context loader, source-doc chip.
- `sidebar/ChatSidebar.tsx`: the conversation panel (column / mobile drawer),
  its local state (width, search, collapsed folders, inline rename, folder modals).
- `sidebar/SidebarToolbar.tsx`: header row, view switch, folder/collapse/new buttons, search.
- `sidebar/ChatSidebarContext.tsx`: `useChatSidebar()` gives tree rows their callbacks.
- `sidebar/ChatTree.tsx`, `sidebar/BookChatTree.tsx`: the folder tree / book lineage tree.
- `sidebar/useSidebarDnd.ts`: dnd-kit sensors + drop handling; `sidebar/FolderActionModals.tsx`.
- `thread/ChatThread.tsx`: message list, empty-state headline, spinner, scroll FAB;
  `thread/useThreadScroll.ts` for the follow-the-bottom logic.
- Root: `ChatComposer.tsx`, `MessageBubble.tsx`, `ConversationGraph.tsx`, quota + modals
  (shared with the reader / whiteboard panels, so they stay here).

## Where do I change X

- Add a sidebar row action: add the callback to `ChatSidebarActions` in
  `ChatSidebarContext.tsx`, build it in `ChatSidebar.tsx`, use it in `ChatTree.tsx`.
- Change the empty state (headline, chips): `thread/ChatThread.tsx`.
- Change the composer chips (roadmap, branch, source doc): `page/ComposerDock.tsx`.
- Change how a conversation opens (auto-open, hand-off, new chat): `page/useChatPageState.ts`;
  opening from a row: `handleOpenFromDrawer` in `sidebar/ChatSidebar.tsx`.
- Change the initial-load layout / spinner rules: `settling` in `page/useChatPageState.ts`.
