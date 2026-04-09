export function MeshBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 20% 40%, rgba(139, 92, 246, 0.15), transparent),
            radial-gradient(ellipse 60% 40% at 80% 20%, rgba(59, 130, 246, 0.12), transparent),
            radial-gradient(ellipse 50% 60% at 50% 80%, rgba(139, 92, 246, 0.08), transparent),
            #0a0a0f
          `,
        }}
      />
      <div
        className="absolute inset-0 animate-[drift_20s_ease-in-out_infinite]"
        style={{
          background: `
            radial-gradient(ellipse 40% 30% at 70% 60%, rgba(59, 130, 246, 0.1), transparent),
            radial-gradient(ellipse 30% 40% at 30% 30%, rgba(139, 92, 246, 0.08), transparent)
          `,
        }}
      />
    </div>
  );
}
