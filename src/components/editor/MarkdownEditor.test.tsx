import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownEditor } from "./MarkdownEditor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MarkdownEditor", () => {
  it("parses the markdown value into rich content", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownEditor value={"# Title\n\n- one\n- **two**"} onChange={onChange} />,
      );
    });
    const content = host.querySelector(".md-editor__content");
    expect(content?.querySelector("h1")?.textContent).toBe("Title");
    expect(content?.querySelectorAll("li").length).toBe(2);
    expect(content?.querySelector("strong")?.textContent).toBe("two");
    // nothing emitted for the initial load
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });
});
