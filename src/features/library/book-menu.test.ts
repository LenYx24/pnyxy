import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { groupBookMenu } from "./book-menu";
import type { ContextMenuEntry, ContextMenuItem } from "@/stores/context-menu-store";

const t = ((k: string) => k) as unknown as TFunction;
const row = (id: string, danger = false): ContextMenuEntry => ({ id, label: id, onClick: () => {}, danger });

describe("groupBookMenu", () => {
  it("keeps the everyday rows on top and folds the rest into More", () => {
    const out = groupBookMenu(
      [row("open"), row("book-page"), row("info"), row("tags"), row("move"), row("rename"), row("download-pdf"), row("share"), { id: "div-1", divider: true }, row("remove", true)],
      ["open", "move", "rename"],
      () => {},
      t,
    );
    expect(out.map((e) => e.id)).toEqual(["open", "chat", "move", "rename", "more", "div-danger", "remove"]);
    const more = out.find((e) => e.id === "more") as ContextMenuItem;
    expect(more.children?.map((e) => e.id)).toEqual(["book-page", "info", "tags", "download-pdf", "share"]);
  });

  it("skips primary rows the book doesn't have", () => {
    const out = groupBookMenu([row("open"), row("move"), row("remove", true)], ["read", "move", "rename"], () => {}, t);
    expect(out.map((e) => e.id)).toEqual(["move", "chat", "more", "div-danger", "remove"]);
  });
});
