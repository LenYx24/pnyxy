# UI v2 restyle: features that must survive (inventory, 2026-08-25)

Mockups: docs/ui-v2-chat.html, docs/ui-v2-reader.html, docs/library-redesign-reference.html. The mockups are the visual language, NOT a feature spec. Everything CORE below stays; FLAGGED items keep their gate (src/lib/features.ts). Suggested placement in the new language is given per item.

## Chat (src/features/chat)
Shown in mockup: rail, conversation list with search + date grouping + book subtitle, new-chat pencil, thread with page-citation chip, Socratic quick replies, composer with context chip + teacher-mode chip + attach + send, quota/model footer line.

Not shown, must stay:
- Folders: create/rename/delete/subfolder/move/drag-to-root/back-to-all, expand/collapse all -> sidebar section headers + row context menu, header icon.
- Per-conversation rename/delete -> row hover kebab. Sidebar resize handle (invisible). Mobile drawer.
- Graph button (FLAGGED graph), export to Markdown, "open quotas" -> overflow kebab top-right; footer quota line becomes clickable.
- Source-document chip: open in reader / hide -> composer chip with jump + dismiss. Branch-from banner (cancel). Scroll-to-bottom FAB. Roadmap open-in-editor (FLAGGED roadmaps).
- Message actions (biggest gap): copy, edit (+save and send), regenerate, branch here -> hover action row under message; duplicate from here, delete, share answer, read aloud/stop, save as flashcards (FLAGGED flashcards) -> message overflow; branch switcher -> small pager under message. Typing indicator. Attachment thumbnails + remove above textarea.
- Composer: send swaps to stop while streaming; mic dictation; model picker (footer chip opens it) + model help modal; mode picker (default/books/videos/image) -> chip; whole-book context -> chip / context-chip menu; reasoning toggle -> chip; reading-context insert -> "+" menu; mobile "+" menu bundles these; Enter/Shift+Enter.
- NEW: "Tanár mód" toggle does not exist yet (wire to a system-prompt preset; day-2 task).

## Reader (src/features/reader)
Shown: back, title + section, page counter, search, zoom, sun, Tanár toggle, TOC panel, margin card with quick replies, "earlier in this chapter", ask-about-page input.

Not shown, must stay:
- Toolbar ids (toolbar-config.ts, ~28): menu, pageNav editable, zoom in AND out, aiChat toggle (Ctrl+I), undo (shows when annotating), cropToAi, search (Ctrl+F) + replace (Ctrl+H) + n/Shift+N, night, readingTracker, focusTimer + floating badge, zen (Ctrl+.), highlight color picker, theme cycle, rotate, reflow, screenshot + area, print, sidebar toggle (Ctrl+\), fullscreen (F), export highlights md/json, toolbar editor (drag zones, height/padding, reset), book overview link. FLAGGED: inPageDraw + whiteboardDraw (whiteboard), bookmark (bookmarks), comments (comments). Placement: 5 in the header cluster, rest in the overflow menu.
- Sidebar: Contents (outline + thumbnail view), open from library / open another PDF; FLAGGED tabs bookmarks/notes/whiteboards; DocumentTabs (multiDoc); ReadProgressStrip (readProgress).
- Tools panel tabs: AI chat (+pop out, close), Dictionary, Wikipedia, Translate; FLAGGED graph/notes/whiteboard.
- Selection menu (AnnotationContextMenu): 5 highlight colors + remove, define, translate, read aloud, wikipedia, explain, send to chat, copy, share; add comment (FLAGGED comments). EPUB selection popover, comment popover.
- Mobile bottom bar + mobile toolbar overflow.
- Keyboard layer: Ctrl+F/H, n/N, Ctrl+G, Ctrl+\, Ctrl+I, Ctrl+M, Ctrl+P, Ctrl+Z, Ctrl+., F, 1-5 colors, hjkl, arrows, PageUp/Down, Space/Shift+Space, Home/End, Ctrl+wheel, o.
- NEW: margin card + quick replies + "earlier in this chapter" do not exist; the right panel AI chat tab becomes the margin.

## Library (src/features/library)
Shown: breadcrumb, search, list toggle, Hozzáadás, columns, folder rows, book rows, inline detail (Folytatás / Új chat / Kikérdezés flag, linked chips), drop zone, footer.

Not shown, must stay:
- Search clear + Escape, refresh, grid half of the toggle, tag filter bar, type chips (All/Books/Chats/Resources; FLAGGED notes/whiteboards/quizzes), filter disclosure.
- Add menu depth: upload, open file, scan device, from URL, manual entry, new folder, new chat, new resource; create note/whiteboard/quiz FLAGGED (gate them in the menu, today they are not gated).
- Library right-click menu, drag-drop overlay + paste URL, upload job strip (progress/cancel/retry/close).
- Row menu: open, open in reader, file info, manage tags, move to folder, rename, download, delete; share to community (FLAGGED forum, verify). Folder menu: open, rename, new subfolder, delete. Drag reorder + drag into folder.
- Selection bar (count, move, delete, clear) + bulk delete confirm; storage usage bar; streak pill + celebration; empty states (no results, no tag results, empty folder + drag hint, browse catalog).
