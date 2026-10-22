/**
 * Small dependency-free SVG charts for the dashboard (section 28). Kept
 * intentionally simple — no charting library — so the bundle stays light
 * and every value is read directly off real report data, never mocked.
 */

const PALETTE = ['#2f6f5e', '#3f8f78', '#7fb69f', '#c9a13b', '#c2554b'];

export function MiniBarChart({ data, height = 140, valueFormatter = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '8px 4px' }}>
      {data.map((d, i) => (
        <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--color-ink-soft)', fontVariantNumeric: 'tabular-nums' }}>{valueFormatter(d.value)}</span>
          <div
            title={`${d.label}: ${valueFormatter(d.value)}`}
            style={{
              width: '100%',
              maxWidth: 44,
              height: `${Math.max(4, (d.value / max) * (height - 40))}px`,
              background: d.color || PALETTE[i % PALETTE.length],
              borderRadius: '4px 4px 0 0',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-ink-soft)', textAlign: 'center' }}>{d.label}</span>
        </div>
      ))}
      {data.length === 0 && <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>No data yet.</p>}
    </div>
  );
}

export function MiniLineChart({ points, height = 100, color = '#2f6f5e' }) {
  if (points.length === 0) {
    return <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>No data yet.</p>;
  }
  const width = 320;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => [i * stepX, height - (p.value / max) * (height - 16) - 8]);
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${path} L${coords[coords.length - 1][0]},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Trend chart">
      <path d={areaPath} fill={color} opacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 3.5 : 2} fill={color} />
      ))}
    </svg>
  );
}

export function DonutBreakdown({ segments, size = 120 }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>No data yet.</p>;
  }
  const radius = size / 2;
  const stroke = size * 0.28;
  const circumference = 2 * Math.PI * (radius - stroke / 2);
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${radius} ${radius})`}>
          {segments.map((s, i) => {
            const fraction = s.value / total;
            const dash = fraction * circumference;
            const el = (
              <circle
                key={s.label}
                cx={radius}
                cy={radius}
                r={radius - stroke / 2}
                fill="none"
                stroke={s.color || PALETTE[i % PALETTE.length]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color || PALETTE[i % PALETTE.length], display: 'inline-block' }} />
            <span>{s.label}</span>
            <span style={{ color: 'var(--color-ink-soft)' }}>({s.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
