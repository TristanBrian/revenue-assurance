import React from "react";

export default function FlowGuardHeroIllustration({
  width = "100%",
  height = "100%",
  className = "",
  title = "FlowGuard — Revenue Assurance for Kenya’s Petroleum Distribution",
}) {
  const id = React.useId();

  // Colors (enterprise palette)
  const C = {
    bg0: "#071225",
    bg1: "#0B1B33",
    navy: "#0A2A4A",
    cyan: "#2DE2FF",
    cyan2: "#4CC9FF",
    emerald: "#22C55E",
    emerald2: "#34D399",
    blue: "#2B6BFF",
    slate: "#A9B7D0",
    slate2: "#6C7C99",
    stroke: "rgba(255,255,255,0.14)",
  };

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 1200 520"
      fill="none"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <title>{title}</title>

      <defs>
        {/* Background gradient */}
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1200" y2="520">
          <stop offset="0" stopColor={C.bg0} />
          <stop offset="0.55" stopColor={C.bg1} />
          <stop offset="1" stopColor="#06101F" />
        </linearGradient>

        {/* Grid pattern */}
        <pattern id={`${id}-grid`} width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
        </pattern>

        {/* Soft glow */}
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="
              1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
              0 0 0 0.35 0"
          />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background Fill & Grid */}
      <rect width="1200" height="520" fill={`url(#${id}-bg)`} />
      <rect width="1200" height="520" fill={`url(#${id}-grid)`} />

      {/* ONLY ANIMATED ORGANIC FLOW STREAMS (No physical boxes or trucks) */}
      <g opacity="0.85">
        <style>{`
          @keyframes flow-dash {
            to { stroke-dashoffset: -60; }
          }
          .flow-line-cyan {
            stroke-dasharray: 8 16;
            animation: flow-dash 4s linear infinite;
          }
          .flow-line-emerald {
            stroke-dasharray: 6 12;
            animation: flow-dash 3.5s linear infinite;
          }
          .flow-line-blue {
            stroke-dasharray: 10 20;
            animation: flow-dash 5.5s linear infinite;
          }
        `}</style>

        {/* Pipeline 1: Cyan/Blue flow (Flows at Y=150 in the middle, running below header but above login card) */}
        <path d="M -50,230 L 380,230 C 420,230 440,150 480,150 L 770,150 C 810,150 830,230 870,230 L 1250,230" stroke="rgba(255,255,255,0.03)" strokeWidth="10" strokeLinecap="round" />
        <path d="M -50,230 L 380,230 C 420,230 440,150 480,150 L 770,150 C 810,150 830,230 870,230 L 1250,230" stroke={C.cyan} strokeWidth="2.2" strokeLinecap="round" className="flow-line-cyan" filter={`url(#${id}-glow)`} />

        {/* Pipeline 2: Emerald/Green flow (Flows at Y=370 in the middle, running below login card) */}
        <path d="M -50,290 L 380,290 C 420,290 440,370 480,370 L 770,370 C 810,370 830,290 870,290 L 1250,290" stroke="rgba(255,255,255,0.04)" strokeWidth="8" strokeLinecap="round" />
        <path d="M -50,290 L 380,290 C 420,290 440,370 480,370 L 770,370 C 810,370 830,290 870,290 L 1250,290" stroke={C.emerald} strokeWidth="1.8" strokeLinecap="round" className="flow-line-emerald" filter={`url(#${id}-glow)`} />

        {/* Pipeline 3: Bottom Dark Blue flow (Slightly adjusted downward to prevent tagline overlaps) */}
        <path d="M -50,420 L 200,420 C 240,420 260,480 300,480 L 980,480 C 1020,480 1040,360 1080,360 L 1250,360" stroke="rgba(255,255,255,0.03)" strokeWidth="6" strokeLinecap="round" />
        <path d="M -50,420 L 200,420 C 240,420 260,480 300,480 L 980,480 C 1020,480 1040,360 1080,360 L 1250,360" stroke={C.blue} strokeWidth="1.6" strokeLinecap="round" className="flow-line-blue" filter={`url(#${id}-glow)`} />



        {/* Junction points */}
        <circle cx="380" cy="230" r="3" fill="white" />
        <circle cx="380" cy="290" r="3" fill="white" />
        <circle cx="870" cy="230" r="3" fill="white" />
        <circle cx="870" cy="290" r="3" fill="white" />
        <circle cx="980" cy="480" r="3" fill="white" />
      </g>
    </svg>
  );
}
