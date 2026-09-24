'use client';
// src/app/analytics/page.tsx
import { motion } from 'framer-motion';
import { AccountMetrics } from '@/components/analytics/AccountMetrics';
import { RecentCarousel } from '@/components/analytics/RecentCarousel';
import { DataGrid } from '@/components/analytics/DataGrid';
import { ChartsSection } from '@/components/analytics/ChartsSection';

export default function AnalyticsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      <div>
        <h1 className="text-xl font-bold text-white">Analítica</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Métricas, vistas y rendimiento de tus publicaciones
        </p>
      </div>

      {/* Top row: Account metrics + Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <AccountMetrics />
        </div>
        <div className="lg:col-span-2">
          <ChartsSection />
        </div>
      </div>

      {/* Recent carousel */}
      <RecentCarousel />

      {/* Full data grid */}
      <DataGrid />
    </motion.div>
  );
}
