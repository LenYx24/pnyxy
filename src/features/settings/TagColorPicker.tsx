import { useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  COLOR_KEYS,
  COLOR_PALETTE,
  colorKeyToHex,
  isPaletteKey,
  normalizeHex,
  type ColorKey,
} from "@/lib/tag-colors";

const swatchBase = "h-5 w-5 cursor-pointer rounded-full transition-all";
const swatchActive =
  "scale-110 ring-2 ring-text-primary ring-offset-2 ring-offset-bg-tertiary";
const swatchIdle = "opacity-60 hover:scale-110 hover:opacity-100";

/**
 * Palette swatches + a "custom" swatch. The custom swatch reveals a
 * `.field` hex input with a live preview dot and a styled button that
 * proxies to a visually hidden native `<input type="color">` (the
 * browser's color dialog is fine, its default button is not).
 */
export function TagColorPicker({
  value,
  onChange,
}: {
  value: ColorKey;
  onChange: (next: ColorKey) => void;
}) {
  const { t } = useTranslation();
  const isCustom = !isPaletteKey(value);
  const [customOpen, setCustomOpen] = useState(isCustom);
  const [draft, setDraft] = useState<string>(colorKeyToHex(value));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(colorKeyToHex(value));
  }, [value]);

  const commitDraft = () => {
    const hex = normalizeHex(draft);
    if (hex) {
      setDraft(hex);
      if (hex !== value) onChange(hex);
    } else {
      setDraft(colorKeyToHex(value));
    }
  };

  const previewHex = normalizeHex(draft) ?? colorKeyToHex(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {COLOR_KEYS.map((key) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setCustomOpen(false);
                onChange(key);
              }}
              aria-pressed={active}
              aria-label={key}
              className={cn(
                swatchBase,
                COLOR_PALETTE[key].dot,
                active ? swatchActive : swatchIdle,
              )}
              title={key}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          aria-pressed={isCustom || customOpen}
          aria-label={t("settings.tagsSection.customColor")}
          title={t("settings.tagsSection.customColor")}
          style={isCustom ? { backgroundColor: previewHex } : undefined}
          className={cn(
            swatchBase,
            "flex items-center justify-center",
            !isCustom &&
              "bg-[conic-gradient(from_0deg,#f87171,#fbbf24,#4ade80,#2dd4bf,#60a5fa,#c084fc,#f472b6,#f87171)]",
            isCustom || customOpen ? swatchActive : swatchIdle,
          )}
        >
          {!isCustom && <Pipette size={10} className="text-black/70" />}
        </button>
      </div>

      {customOpen && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => nativeRef.current?.click()}
            aria-label={t("settings.tagsSection.pickColor")}
            title={t("settings.tagsSection.pickColor")}
            style={{ backgroundColor: previewHex }}
            className="relative h-7 w-7 shrink-0 cursor-pointer rounded-control ring-1 ring-inset ring-white/15 transition-transform hover:scale-105"
          >
            <input
              ref={nativeRef}
              type="color"
              tabIndex={-1}
              aria-hidden="true"
              value={previewHex}
              onChange={(e) => {
                const hex = normalizeHex(e.target.value);
                if (hex) {
                  setDraft(hex);
                  onChange(hex);
                }
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
            spellCheck={false}
            maxLength={7}
            placeholder="#rrggbb"
            aria-label={t("settings.tagsSection.hexLabel")}
            className="field w-28 px-2 py-1 font-mono text-[13px]"
          />
        </div>
      )}
    </div>
  );
}
