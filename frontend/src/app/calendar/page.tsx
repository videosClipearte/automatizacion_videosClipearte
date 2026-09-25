'use client';
// src/app/calendar/page.tsx
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { CalendarView } from '@/components/calendar/CalendarView';
import { useAppStore } from '@/store/useAppStore';

export default function CalendarPage() {
  const { openScheduleModal } = useAppStore();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative h-full flex flex-col"
    >
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Calendario de Publicaciones</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Gestiona y programa tu contenido en redes sociales
          </p>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1">
        <CalendarView />
      </div>

      {/* Floating action button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => openScheduleModal()}
        className="fixed bottom-5 right-5 sm:bottom-8 sm:right-8 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl btn-gradient flex items-center justify-center shadow-2xl z-40"
        style={{ boxShadow: '0 8px 32px rgba(16,185,129,0.4)' }}
      >
        <Plus size={22} strokeWidth={2.5} />
      </motion.button>
    </motion.div>
  );
}
