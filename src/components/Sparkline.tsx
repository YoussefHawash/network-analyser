type Props = { values: number[]; color: string };

export function Sparkline({ values, color }: Props) {
  const maxValue = Math.max(...values, 1);
  const divisor = Math.max(values.length - 1, 1);
  const points = values
    .map((value, i) => {
      const x = (i / divisor) * 44;
      const y = 18 - (value / maxValue) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="inline-block align-middle"
      width={44}
      height={18}
      viewBox="0 0 44 18"
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
