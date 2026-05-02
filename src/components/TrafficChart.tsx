import { useEffect, useRef } from "react";
import type { TrafficHistory } from "../lib/useMonitor";

type Props = { history: TrafficHistory };

const PAD = { left: 34, right: 12, top: 12, bottom: 28 };
const TIME_LABELS = ["60s", "50s", "40s", "30s", "20s", "10s", "0s"];
const COLOR_RX = "#3fb950";
const COLOR_TX = "#a78bfa";

type Box = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  graphWidth: number;
  graphHeight: number;
};

export function TrafficChart({ history }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const box = prepareCanvas(canvas);
      if (!box) return;
      const max = Math.max(12, ...history.received, ...history.sent) * 1.15;

      box.ctx.clearRect(0, 0, box.width, box.height);
      drawGrid(box, max);
      drawSeries(box, history.received, COLOR_RX, max);
      drawSeries(box, history.sent, COLOR_TX, max);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [history]);

  return (
    <canvas
      ref={ref}
      className="block h-full w-full"
      width={520}
      height={240}
    />
  );
}

function prepareCanvas(canvas: HTMLCanvasElement): Box | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height || canvas.height));
  const bufferWidth = Math.round(width * dpr);
  const bufferHeight = Math.round(height * dpr);

  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    ctx,
    width,
    height,
    graphWidth: width - PAD.left - PAD.right,
    graphHeight: height - PAD.top - PAD.bottom,
  };
}

function drawGrid({ ctx, width, height, graphWidth, graphHeight }: Box, max: number) {
  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 0.5;
  ctx.fillStyle = "#484f58";
  ctx.font = "10px Segoe UI, sans-serif";
  ctx.textAlign = "right";

  for (let step = 0; step <= 6; step += 1) {
    const value = (max / 6) * step;
    const y = PAD.top + graphHeight - (value / max) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(width - PAD.right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(value)), PAD.left - 4, y + 3);
  }

  ctx.textAlign = "center";
  TIME_LABELS.forEach((label, i) => {
    const x = PAD.left + (i / (TIME_LABELS.length - 1)) * graphWidth;
    ctx.fillText(label, x, height - 8);
  });
}

function drawSeries(
  { ctx, graphWidth, graphHeight }: Box,
  data: number[],
  color: string,
  max: number,
) {
  if (data.length === 0) return;

  const x = (i: number) => PAD.left + (i / (data.length - 1)) * graphWidth;
  const y = (v: number) => PAD.top + graphHeight - (v / max) * graphHeight;

  ctx.beginPath();
  data.forEach((value, i) => {
    if (i === 0) ctx.moveTo(x(i), y(value));
    else ctx.lineTo(x(i), y(value));
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(x(data.length - 1), y(0));
  ctx.lineTo(x(0), y(0));
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + graphHeight);
  gradient.addColorStop(0, `${color}40`);
  gradient.addColorStop(1, `${color}05`);
  ctx.fillStyle = gradient;
  ctx.fill();
}
