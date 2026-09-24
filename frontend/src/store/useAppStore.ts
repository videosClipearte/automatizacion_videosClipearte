// src/store/useAppStore.ts
import { create } from 'zustand';
import {
  mockVideos, mockAccounts, mockCampaigns, mockGlobalMetrics,
  type Video, type Account, type Campaign, type GlobalMetrics
} from '@/lib/mock-data';

type CalendarView = 'month' | 'week' | 'day';

interface AppState {
  // Data
  videos: Video[];
  accounts: Account[];
  campaigns: Campaign[];
  metrics: GlobalMetrics;

  // UI State
  calendarView: CalendarView;
  selectedAccountId: string | null;
  isScheduleModalOpen: boolean;
  scheduleModalDate: Date | null;
  scheduleModalFile: File | null;
  selectedVideoId: string | null;
  isSidebarCollapsed: boolean;

  // Actions
  setCalendarView: (view: CalendarView) => void;
  setSelectedAccountId: (id: string | null) => void;
  openScheduleModal: (date?: Date, file?: File | null) => void;
  closeScheduleModal: () => void;
  setSelectedVideoId: (id: string | null) => void;
  toggleSidebar: () => void;

  // Videos CRUD
  addVideo: (video: Video) => void;
  updateVideo: (id: string, updates: Partial<Video>) => void;
  deleteVideo: (id: string) => void;

  // Accounts CRUD
  addAccount: (account: Account) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;

  // Campaigns CRUD
  addCampaign: (campaign: Campaign) => void;
  updateCampaign: (id: string, updates: Partial<Campaign>) => void;
  deleteCampaign: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  videos: mockVideos,
  accounts: mockAccounts,
  campaigns: mockCampaigns,
  metrics: mockGlobalMetrics,

  calendarView: 'month',
  selectedAccountId: null,
  isScheduleModalOpen: false,
  scheduleModalDate: null,
  scheduleModalFile: null,
  selectedVideoId: null,
  isSidebarCollapsed: false,

  setCalendarView: (view) => set({ calendarView: view }),
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  openScheduleModal: (date, file) =>
    set({
      isScheduleModalOpen: true,
      scheduleModalDate: date ?? new Date(),
      scheduleModalFile: file ?? null,
    }),
  closeScheduleModal: () =>
    set({ isScheduleModalOpen: false, scheduleModalDate: null, scheduleModalFile: null }),
  setSelectedVideoId: (id) => set({ selectedVideoId: id }),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),

  // Videos
  addVideo: (video) => set((s) => ({ videos: [...s.videos, video] })),
  updateVideo: (id, updates) =>
    set((s) => ({ videos: s.videos.map((v) => (v.id === id ? { ...v, ...updates } : v)) })),
  deleteVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

  // Accounts
  addAccount: (account) => set((s) => ({ accounts: [...s.accounts, account] })),
  updateAccount: (id, updates) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)) })),
  deleteAccount: (id) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

  // Campaigns
  addCampaign: (campaign) => set((s) => ({ campaigns: [...s.campaigns, campaign] })),
  updateCampaign: (id, updates) =>
    set((s) => ({ campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...updates } : c)) })),
  deleteCampaign: (id) => set((s) => ({ campaigns: s.campaigns.filter((c) => c.id !== id) })),
}));
