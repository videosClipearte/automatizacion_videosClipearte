'use client';
// src/app/analytics/page.tsx
import { motion } from 'framer-motion';
import { AccountMetrics } from '@/components/analytics/AccountMetrics';
import { ChartsSection } from '@/components/analytics/ChartsSection';
import { ScraperMonitor } from '@/components/analytics/ScraperMonitor';
import { TitleDuplicateChecker } from '@/components/analytics/TitleDuplicateChecker';
import { RecentCarousel } from '@/components/analytics/RecentCarousel';
import { DataGrid } from '@/components/analytics/DataGrid';

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

      {/* Fila superior: Métricas por Cuenta (1 col) + Vistas en el Tiempo & Videos por Cuenta (2 cols) */}
      {/* Tienen exactamente la misma altura (items-stretch) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="lg:col-span-1 h-full">
          <AccountMetrics />
        </div>
        <div className="lg:col-span-2 h-full">
          <ChartsSection />
        </div>
      </div>

      {/* Monitor del Scraper ocupa TODO el ancho del contenedor de analítica */}
      <ScraperMonitor />

      {/* Verificador de títulos duplicados por cuenta */}
      <TitleDuplicateChecker />

      {/* Recent carousel */}
      <RecentCarousel />

      {/* Full data grid */}
      <DataGrid />
    </motion.div>
  );
}
