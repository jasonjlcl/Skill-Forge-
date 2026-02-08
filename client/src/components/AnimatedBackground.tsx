export const AnimatedBackground = () => {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora-layer aurora-one" />
      <div className="aurora-layer aurora-two" />
      <div className="aurora-layer aurora-three" />
      <div className="noise-overlay" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(56,189,248,0.12),transparent_48%)]" />
    </div>
  );
};

