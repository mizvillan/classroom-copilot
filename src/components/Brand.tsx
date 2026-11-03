export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="brand-mark"
    >
      <rect width="32" height="32" rx="10" fill="var(--lime)" />
      <path
        d="M9 10.5h14M9 16h9.5M9 21.5h5.5"
        stroke="#0b0e0c"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="22.5" cy="21.5" r="2.1" fill="#0b0e0c" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? " brand-compact" : ""}`}>
      <BrandMark size={compact ? 28 : 34} />
      <div className="brand-text">
        <strong>Classroom Copilot</strong>
        {!compact && <span>Deadlines, ranked.</span>}
      </div>
    </div>
  );
}
