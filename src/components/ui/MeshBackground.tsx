interface MeshBackgroundProps {
  theme?: "dark" | "light";
}

/**
 * Calm background for public pages (landing + auth).
 *
 * Deliberately NOT a multi-blob gradient "mesh" — that violet, blurred,
 * AI-slop look is gone. Instead: the flat base surface, ONE restrained
 * accent bloom anchored to a corner, and a masked dot grid for texture.
 * No blur, no violet — the colour comes from the teal --color-accent so
 * the public pages stay on-brand with the app.
 */
export function MeshBackground({ theme = "dark" }: MeshBackgroundProps) {
  const light = theme === "light";
  const base = light ? "#f5f3f0" : "#0a0a0f";
  // One restrained accent bloom (teal #0891b2). Stronger on dark where
  // it reads; near-invisible on the warm off-white so the page stays
  // one coherent surface rather than a patchy tint.
  const glow = light ? "rgba(8, 145, 178, 0.06)" : "rgba(8, 145, 178, 0.12)";

  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden"
      style={{ background: base }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 55% 45% at 88% -5%, ${glow}, transparent 60%)`,
        }}
      />
      {/* Faint neutral dot grid, faded out toward the page centre so it
          reads as texture in the corners only. */}
      <div className="grid-dots absolute inset-0 text-text-primary/[0.05] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent_70%)]" />
    </div>
  );
}
