/**
 * /chat composition root. Lays out the desk (sidebar) and the sheet
 * (header, thread, composer, bottom spacer) and wires the pieces together
 * through useChatPageState. No feature logic lives here: the sidebar,
 * thread and composer each own their state; this file only composes.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import "../chat.css";
import { ChatSidebar } from "../sidebar/ChatSidebar";
import { ChatThread } from "../thread/ChatThread";
import { ChatSheetHeader } from "./ChatSheetHeader";
import { ComposerDock } from "./ComposerDock";
import { useChatPageState, type ChatPageScope } from "./useChatPageState";

export type { ChatPageScope } from "./useChatPageState";

export function ChatPage({ scope }: { scope?: ChatPageScope } = {}) {
  const { t } = useTranslation();
  // soft-keyboard height, lifts the composer. 100dvh alone lagged on Android.
  const keyboardInset = useKeyboardInset();
  const page = useChatPageState(scope);
  const { setMobileListOpen, setBranchFromId } = page;
  const closeDrawer = useCallback(() => setMobileListOpen(false), [setMobileListOpen]);
  const clearBranch = useCallback(() => setBranchFromId(null), [setBranchFromId]);

  if (!page.user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="text-center">
          <MessagesSquare size={36} className="mx-auto mb-3 text-text-muted/50" />
          <p className="text-sm text-text-primary font-medium">
            {t("chat.signInRequired")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("chat.signInHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full">
      <ChatSidebar
        scope={scope}
        scopeSource={page.scopeSource}
        visibleConversations={page.visibleConversations}
        rootFolderId={page.chatRootFolderId}
        onRootFolderChange={page.setChatRootFolderId}
        mobileOpen={page.mobileListOpen}
        onMobileClose={closeDrawer}
        onNew={page.handleNew}
        confirm={page.confirm}
      />

      {/* the sheet: surface-1, rounded toward the panel, the one shadow */}
      <main
        className="relative isolate flex min-w-0 flex-1 flex-col bg-bg-secondary transition-[padding] duration-150 ease-out sm:rounded-page sm:shadow-page"
        style={{
          paddingBottom: keyboardInset > 0 ? keyboardInset : undefined,
        }}
      >
        <ChatSheetHeader
          activeTitle={page.activeTitle}
          headerBook={page.headerBook}
          canExport={page.activeConversation !== null}
          onExport={page.handleExportActive}
          onNew={page.handleNew}
          onOpenDrawer={() => setMobileListOpen(true)}
          scopeDocId={scope?.docId}
        />

        {/* conversation sheet, thread capped at 820 and centered. While the
            thread is empty (no conversation or a fresh one) the composer is
            centered vertically Gemini-style: the scroll area above and the
            spacer below both grow; on the first message the spacer collapses
            (200 ms) and the composer slides to its bottom position. The
            composer stays the same node in both states so focus survives. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatThread
            activeId={page.activeId}
            activeConversation={page.activeConversation}
            messages={page.messages}
            activeLeafId={page.activeLeafId}
            streamingMessageId={page.streamingMessageId}
            threadPath={page.threadPath}
            settling={page.settling}
            threadLoading={page.threadLoading}
            sheetCentered={page.sheetCentered}
            confirm={page.confirm}
            onBranchHere={setBranchFromId}
            onEmptySuggestion={page.handleEmptySuggestion}
          />

          {/* composer column. keeps horizontal padding on mobile so the
              card stays inset; pb drops to 0 so it sits flush to the bottom */}
          <ComposerDock
            value={page.input}
            onChange={page.setInput}
            activeId={page.activeId}
            activeConversation={page.activeConversation}
            scopeSource={page.scopeSource}
            branchFromId={page.branchFromId}
            branchParent={page.branchParent}
            onClearBranch={clearBranch}
            composerWrapRef={page.composerWrapRef}
          />
          {/* bottom spacer, grows only in the empty state (see above) */}
          <div
            aria-hidden
            className={cn(
              "shrink-0 basis-0 transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
              // no animation while settling: a corrected guess snaps
              // silently instead of visibly sliding the composer
              page.settling && "transition-none",
              page.sheetCentered ? "grow" : "grow-0",
            )}
          />
        </div>
      </main>
      {page.ConfirmModalElement}
    </div>
  );
}
