import type { GeoPoint } from "../../shared/types";
import { MapPinIcon } from "./ui";

/*
 * Shared locations. The little "map" is drawn right here (no map tiles from a
 * third party), so nobody outside the chat learns who looked at the location.
 * "Open in Maps" hands the spot to the phone's or computer's maps app.
 */

export function mapsUrl(p: GeoPoint) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

function coords(p: GeoPoint) {
  const ns = p.lat >= 0 ? "N" : "S";
  const ew = p.lng >= 0 ? "E" : "W";
  return `${Math.abs(p.lat).toFixed(5)}° ${ns}, ${Math.abs(p.lng).toFixed(5)}° ${ew}`;
}

/** A stylized map with a pin; the street pattern is seeded by the spot, so each place looks a bit different. */
function MiniMap({ point }: { point: GeoPoint }) {
  const seed = Math.abs(Math.round(point.lat * 1000) * 31 + Math.round(point.lng * 1000));
  const rnd = (i: number) => ((seed * (i + 7) * 9301 + 49297) % 233280) / 233280;
  const roads = Array.from({ length: 6 }, (_, i) => {
    const horizontal = i % 2 === 0;
    const at = 10 + rnd(i) * 80;
    return horizontal ? `M0 ${at} Q 50 ${at + (rnd(i + 3) - 0.5) * 30} 100 ${at}` : `M${at} 0 Q ${at + (rnd(i + 5) - 0.5) * 30} 50 ${at} 100`;
  });
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#e8efe3] dark:bg-[#1f2a24]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        <rect x={10 + rnd(11) * 50} y={10 + rnd(12) * 40} width="22" height="16" rx="3" className="fill-[#cfe3c4] dark:fill-[#25382c]" />
        <path d={`M0 ${70 + rnd(13) * 20} Q 40 ${60 + rnd(14) * 20} 100 ${75 + rnd(15) * 15} L100 100 L0 100Z`} className="fill-[#c7dcef] dark:fill-[#1d2c3a]" />
        {roads.map((d, i) => (
          <path key={i} d={d} fill="none" strokeWidth={i < 2 ? 3.2 : 1.8} className="stroke-white dark:stroke-zinc-600" />
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
        <MapPinIcon className="size-9 fill-red-500 text-white drop-shadow-md" strokeWidth={1.5} />
      </div>
      <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/30" />
    </div>
  );
}

/** In a message bubble. */
export function LocationCard({ point, tinted }: { point: GeoPoint; tinted: boolean }) {
  return (
    <a
      href={mapsUrl(point)}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-64 max-w-full overflow-hidden rounded-[calc(var(--bubble-radius)-4px)]"
      aria-label={`Location ${coords(point)}. Open in Maps`}
    >
      <MiniMap point={point} />
      <span className="flex items-center gap-2 px-2.5 py-2">
        <MapPinIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Location</span>
          <span className={`block truncate text-xs tabular-nums ${tinted ? "opacity-80" : "text-zinc-500 dark:text-zinc-400"}`}>{coords(point)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tinted ? "bg-white/20" : "bg-accent/15 text-accent-fg"}`}>Open in Maps</span>
      </span>
    </a>
  );
}

/** In the "Share your location?" confirmation. */
export function LocationPreview({ point }: { point: GeoPoint }) {
  return (
    <span className="block overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700">
      <MiniMap point={point} />
      <span className="block px-3 py-2 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{coords(point)}</span>
    </span>
  );
}
