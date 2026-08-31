import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Select } from "./Select";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("Select", () => {
  it("opens on trigger click, selects an option, and closes with focus back on the trigger", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <Select
          value="a"
          onChange={onChange}
          options={options}
          ariaLabel="Test select"
        />,
      );
    });

    const trigger = host.querySelector("button") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="listbox"]')).toBeFalsy();

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();

    const optionEls = document.body.querySelectorAll('[role="option"]');
    expect(optionEls.length).toBe(2);

    await act(async () => {
      optionEls[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector('[role="listbox"]')).toBeFalsy();
    expect(document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
    host.remove();
  });

  it("closes on Escape without emitting a change", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <Select
          value="a"
          onChange={onChange}
          options={options}
          ariaLabel="Test select"
        />,
      );
    });

    const trigger = host.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();

    const listbox = document.body.querySelector(
      '[role="listbox"]',
    ) as HTMLElement;
    await act(async () => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="listbox"]')).toBeFalsy();

    await act(async () => root.unmount());
    host.remove();
  });
});
