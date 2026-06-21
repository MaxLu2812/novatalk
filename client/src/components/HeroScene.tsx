import { motion, useSpring } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface OrbConfig {
  size: number;
  gradient: string;
  initialX: number;
  initialY: number;
  floatAmplitude: number;
}

const orbs: OrbConfig[] = [
  { size: 600, gradient: "var(--hero-orb-1)", initialX: -12, initialY: -18, floatAmplitude: 32 },
  { size: 450, gradient: "var(--hero-orb-2)", initialX: 22, initialY: -8, floatAmplitude: 24 },
  { size: 350, gradient: "var(--hero-orb-3)", initialX: -8, initialY: 20, floatAmplitude: 20 },
  { size: 520, gradient: "var(--hero-orb-4)", initialX: 15, initialY: 10, floatAmplitude: 28 },
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

export default function HeroScene() {
  const isMobile = useMediaQuery("(max-width: 720px)");
  const isReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorRatio, setCursorRatio] = useState({ x: 0.5, y: 0.5 });

  const cursorSpringX = useSpring(0.5, { stiffness: 150, damping: 20 });
  const cursorSpringY = useSpring(0.5, { stiffness: 150, damping: 20 });

  useEffect(() => {
    cursorSpringX.set(cursorRatio.x);
    cursorSpringY.set(cursorRatio.y);
  }, [cursorRatio]);

  const o1x = useSpring(0, { stiffness: 100, damping: 20 });
  const o1y = useSpring(0, { stiffness: 100, damping: 20 });
  const o2x = useSpring(0, { stiffness: 100, damping: 20 });
  const o2y = useSpring(0, { stiffness: 100, damping: 20 });
  const o3x = useSpring(0, { stiffness: 100, damping: 20 });
  const o3y = useSpring(0, { stiffness: 100, damping: 20 });
  const o4x = useSpring(0, { stiffness: 100, damping: 20 });
  const o4y = useSpring(0, { stiffness: 100, damping: 20 });

  const orbSprings = [o1x, o1y, o2x, o2y, o3x, o3y, o4x, o4y];

  useEffect(() => {
    if (isReduced) return;
    let rafId: number;
    const phases = orbs.map(() => Math.random() * Math.PI * 2);
    const speeds = orbs.map((_, i) => 0.25 + i * 0.04);
    const pf = 0.03;

    function tick() {
      const now = Date.now() / 1000;
      const cx = (cursorSpringX.get() - 0.5) * pf * 100;
      const cy = (cursorSpringY.get() - 0.5) * pf * 100;

      orbs.forEach((orb, i) => {
        const fx = Math.sin(now * speeds[i] + phases[i]) * orb.floatAmplitude * 0.6;
        const fy = Math.cos(now * speeds[i] * 0.7 + phases[i]) * orb.floatAmplitude;
        orbSprings[i * 2].set(fx + cx);
        orbSprings[i * 2 + 1].set(fy + cy);
      });

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isReduced]);

  function handleMouseMove(e: React.MouseEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setCursorRatio({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  }

  const visibleOrbs = isMobile ? orbs.slice(0, 2) : orbs;

  if (isReduced) {
    return (
      <div className="hero-scene">
        {visibleOrbs.map((orb, i) => (
          <div
            key={i}
            className="hero-orb"
            style={{
              width: orb.size,
              height: orb.size,
              background: orb.gradient,
              left: `calc(50% + ${orb.initialX}%)`,
              top: `calc(50% + ${orb.initialY}%)`,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="hero-scene" onMouseMove={!isMobile ? handleMouseMove : undefined}>
      {visibleOrbs.map((orb, i) => {
        const sx = orbSprings[i * 2];
        const sy = orbSprings[i * 2 + 1];
        return (
          <motion.div
            key={i}
            className="hero-orb"
            style={{
              width: orb.size,
              height: orb.size,
              background: orb.gradient,
              left: `calc(50% + ${orb.initialX}%)`,
              top: `calc(50% + ${orb.initialY}%)`,
              x: sx,
              y: sy,
            }}
          />
        );
      })}
    </div>
  );
}
