"use client";

import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

/** Side-view oil tanker truck — replaces 🚚 emoji */
export function TruckIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Tanker body */}
      <rect x="0" y="4" width="32" height="14" rx="7" fill="currentColor" opacity="0.85" />
      <rect x="1" y="5" width="30" height="12" rx="6" fill="currentColor" opacity="0.15" />
      {/* Tanker ribbing */}
      <line x1="8" y1="5" x2="8" y2="17" stroke="currentColor" opacity="0.2" strokeWidth="0.5" />
      <line x1="16" y1="5" x2="16" y2="17" stroke="currentColor" opacity="0.2" strokeWidth="0.5" />
      <line x1="24" y1="5" x2="24" y2="17" stroke="currentColor" opacity="0.2" strokeWidth="0.5" />
      {/* Cab */}
      <rect x="32" y="6" width="12" height="12" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="36" y="8" width="6" height="5" rx="1" fill="currentColor" opacity="0.15" />
      {/* Chassis */}
      <rect x="0" y="18" width="44" height="3" rx="1" fill="currentColor" opacity="0.5" />
      {/* Wheels */}
      <circle cx="8" cy="24" r="4" fill="currentColor" opacity="0.9" />
      <circle cx="8" cy="24" r="2" fill="currentColor" opacity="0.2" />
      <circle cx="22" cy="24" r="4" fill="currentColor" opacity="0.9" />
      <circle cx="22" cy="24" r="2" fill="currentColor" opacity="0.2" />
      <circle cx="38" cy="24" r="4" fill="currentColor" opacity="0.9" />
      <circle cx="38" cy="24" r="2" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

/** Oil barrel/drum — replaces 🛢️ emoji */
export function OilBarrelIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="12" cy="4" rx="8" ry="3" fill="currentColor" opacity="0.8" />
      <rect x="4" y="4" width="16" height="16" fill="currentColor" opacity="0.6" />
      <ellipse cx="12" cy="20" rx="8" ry="3" fill="currentColor" opacity="0.8" />
      {/* Bands */}
      <rect x="4" y="8" width="16" height="1.5" fill="currentColor" opacity="0.25" />
      <rect x="4" y="14" width="16" height="1.5" fill="currentColor" opacity="0.25" />
      {/* Highlight */}
      <ellipse cx="12" cy="4" rx="6" ry="2" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

/** Satellite/signal telemetry — replaces 📡 emoji */
export function SatelliteIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M13 3L4 14l3.5 3.5L18.5 8z" fill="currentColor" opacity="0.15" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 3l-9 11 3.5 3.5L18.5 8 13 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 17.5L3 21" />
      <path strokeLinecap="round" d="M16 16a5 5 0 000-7" opacity="0.5" />
      <path strokeLinecap="round" d="M19 19a9 9 0 000-13" opacity="0.35" />
    </svg>
  );
}

/** Security/verification shield — replaces 🛡️ emoji */
export function ShieldIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
        fill="currentColor"
        opacity="0.15"
      />
      <path
        d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Barrier gate arm — replaces gate/barrier emoji */
export function GateIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {/* Post */}
      <rect x="3" y="8" width="4" height="14" rx="1" fill="currentColor" opacity="0.6" />
      {/* Arm */}
      <rect x="5" y="8" width="16" height="3" rx="1" fill="currentColor" opacity="0.4" />
      {/* Striping */}
      <line x1="9" y1="8" x2="11" y2="11" strokeWidth="1.5" opacity="0.6" />
      <line x1="14" y1="8" x2="16" y2="11" strokeWidth="1.5" opacity="0.6" />
      <line x1="19" y1="8" x2="21" y2="11" strokeWidth="1.5" opacity="0.6" />
      {/* Pivot */}
      <circle cx="5" cy="9.5" r="2" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/** Laser scanner beam */
export function ScannerIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {/* Scanner body */}
      <rect x="2" y="10" width="20" height="4" rx="2" fill="currentColor" opacity="0.2" />
      <rect x="2" y="10" width="20" height="4" rx="2" strokeLinejoin="round" />
      {/* Beam lines */}
      <line x1="6" y1="14" x2="4" y2="20" opacity="0.6" strokeLinecap="round" />
      <line x1="12" y1="14" x2="12" y2="21" opacity="0.8" strokeLinecap="round" />
      <line x1="18" y1="14" x2="20" y2="20" opacity="0.6" strokeLinecap="round" />
      {/* Status light */}
      <circle cx="12" cy="8" r="2" fill="currentColor" opacity="0.7" />
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" opacity="0.3" strokeWidth="1" />
    </svg>
  );
}

/** Link/share icon */
export function ShareLinkIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
