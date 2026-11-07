import { Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudSunRain, CloudLightning, Thermometer } from 'lucide-react';

// Weather line — the API string is "<emoji> 15° — Light drizzle" (the emoji is
// kept for the morning push). Here we drop the emoji and pick a Lucide icon
// from the description so it matches the rest of the dashboard.
// Shared by the dashboard header and the /document (Isola) header.

export default function WeatherLine({ text }: { text: string }) {
  const clean = (text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const icon = { size: 14, strokeWidth: 2.25, 'aria-hidden': true, style: { display: 'block', flexShrink: 0 } } as const;
  const d = clean.toLowerCase();
  return (
    <span className="inline-flex items-center gap-1.5">
      {d.includes('thunder') ? <CloudLightning {...icon} />
        : d.includes('drizzle') ? <CloudDrizzle {...icon} />
        : d.includes('shower') ? <CloudSunRain {...icon} />
        : d.includes('rain') ? <CloudRain {...icon} />
        : d.includes('fog') ? <CloudFog {...icon} />
        : d.includes('overcast') ? <Cloud {...icon} />
        : d.includes('partly') || d.includes('mainly') ? <CloudSun {...icon} />
        : d.includes('clear') ? <Sun {...icon} />
        : <Thermometer {...icon} />}
      {clean}
    </span>
  );
}
