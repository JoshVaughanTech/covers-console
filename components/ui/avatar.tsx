/* ============================================================
   Avatar — initials on a brand-tinted disc (deterministic tint
   per name). AvatarStack overlaps several with an optional +N.
   Placeholder for real worker photos in production.
   ============================================================ */

const AV_TINTS: ReadonlyArray<readonly [string, string]> = [
  ["#E6F4F2", "#075A54"],
  ["#E8F1FC", "#1E5FB0"],
  ["#FDF0E1", "#B45309"],
  ["#EDEAFB", "#5B4BC4"],
  ["#E5F5EE", "#157A57"],
  ["#FDECEC", "#C0353A"],
];

export interface AvatarProps {
  name?: string;
  size?: number;
  ring?: string;
}

export function Avatar({ name = "", size = 30, ring }: AvatarProps) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AV_TINTS.length;
  const [bg, fg] = AV_TINTS[h];

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: size * 0.38,
        fontWeight: 700,
        letterSpacing: ".01em",
        boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 ${2 + 1.5}px ${ring}` : "none",
      }}
    >
      {initials}
    </span>
  );
}

export interface AvatarStackProps {
  names?: string[];
  size?: number;
  max?: number;
  extra?: number;
}

export function AvatarStack({
  names = [],
  size = 28,
  max = 5,
  extra,
}: AvatarStackProps) {
  const shown = names.slice(0, max);
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((n, i) => (
        <span
          key={i}
          style={{
            marginLeft: i ? -8 : 0,
            borderRadius: 999,
            boxShadow: "0 0 0 2px #fff",
          }}
        >
          <Avatar name={n} size={size} />
        </span>
      ))}
      {extra != null && extra > 0 && (
        <span
          style={{
            marginLeft: -8,
            width: size,
            height: size,
            borderRadius: 999,
            background: "var(--bg-2)",
            color: "var(--fg-3)",
            boxShadow: "0 0 0 2px #fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.34,
            fontWeight: 700,
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
