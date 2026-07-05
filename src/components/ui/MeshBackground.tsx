interface MeshBackgroundProps {
  theme?: "dark" | "light";
}

export function MeshBackground({ theme = "dark" }: MeshBackgroundProps) {
  const light = theme === "light";
  const base = light ? "#f5f3f0" : "#0a0a0f";
  // Soft accent blooms. On light we keep them barely-there so the page
  // reads as one coherent warm off-white, not a patchy varying tint.
  const v1 = light ? "rgba(139, 92, 246, 0.05)" : "rgba(139, 92, 246, 0.15)";
  const b1 = light ? "rgba(59, 130, 246, 0.04)" : "rgba(59, 130, 246, 0.12)";
  const v2 = light ? "rgba(139, 92, 246, 0.03)" : "rgba(139, 92, 246, 0.08)";
  const b2 = light ? "rgba(59, 130, 246, 0.03)" : "rgba(59, 130, 246, 0.1)";
  const v3 = light ? "rgba(139, 92, 246, 0.03)" : "rgba(139, 92, 246, 0.08)";

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 20% 40%, ${v1}, transparent),
            radial-gradient(ellipse 60% 40% at 80% 20%, ${b1}, transparent),
            radial-gradient(ellipse 50% 60% at 50% 80%, ${v3}, transparent),
            ${base}
          `,
        }}
      />
      <div
        className="absolute inset-0 animate-[drift_20s_ease-in-out_infinite]"
        style={{
          background: `
            radial-gradient(ellipse 40% 30% at 70% 60%, ${b2}, transparent),
            radial-gradient(ellipse 30% 40% at 30% 30%, ${v2}, transparent)
          `,
        }}
      />
    </div>
  );
}
