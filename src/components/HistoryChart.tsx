import { useEffect, useRef } from "react";
import type { HistoryBucket } from "../lib/types";

type Props = { buckets: HistoryBucket[] };

export function HistoryChart({ buckets }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const surface = prepareCanvas(canvas);
      if (!surface) return;
      const { ctx, width, height } = surface;
      ctx.clearRect(0, 0, width, height);
      if (buckets.length === 0) return;

      const padLeft = 34, padRight = 10, padTop = 10, padBottom = 10;
      const graphWidth = width - padLeft - padRight;
      const graphHeight = height - padTop - padBottom;
      const maxValue = Math.max(1, ...buckets.flatMap((b) => [b.received, b.sent])) * 1.15;
      const barWidth = (graphWidth / buckets.length) * 0.34;
      const gap = (graphWidth / buckets.length) * 0.12;

      ctx.strokeStyle = "#21262d";
      ctx.lineWidth = 0.5;
      ctx.fillStyle = "#484f58";
      ctx.font = "10px Segoe UI, sans-serif";
      ctx.textAlign = "right";

      for (let step = 0; step <= 5; step += 1) {
        const value = (maxValue / 5) * step;
        const y = padTop + graphHeight - (value / maxValue) * graphHeight;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(width - padRight, y);
        ctx.stroke();
        ctx.fillText(String(Math.round(value)), padLeft - 4, y + 3);
      }

      buckets.forEach((bucket, i) => {
        const centerX = padLeft + (i / buckets.length) * graphWidth + graphWidth / (buckets.length * 2);
        const rxHeight = (bucket.received / maxValue) * graphHeight;
        const txHeight = (bucket.sent / maxValue) * graphHeight;

        ctx.fillStyle = "#3fb950cc";
        ctx.fillRect(centerX - barWidth - gap / 2, padTop + graphHeight - rxHeight, barWidth, rxHeight);
        ctx.fillStyle = "#a78bfa99";
        ctx.fillRect(centerX + gap / 2, padTop + graphHeight - txHeight, barWidth, txHeight);
      });
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [buckets]);

  return <canvas ref={ref} className="block h-[170px] w-full" width={420} height={170} />;
}

function prepareCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height || canvas.height));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}
