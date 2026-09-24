'use client';
// src/components/analytics/ChartsSection.tsx
import { GlassCard } from '@/components/ui/GlassCard';
import { useAppStore } from '@/store/useAppStore';
import { formatViews } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Area, AreaChart, Legend
} from 'recharts';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    fontSize: 11,
    color: 'var(--text-primary)',
  },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};

export function ChartsSection() {
  const { videos, accounts } = useAppStore();

  // Bar chart: videos per account
  const barData = accounts.map(a => ({
    name: `@${a.username.slice(0, 8)}`,
    Programados: videos.filter(v => v.cuenta_id === a.id && v.estado === 'PROGRAMADO').length,
    Publicados:  videos.filter(v => v.cuenta_id === a.id && v.estado === 'PUBLICADO').length,
    Enviados:    videos.filter(v => v.cuenta_id === a.id && v.estado === 'ENVIADO').length,
  }));

  // Line chart: simulated view history over 14 days
  const lineData = Array.from({ length: 14 }, (_, i) => {
    const d = subDays(new Date(), 13 - i);
    const label = format(d, 'dd MMM', { locale: es });
    const publishedThatDay = videos.filter(v =>
      v.publicado_en && format(new Date(v.publicado_en), 'yyyy-MM-dd') === format(d, 'yyyy-MM-dd')
    );
    const views = publishedThatDay.reduce((sum, v) => sum + v.vistas_obtenidas, 0)
      + Math.floor(Math.random() * 5000); // jitter for visual
    return { label, Vistas: views };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Area chart: views over time */}
      <GlassCard>
        <h3 className="text-sm font-bold text-white mb-4">Vistas en el Tiempo</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={lineData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => formatViews(v)} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => [formatViews(Number(v) || 0), 'Vistas']} />
            <Area
              type="monotone"
              dataKey="Vistas"
              stroke="url(#viewsLineGrad)"
              fill="url(#viewsGrad)"
              strokeWidth={2}
            />
            <defs>
              <linearGradient id="viewsLineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>

      {/* Bar chart: videos per account by status */}
      <GlassCard>
        <h3 className="text-sm font-bold text-white mb-4">Videos por Cuenta</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }} barSize={10} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-secondary)' }} />
            <Bar dataKey="Programados" fill="#a78bfa" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Enviados"    fill="#60a5fa" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Publicados"  fill="#34d399" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
    </div>
  );
}
