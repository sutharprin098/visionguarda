// Themed recharts wrappers. Series colors are the validated categorical
// palette (see index.css --c1..--c4, stepped per theme); chrome uses ink/grid
// tokens so both modes render correctly. Legends always show for >=2 series;
// every chart ships a hover tooltip (dataviz method).
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useTheme } from "../contexts/ThemeContext";

export function useChartTheme() {
  const { theme } = useTheme();
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [v("--c1"), v("--c2"), v("--c3"), v("--c4")],
    grid: v("--grid"),
    ink2: v("--ink2"),
    ink3: v("--ink3"),
    surface: v("--s1"),
    line: v("--line"),
    isDark: theme === "dark",
  };
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface-1 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-ink-1">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

interface SeriesDef { key: string; name: string }

export function TimeSeries({ data, series, xKey, height = 260, kind = "area" }: {
  data: any[]; series: SeriesDef[]; xKey: string; height?: number; kind?: "area" | "line" | "bar";
}) {
  const t = useChartTheme();
  const common = (
    <>
      <CartesianGrid stroke={t.grid} vertical={false} />
      <XAxis dataKey={xKey} tick={{ fill: t.ink3, fontSize: 11 }} axisLine={{ stroke: t.line }} tickLine={false} />
      <YAxis tick={{ fill: t.ink3, fontSize: 11 }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
      <Tooltip content={<ChartTooltip />} cursor={{ stroke: t.ink3, strokeDasharray: "3 3" }} />
      {series.length >= 2 && <Legend wrapperStyle={{ fontSize: 12, color: t.ink2 }} iconType="circle" iconSize={8} />}
    </>
  );

  if (kind === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barCategoryGap="25%">
          {common}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={t.series[i % 4]}
                 radius={[4, 4, 0, 0]} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (kind === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          {common}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={t.series[i % 4]}
                  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        {common}
        {series.map((s, i) => (
          <Area key={s.key} dataKey={s.key} name={s.name} stroke={t.series[i % 4]}
                strokeWidth={2} fill={t.series[i % 4]} fillOpacity={0.12} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Tiny sparkline for KPI tiles — single series, no axes, tooltip on hover. */
export function Spark({ data, dataKey }: { data: any[]; dataKey: string }) {
  const t = useChartTheme();
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
          <Area dataKey={dataKey} stroke={t.series[0]} strokeWidth={1.5}
                fill={t.series[0]} fillOpacity={0.15} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
