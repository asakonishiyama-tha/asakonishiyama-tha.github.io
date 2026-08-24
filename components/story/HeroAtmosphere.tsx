"use client";

import { useEffect, useRef } from "react";

import styles from "@/components/story/story.module.css";
import { useHydrationSafeReducedMotion } from "@/lib/story/motion";

type MeshPoint = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  accent: boolean;
};

const connectionDistance = 205;
const frameInterval = 1000 / 30;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createPoints(width: number, height: number) {
  const random = seededRandom(Math.round(width + height));
  const count = width < 720 ? 34 : 64;

  return Array.from({ length: count }, (_, index): MeshPoint => ({
    x: random() * width,
    y: random() * height,
    vx: (random() - 0.5) * 0.18,
    vy: (random() - 0.5) * 0.18,
    radius: index % 9 === 0 ? 3.1 : 1.6 + random() * 1.1,
    accent: index % 13 === 0,
  }));
}

function drawMesh(context: CanvasRenderingContext2D, points: MeshPoint[], width: number, height: number) {
  context.clearRect(0, 0, width, height);

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    point.x += point.vx;
    point.y += point.vy;

    if (point.x < -20 || point.x > width + 20) point.vx *= -1;
    if (point.y < -20 || point.y > height + 20) point.vy *= -1;

    for (let peerIndex = index + 1; peerIndex < points.length; peerIndex += 1) {
      const peer = points[peerIndex]!;
      const distance = Math.hypot(point.x - peer.x, point.y - peer.y);
      if (distance >= connectionDistance) continue;

      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(peer.x, peer.y);
      context.strokeStyle = `rgba(189, 235, 255, ${(1 - distance / connectionDistance) * 0.48})`;
      context.lineWidth = 0.95;
      context.stroke();
    }

    context.save();
    context.beginPath();
    context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
    context.fillStyle = point.accent ? "rgba(255, 233, 60, 1)" : "rgba(215, 243, 255, .96)";
    context.shadowBlur = point.accent ? 18 : 9;
    context.shadowColor = point.accent ? "rgba(255, 233, 60, .9)" : "rgba(189, 235, 255, .72)";
    context.fill();
    context.restore();
  }
}

export function HeroAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useHydrationSafeReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let lastFrame = 0;
    let width = 0;
    let height = 0;
    let points: MeshPoint[] = [];

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      points = createPoints(width, height);
      drawMesh(context, points, width, height);
    };

    const animate = (time: number) => {
      if (time - lastFrame >= frameInterval) {
        drawMesh(context, points, width, height);
        lastFrame = time;
      }
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    frame = window.requestAnimationFrame(animate);
    window.addEventListener("resize", resize, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  return (
    <div
      className={styles.heroAtmosphere}
      data-hero-atmosphere="timeMesh"
      data-motion-state={reducedMotion ? "static" : "animated"}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
      <svg className={styles.staticMesh} viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">
        <g>
          <path d="M70 390 180 250 330 330 470 150 640 245 760 90" />
          <path d="M180 250 270 105 470 150 540 365 640 245" />
          {[70, 180, 270, 330, 470, 540, 640, 760].map((x, index) => (
            <circle key={x} cx={x} cy={[390, 250, 105, 330, 150, 365, 245, 90][index]} r={index === 4 ? 5 : 3} />
          ))}
        </g>
      </svg>
    </div>
  );
}
