interface PawLogoProps {
  size?: number;
  color?: string;
  className?: string;
}

export default function PawLogo({ size = 22, color = "currentColor", className = "" }: PawLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill={color}
      aria-hidden="true"
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      <ellipse cx="9" cy="13" rx="2.2" ry="2.6" />
      <ellipse cx="14" cy="9.5" rx="2.4" ry="2.8" />
      <ellipse cx="20" cy="9.5" rx="2.4" ry="2.8" />
      <ellipse cx="25" cy="13" rx="2.2" ry="2.6" />
      <path d="M17 15c-5 0-9 3-9 7 0 2.5 2.5 3.5 5 3.5h8c2.5 0 5-1 5-3.5 0-4-4-7-9-7z" />
    </svg>
  );
}
