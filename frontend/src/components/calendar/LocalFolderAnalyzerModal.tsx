'use client';
// src/components/calendar/LocalFolderAnalyzerModal.tsx
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderSearch,
  FolderOpen,
  FileVideo,
  X,
  Minus,
  Maximize2,
  RefreshCw,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Globe,
  Send,
  Play,
  Users,
  ChevronDown,
  Check,
  Eye,
  GripHorizontal,
  PanelLeft,
  PanelRight,
  Sparkles,
  AlertTriangle,
  Upload,
  Filter,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAppStore, type Video, type Account } from '@/store/useAppStore';
import { cn, formatViews } from '@/lib/utils';
import { setInternalDraggedFile } from '@/lib/dragBridge';

/* ─────────────────────────────────────────────────────────────────────────────
   Tipos y persistencia ligera en memoria + IndexedDB para recordar el handle
───────────────────────────────────────────────────────────────────────────── */
export interface LocalVideoEntry {
  id: string;
  file: File;
  fileName: string;
  cleanDisplayName: string;
  normalizedKey: string;
  relativePath: string;
  sizeBytes: number;
  lastModified: number;
}

type AnalyzerTab = 'missing' | 'published' | 'scheduled' | 'all';

const VIDEO_EXT_REGEX = /\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/i;

export function isSupportedLocalVideo(file: File): boolean {
  return Boolean(file.type?.startsWith('video/') || VIDEO_EXT_REGEX.test(file.name));
}

export function normalizeVideoFileKey(rawName: string): string {
  return (rawName || '')
    .replace(VIDEO_EXT_REGEX, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Caché en memoria durante la sesión para que cerrar/abrir el modal conserve la carpeta cargada
let cachedEntries: LocalVideoEntry[] = [];
let cachedLocationLabel: string = '';
let cachedDirHandle: any = null;
const summaryListeners = new Set<() => void>();

function notifySummaryListeners() {
  summaryListeners.forEach((fn) => fn());
}

export function useLocalFolderLoadedCount(): { totalLoaded: number; locationLabel: string } {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const listener = () => forceTick((n) => n + 1);
    summaryListeners.add(listener);
    return () => {
      summaryListeners.delete(listener);
    };
  }, []);
  return { totalLoaded: cachedEntries.length, locationLabel: cachedLocationLabel };
}

/* ─── IndexedDB para recordar el último FileSystemDirectoryHandle ─── */
const IDB_NAME = 'autopublish_device_analyzer_db';
const IDB_STORE = 'handles';
const IDB_KEY = 'last_directory_handle';

async function saveDirHandleToIdb(handle: any): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    await new Promise<void>((resolve) => {
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  } catch {
    // Ignorar en modo incógnito restringido
  }
}

async function loadDirHandleFromIdb(): Promise<any | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    return await new Promise<any | null>((resolve) => {
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
          getReq.onsuccess = () => {
            const res = getReq.result || null;
            db.close();
            resolve(res);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function scanDirectoryHandle(
  dirHandle: any,
  includeSubfolders: boolean,
  prefix = '',
  depth = 0
): Promise<LocalVideoEntry[]> {
  const results: LocalVideoEntry[] = [];
  if (!dirHandle || depth > 4) return results;

  for await (const [name, entry] of dirHandle.entries()) {
    if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') continue;
    if (entry.kind === 'file') {
      if (!VIDEO_EXT_REGEX.test(name)) continue;
      try {
        const file: File = await entry.getFile();
        if (isSupportedLocalVideo(file)) {
          const relPath = prefix ? `${prefix}/${file.name}` : file.name;
          results.push(buildEntryFromFile(file, relPath));
        }
      } catch {
        // Ignorar archivos bloqueados por el SO
      }
    } else if (entry.kind === 'directory' && includeSubfolders) {
      const subPrefix = prefix ? `${prefix}/${name}` : name;
      const subItems = await scanDirectoryHandle(entry, includeSubfolders, subPrefix, depth + 1);
      results.push(...subItems);
    }
  }
  return results;
}

async function scanDroppedWebkitEntry(
  entry: any,
  includeSubfolders: boolean,
  prefix = '',
  depth = 0
): Promise<LocalVideoEntry[]> {
  const results: LocalVideoEntry[] = [];
  if (!entry || depth > 4) return results;

  if (entry.isFile) {
    const file: File | null = await new Promise((resolve) => {
      entry.file((f: File) => resolve(f), () => resolve(null));
    });
    if (file && isSupportedLocalVideo(file)) {
      const relPath = prefix ? `${prefix}/${file.name}` : file.name;
      results.push(buildEntryFromFile(file, relPath));
    }
  } else if (entry.isDirectory && (depth === 0 || includeSubfolders)) {
    const reader = entry.createReader();
    const allChildren: any[] = [];
    while (true) {
      const batch: any[] = await new Promise((resolve) => {
        reader.readEntries((entries: any[]) => resolve(entries || []), () => resolve([]));
      });
      if (!batch.length) break;
      allChildren.push(...batch);
    }
    const nextPrefix = depth === 0 ? '' : prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of allChildren) {
      if (child.name?.startsWith('.')) continue;
      const sub = await scanDroppedWebkitEntry(child, includeSubfolders, nextPrefix, depth + 1);
      results.push(...sub);
    }
  }
  return results;
}

function buildEntryFromFile(file: File, customRelativePath?: string): LocalVideoEntry {
  const rawRel = customRelativePath || (file as any).webkitRelativePath || file.name;
  // Quitar la carpeta raíz si viene de webkitRelativePath (ej: "Videos/sub/clip.mp4" -> "sub/clip.mp4")
  const parts = rawRel.split('/').filter(Boolean);
  const relativePath = parts.length > 1 ? parts.slice(1).join('/') : file.name;
  const cleanDisplayName = file.name.replace(VIDEO_EXT_REGEX, '').replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return {
    id: `${relativePath}::${file.size}::${file.lastModified}`,
    file,
    fileName: file.name,
    cleanDisplayName: cleanDisplayName || file.name,
    normalizedKey: normalizeVideoFileKey(file.name),
    relativePath,
    sizeBytes: file.size,
    lastModified: file.lastModified,
  };
}

function getPlatformIcon(platform?: string, size = 13) {
  switch (platform?.toLowerCase()) {
    case 'instagram':
      return <Globe size={size} className="text-pink-400 shrink-0" />;
    case 'tiktok':
      return <Send size={size} className="text-cyan-400 shrink-0" />;
    case 'youtube':
      return <Play size={size} className="text-red-400 shrink-0" />;
    case 'facebook':
      return <Globe size={size} className="text-blue-400 shrink-0" />;
    default:
      return <Globe size={size} className="text-orange-400 shrink-0" />;
  }
}

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Diálogo Flotante No Intrusivo
───────────────────────────────────────────────────────────────────────────── */
function LocalFolderAnalyzerPanel() {
  const closeFolderAnalyzer = useAppStore((s) => s.closeFolderAnalyzer);
  const openScheduleModal = useAppStore((s) => s.openScheduleModal);
  const setSelectedVideoId = useAppStore((s) => s.setSelectedVideoId);
  const videos = useAppStore((s) => s.videos);
  const accounts = useAppStore((s) => s.accounts);
  const selectedAccountId = useAppStore((s) => s.selectedAccountId);
  const setSelectedAccountId = useAppStore((s) => s.setSelectedAccountId);
  const selectedPlatform = useAppStore((s) => s.selectedPlatform);
  const setSelectedPlatform = useAppStore((s) => s.setSelectedPlatform);

  const [entries, setEntries] = useState<LocalVideoEntry[]>(() => cachedEntries);
  const [locationLabel, setLocationLabel] = useState<string>(() => cachedLocationLabel);
  const [hasActiveHandle, setHasActiveHandle] = useState<boolean>(() => Boolean(cachedDirHandle));
  const [savedHandleInfo, setSavedHandleInfo] = useState<{ name: string; handle: any } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);

  // Filtros internos de vista: por defecto muestra los que FALTAN POR PUBLICAR
  // y ofrece filtro opcional para mostrar los YA PUBLICADOS (y agendados)
  const [showPublishedOptional, setShowPublishedOptional] = useState(false);
  const [activeTab, setActiveTab] = useState<AnalyzerTab>('missing');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'size'>('name');

  // Estado de ventana flotante no intrusiva (minimizar, acoplar izq/der o arrastrar libremente)
  const [isMinimized, setIsMinimized] = useState(false);
  const [dockSide, setDockSide] = useState<'right' | 'left'>('right');
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isMovingWindowRef = useRef(false);
  const moveStartRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number }>({
    pointerX: 0,
    pointerY: 0,
    startX: 0,
    startY: 0,
  });

  // Selector desplegable de cuenta dentro del panel (sincronizado con el calendario)
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  // Previsualización ligera de video local
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Dropzone local del analizador
  const [isDropHover, setIsDropHover] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // Cargar handle recordado en IndexedDB si aún no hay archivos cargados
  useEffect(() => {
    let mounted = true;
    loadDirHandleFromIdb().then((handle) => {
      if (mounted && handle && handle.name) {
        setSavedHandleInfo({ name: handle.name, handle });
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Cerrar dropdown de cuentas al hacer clic fuera
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Limpiar URL de previsualización para evitar fugas de memoria
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleTogglePreview = useCallback(
    (entry: LocalVideoEntry) => {
      if (previewEntryId === entry.id) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewEntryId(null);
        setPreviewUrl(null);
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(entry.file);
      setPreviewEntryId(entry.id);
      setPreviewUrl(url);
    },
    [previewEntryId, previewUrl]
  );

  const commitScannedEntries = useCallback((newEntries: LocalVideoEntry[], label: string, dirHandle: any = null) => {
    // Deduplicar por clave de archivo relativa
    const uniqueMap = new Map<string, LocalVideoEntry>();
    for (const item of newEntries) {
      if (!uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }
    const finalItems = Array.from(uniqueMap.values());
    cachedEntries = finalItems;
    cachedLocationLabel = label;
    cachedDirHandle = dirHandle;
    setEntries(finalItems);
    setLocationLabel(label);
    setHasActiveHandle(Boolean(dirHandle));
    notifySummaryListeners();
  }, []);

  // 1. Seleccionar carpeta nativa con File System Access API (o fallback webkitdirectory)
  const handlePickFolder = useCallback(async () => {
    setScanError(null);
    if (typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function') {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        setIsScanning(true);
        const scanned = await scanDirectoryHandle(dirHandle, includeSubfolders);
        commitScannedEntries(scanned, dirHandle.name || 'Carpeta seleccionada', dirHandle);
        setSavedHandleInfo({ name: dirHandle.name, handle: dirHandle });
        await saveDirHandleToIdb(dirHandle);
        if (scanned.length === 0) {
          setScanError('No se encontraron archivos de video (.mp4, .mov, .webm, .mkv) en esta ubicación.');
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // Fallback al input tradicional de carpeta si el navegador bloqueó showDirectoryPicker
          folderInputRef.current?.click();
        }
      } finally {
        setIsScanning(false);
      }
    } else {
      folderInputRef.current?.click();
    }
  }, [includeSubfolders, commitScannedEntries]);

  // Reabrir última carpeta guardada o re-escanear carpeta activa
  const handleRescanActiveOrSaved = useCallback(
    async (targetHandle?: any) => {
      const handle = targetHandle || cachedDirHandle || savedHandleInfo?.handle;
      if (!handle) {
        handlePickFolder();
        return;
      }
      setScanError(null);
      setIsScanning(true);
      try {
        if (typeof handle.queryPermission === 'function') {
          let perm = await handle.queryPermission({ mode: 'read' });
          if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
            perm = await handle.requestPermission({ mode: 'read' });
          }
          if (perm !== 'granted') {
            setScanError('Permiso de lectura denegado por el navegador. Vuelve a elegir la carpeta.');
            setIsScanning(false);
            return;
          }
        }
        const scanned = await scanDirectoryHandle(handle, includeSubfolders);
        commitScannedEntries(scanned, handle.name || 'Carpeta local', handle);
        if (scanned.length === 0) {
          setScanError('No se encontraron archivos de video en esta carpeta.');
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setScanError('No se pudo leer la carpeta. Selecciónala nuevamente.');
        }
      } finally {
        setIsScanning(false);
      }
    },
    [savedHandleInfo, includeSubfolders, commitScannedEntries, handlePickFolder]
  );

  // Fallback input webkitdirectory
  const handleFolderInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setScanError(null);
      setIsScanning(true);

      const videoFiles: LocalVideoEntry[] = [];
      let detectedFolderName = 'Carpeta del dispositivo';

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const rel = (f as any).webkitRelativePath || '';
        if (rel && detectedFolderName === 'Carpeta del dispositivo') {
          const firstSeg = rel.split('/')[0];
          if (firstSeg) detectedFolderName = firstSeg;
        }
        // Si includeSubfolders está desactivado, aceptar solo profundidad <= 2 ("Carpeta/video.mp4")
        if (!includeSubfolders && rel && rel.split('/').length > 2) {
          continue;
        }
        if (isSupportedLocalVideo(f)) {
          videoFiles.push(buildEntryFromFile(f));
        }
      }

      commitScannedEntries(videoFiles, detectedFolderName, null);
      if (videoFiles.length === 0) {
        setScanError('No se detectaron videos compatibles en la carpeta seleccionada.');
      }
      setIsScanning(false);
      e.target.value = '';
    },
    [includeSubfolders, commitScannedEntries]
  );

  // Input de archivos de video individuales o múltiples
  const handleFilesInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      setScanError(null);

      const videoFiles: LocalVideoEntry[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        if (isSupportedLocalVideo(f)) {
          videoFiles.push(buildEntryFromFile(f, f.name));
        }
      }

      const label =
        videoFiles.length === 1
          ? videoFiles[0].fileName
          : `${videoFiles.length} archivos seleccionados`;
      commitScannedEntries(videoFiles, label, null);
      if (videoFiles.length === 0) {
        setScanError('Ninguno de los archivos seleccionados es un video compatible.');
      }
      e.target.value = '';
    },
    [commitScannedEntries]
  );

  // Soltar carpeta o archivos directamente dentro del analizador
  const handleAnalyzerDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDropHover(false);
      setScanError(null);

      const dt = e.dataTransfer;
      if (!dt) return;

      setIsScanning(true);
      try {
        const collected: LocalVideoEntry[] = [];
        let label = 'Archivos arrastrados';

        if (dt.items && dt.items.length > 0 && typeof (dt.items[0] as any).webkitGetAsEntry === 'function') {
          const webkitEntries: any[] = [];
          for (let i = 0; i < dt.items.length; i++) {
            const entry = (dt.items[i] as any).webkitGetAsEntry();
            if (entry) webkitEntries.push(entry);
          }
          if (webkitEntries.length === 1 && webkitEntries[0].isDirectory) {
            label = webkitEntries[0].name;
          }
          for (const entry of webkitEntries) {
            const sub = await scanDroppedWebkitEntry(entry, includeSubfolders);
            collected.push(...sub);
          }
        } else if (dt.files && dt.files.length > 0) {
          for (let i = 0; i < dt.files.length; i++) {
            const f = dt.files[i];
            if (isSupportedLocalVideo(f)) {
              collected.push(buildEntryFromFile(f, f.name));
            }
          }
          if (collected.length === 1) label = collected[0].fileName;
          else label = `${collected.length} videos seleccionados`;
        }

        if (collected.length > 0) {
          commitScannedEntries(collected, label, null);
        } else {
          setScanError('No se encontraron videos en los elementos soltados.');
        }
      } finally {
        setIsScanning(false);
      }
    },
    [includeSubfolders, commitScannedEntries]
  );

  const handleClearLoaded = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewEntryId(null);
    setPreviewUrl(null);
    commitScannedEntries([], '', null);
    setScanError(null);
  }, [previewUrl, commitScannedEntries]);

  // Movimiento libre de la ventana flotante mediante Pointer Events (sin interferir con HTML5 Drag & Drop)
  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isMovingWindowRef.current = true;
    moveStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: dragOffset.x,
      startY: dragOffset.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (!isMovingWindowRef.current) return;
    const dx = e.clientX - moveStartRef.current.pointerX;
    const dy = e.clientY - moveStartRef.current.pointerY;
    const maxShiftX = typeof window !== 'undefined' ? window.innerWidth - 120 : 800;
    const maxShiftY = typeof window !== 'undefined' ? window.innerHeight - 100 : 600;
    setDragOffset({
      x: Math.max(-maxShiftX, Math.min(maxShiftX, moveStartRef.current.startX + dx)),
      y: Math.max(-60, Math.min(maxShiftY, moveStartRef.current.startY + dy)),
    });
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    if (!isMovingWindowRef.current) return;
    isMovingWindowRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // Resolver cuenta activa y cuentas visibles por filtro de red social
  const selectedAccount = useMemo(() => {
    if (!selectedAccountId || selectedAccountId === 'ALL') return null;
    return (
      accounts.find((a) => a.id === selectedAccountId) ||
      accounts.find(
        (a) =>
          a.username.toLowerCase().trim() === selectedAccountId.toLowerCase().trim().replace(/^@/, '')
      ) ||
      null
    );
  }, [accounts, selectedAccountId]);

  const displayedAccountsForSelector = useMemo(() => {
    if (!selectedPlatform || selectedPlatform === 'ALL') return accounts;
    return accounts.filter((a) => a.plataforma?.toLowerCase() === selectedPlatform.toLowerCase());
  }, [accounts, selectedPlatform]);

  // ── Cruce en tiempo real entre archivos del dispositivo y publicaciones filtradas por cuenta / red social ──
  const analysisResult = useMemo(() => {
    const accountMap = new Map<string, Account>(accounts.map((a) => [a.id, a]));

    // 1. Filtrar las publicaciones activas exactamente según la cuenta o red social seleccionada
    const scopedMap = new Map<string, { video: Video; account?: Account }[]>();

    for (const v of videos) {
      if (v.estado === 'CANCELADO') continue;

      const videoAcc =
        accountMap.get(v.cuenta_id) ||
        accounts.find(
          (a) =>
            a.id === v.cuenta_id ||
            a.username.toLowerCase().trim() === (v.cuenta_id || '').toLowerCase().trim().replace(/^@/, '')
        );

      // Filtro estricto por cuenta específica
      if (selectedAccount) {
        const cleanVidCuenta = (v.cuenta_id || '').trim().replace(/^@/, '').toLowerCase();
        const cleanTargetUser = selectedAccount.username.trim().replace(/^@/, '').toLowerCase();
        const matchesAccount =
          v.cuenta_id === selectedAccount.id ||
          cleanVidCuenta === cleanTargetUser ||
          (videoAcc && videoAcc.id === selectedAccount.id);
        if (!matchesAccount) continue;
      }

      // Filtro estricto por tipo de red social
      if (selectedPlatform && selectedPlatform !== 'ALL') {
        const videoPlat =
          videoAcc?.plataforma?.toLowerCase() ||
          (selectedAccount ? selectedAccount.plataforma?.toLowerCase() : undefined);
        if (videoPlat !== selectedPlatform.toLowerCase()) continue;
      }

      // Invariante de oro: usar siempre nombre_archivo (identificador interno del archivo), nunca el título de Short si difiere
      const canonicalFileRef = v.nombre_archivo || v.titulo;
      const key = normalizeVideoFileKey(canonicalFileRef);
      if (!key) continue;

      let list = scopedMap.get(key);
      if (!list) {
        list = [];
        scopedMap.set(key, list);
      }
      list.push({ video: v, account: videoAcc });
    }

    // 2. Clasificar cada archivo de la ubicación local
    const missingList: {
      entry: LocalVideoEntry;
      category: 'missing';
      matches: { video: Video; account?: Account }[];
      hadNetworkError: boolean;
    }[] = [];

    const publishedList: {
      entry: LocalVideoEntry;
      category: 'published';
      matches: { video: Video; account?: Account }[];
      primaryMatch: { video: Video; account?: Account };
    }[] = [];

    const scheduledList: {
      entry: LocalVideoEntry;
      category: 'scheduled';
      matches: { video: Video; account?: Account }[];
      primaryMatch: { video: Video; account?: Account };
    }[] = [];

    for (const entry of entries) {
      const matches = scopedMap.get(entry.normalizedKey) || [];
      const publishedMatch = matches.find((m) => m.video.estado === 'PUBLICADO');
      const scheduledMatch = matches.find(
        (m) =>
          m.video.estado === 'PROGRAMADO' ||
          m.video.estado === 'ENVIADO' ||
          m.video.estado === 'VERIFICACION_PENDIENTE'
      );

      if (publishedMatch) {
        publishedList.push({
          entry,
          category: 'published',
          matches,
          primaryMatch: publishedMatch,
        });
      } else if (scheduledMatch) {
        scheduledList.push({
          entry,
          category: 'scheduled',
          matches,
          primaryMatch: scheduledMatch,
        });
      } else {
        const hadNetworkError = matches.some((m) => m.video.estado === 'ERROR_DE_RED');
        missingList.push({
          entry,
          category: 'missing',
          matches,
          hadNetworkError,
        });
      }
    }

    return {
      missingList,
      publishedList,
      scheduledList,
      counts: {
        total: entries.length,
        missing: missingList.length,
        published: publishedList.length,
        scheduled: scheduledList.length,
      },
    };
  }, [entries, videos, accounts, selectedAccount, selectedPlatform]);

  // Lista filtrada por búsqueda, pestaña/filtro opcional de publicados y orden
  const visibleItems = useMemo(() => {
    let base: Array<{
      entry: LocalVideoEntry;
      category: 'missing' | 'published' | 'scheduled';
      matches: { video: Video; account?: Account }[];
      primaryMatch?: { video: Video; account?: Account };
      hadNetworkError?: boolean;
    }> = [];

    if (activeTab === 'missing') {
      base = [...analysisResult.missingList];
      if (showPublishedOptional) {
        base.push(...analysisResult.publishedList);
      }
    } else if (activeTab === 'published') {
      base = [...analysisResult.publishedList];
    } else if (activeTab === 'scheduled') {
      base = [...analysisResult.scheduledList];
    } else {
      base = [
        ...analysisResult.missingList,
        ...analysisResult.scheduledList,
        ...analysisResult.publishedList,
      ];
    }

    const q = normalizeVideoFileKey(searchQuery);
    if (q) {
      base = base.filter(
        (item) =>
          item.entry.normalizedKey.includes(q) ||
          item.entry.relativePath.toLowerCase().includes(searchQuery.trim().toLowerCase())
      );
    }

    base.sort((a, b) => {
      // Si en vista combinada está activo el filtro opcional de publicados, poner primero los que faltan por publicar
      if (activeTab === 'missing' && showPublishedOptional && a.category !== b.category) {
        return a.category === 'missing' ? -1 : 1;
      }
      if (sortBy === 'recent') return b.entry.lastModified - a.entry.lastModified;
      if (sortBy === 'size') return b.entry.sizeBytes - a.entry.sizeBytes;
      return a.entry.cleanDisplayName.localeCompare(b.entry.cleanDisplayName, 'es', { numeric: true });
    });

    return base;
  }, [analysisResult, activeTab, showPublishedOptional, searchQuery, sortBy]);

  const filterContextLabel = useMemo(() => {
    if (selectedAccount) {
      return `@${selectedAccount.username} (${selectedAccount.plataforma})`;
    }
    if (selectedPlatform && selectedPlatform !== 'ALL') {
      return `Red: ${selectedPlatform.charAt(0).toUpperCase() + selectedPlatform.slice(1)}`;
    }
    return 'Todas las cuentas y redes';
  }, [selectedAccount, selectedPlatform]);

  /* ─── Vista Minimizada (Píldora flotante que deja el 100% del calendario libre) ─── */
  if (isMinimized) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.95 }}
        className={cn(
          'fixed bottom-4 z-40 pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-2xl glass-strong border border-orange-500/40 shadow-2xl bg-[#161414]/95 backdrop-blur-xl',
          dockSide === 'right' ? 'right-4' : 'left-4 md:left-24'
        )}
      >
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2.5 text-left cursor-pointer group"
          title="Restaurar analizador de videos locales"
        >
          <div className="w-7 h-7 rounded-xl bg-orange-500/20 border border-orange-500/35 flex items-center justify-center text-orange-400">
            <FolderSearch size={15} />
          </div>
          <div>
            <p className="text-xs font-bold text-white group-hover:text-orange-300 transition-colors flex items-center gap-1.5">
              <span>{locationLabel || 'Analizador de Carpeta'}</span>
              {entries.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-orange-500/25 border border-orange-500/40 text-[10px] text-orange-300 font-mono">
                  {analysisResult.counts.missing} por publicar
                </span>
              )}
            </p>
            <p className="text-[10px] text-zinc-400 truncate max-w-[200px]">
              Filtro: {filterContextLabel}
            </p>
          </div>
          <Maximize2 size={13} className="text-zinc-400 group-hover:text-white ml-1" />
        </button>
        <button
          type="button"
          onClick={closeFolderAnalyzer}
          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Cerrar herramienta"
        >
          <X size={13} />
        </button>
      </motion.div>
    );
  }

  /* ─── Ventana Flotante Completa (Sin backdrop bloqueante: el calendario sigue 100% interactivo) ─── */
  return (
    <motion.aside
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      style={{
        transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
      }}
      onDragOver={(e) => {
        // Evitar que soltar sobre el propio panel dispare el drop global del calendario
        e.preventDefault();
        e.stopPropagation();
        if (!isDropHover) setIsDropHover(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) return;
        setIsDropHover(false);
      }}
      onDrop={handleAnalyzerDrop}
      aria-label="Analizador de videos del dispositivo"
      className={cn(
        'fixed top-18 z-40 pointer-events-auto w-[390px] sm:w-[415px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5.5rem)] flex flex-col rounded-2xl glass-strong border shadow-2xl bg-[#151313]/95 backdrop-blur-xl overflow-hidden',
        isDropHover ? 'border-orange-400 ring-2 ring-orange-500/40' : 'border-white/15',
        dockSide === 'right' ? 'right-3 sm:right-5' : 'left-3 sm:left-5 md:left-22'
      )}
    >
      {/* Inputs ocultos para selección nativa en cualquier SO / navegador */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error atributo estándar de facto para selección de directorios en navegadores
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={handleFolderInputChange}
      />
      <input
        ref={filesInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v"
        multiple
        className="hidden"
        onChange={handleFilesInputChange}
      />

      {/* ── Cabecera arrastrable (No bloquea el calendario de fondo) ── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-white/10 bg-gradient-to-r from-orange-500/12 via-transparent to-transparent cursor-grab active:cursor-grabbing select-none shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-orange-500/20 border border-orange-500/35 flex items-center justify-center text-orange-400 shrink-0">
            <FolderSearch size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-white truncate">Analizador de Videos Locales</h3>
              <GripHorizontal size={12} className="text-zinc-500 shrink-0" />
            </div>
            <p className="text-[10px] text-zinc-400 truncate">
              Arrastra al calendario o pulsa Programar sin cerrar esta vista
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setDockSide((s) => (s === 'right' ? 'left' : 'right'));
              setDragOffset({ x: 0, y: 0 });
            }}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title={dockSide === 'right' ? 'Acoplar a la izquierda' : 'Acoplar a la derecha'}
          >
            {dockSide === 'right' ? <PanelLeft size={13} /> : <PanelRight size={13} />}
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Minimizar en esquina para despejar el calendario"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            onClick={closeFolderAnalyzer}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-300 hover:bg-red-500/15 transition-colors cursor-pointer"
            title="Cerrar herramienta"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Barra de Filtro por Red Social y Cuenta (Sincronizada en vivo con el Calendario) ── */}
      <div className="px-3.5 py-2.5 border-b border-white/10 bg-black/25 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400/90 flex items-center gap-1">
            <Filter size={10} />
            Filtrado por Cuenta / Red Social
          </span>
          {(selectedAccountId || selectedPlatform) && (
            <button
              type="button"
              onClick={() => {
                setSelectedAccountId(null);
                setSelectedPlatform(null);
              }}
              className="text-[10px] text-zinc-400 hover:text-white underline cursor-pointer"
            >
              Ver todas
            </button>
          )}
        </div>

        {/* Chips rápidos de Tipo de Red Social */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
          <button
            type="button"
            onClick={() => {
              setSelectedPlatform(null);
              setSelectedAccountId(null);
            }}
            className={cn(
              'px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all shrink-0 cursor-pointer',
              !selectedPlatform && !selectedAccountId
                ? 'bg-orange-500/20 border-orange-500/40 text-white'
                : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
            )}
          >
            Todas
          </button>
          {PLATFORMS.map((plat) => {
            const active =
              (selectedPlatform?.toLowerCase() === plat.id && !selectedAccount) ||
              selectedAccount?.plataforma?.toLowerCase() === plat.id;
            return (
              <button
                key={plat.id}
                type="button"
                onClick={() => {
                  if (selectedPlatform?.toLowerCase() === plat.id && !selectedAccountId) {
                    setSelectedPlatform(null);
                  } else {
                    setSelectedPlatform(plat.id);
                    setSelectedAccountId(null);
                  }
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all shrink-0 cursor-pointer',
                  active
                    ? 'bg-orange-500/20 border-orange-500/40 text-white'
                    : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                )}
              >
                {getPlatformIcon(plat.id, 11)}
                <span>{plat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Selector de Cuenta Específica */}
        <div className="relative" ref={accountDropdownRef}>
          <button
            type="button"
            onClick={() => setIsAccountDropdownOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 text-xs text-white transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedAccount ? (
                <>
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: selectedAccount.avatar_color || '#f97316' }}
                  >
                    {selectedAccount.username.slice(0, 1).toUpperCase()}
                  </div>
                  {getPlatformIcon(selectedAccount.plataforma, 12)}
                  <span className="font-semibold truncate">@{selectedAccount.username}</span>
                </>
              ) : selectedPlatform ? (
                <>
                  {getPlatformIcon(selectedPlatform, 12)}
                  <span className="font-medium text-zinc-200 truncate capitalize">
                    Todas las cuentas de {selectedPlatform} ({displayedAccountsForSelector.length})
                  </span>
                </>
              ) : (
                <>
                  <Users size={13} className="text-orange-400 shrink-0" />
                  <span className="font-medium text-zinc-200 truncate">
                    Todas las cuentas registradas ({accounts.length})
                  </span>
                </>
              )}
            </div>
            <ChevronDown
              size={13}
              className={cn('text-zinc-400 transition-transform shrink-0', isAccountDropdownOpen && 'rotate-180')}
            />
          </button>

          <AnimatePresence>
            {isAccountDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-xl glass-strong border border-white/15 bg-[#191616] p-1 shadow-2xl z-50 space-y-0.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAccountId(null);
                    setIsAccountDropdownOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer',
                    !selectedAccount
                      ? 'bg-orange-500/20 text-white font-semibold'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <span>
                    {selectedPlatform
                      ? `Todas las cuentas de ${selectedPlatform}`
                      : 'Todas las cuentas'}
                  </span>
                  {!selectedAccount && <Check size={13} className="text-orange-400" />}
                </button>

                {displayedAccountsForSelector.map((acc) => {
                  const isSel = selectedAccount?.id === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        setSelectedAccountId(acc.id);
                        setSelectedPlatform(null);
                        setIsAccountDropdownOpen(false);
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer',
                        isSel
                          ? 'bg-orange-500/20 text-white font-semibold'
                          : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                          style={{ backgroundColor: acc.avatar_color || '#f97316' }}
                        >
                          {acc.username.slice(0, 1).toUpperCase()}
                        </div>
                        {getPlatformIcon(acc.plataforma, 11)}
                        <span className="truncate">@{acc.username}</span>
                      </div>
                      {isSel && <Check size={13} className="text-orange-400 shrink-0" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Selector de Ubicación del Dispositivo / Carpeta / Archivos ── */}
      <div className="px-3.5 py-2.5 border-b border-white/10 space-y-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={isScanning}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl btn-gradient text-xs font-bold text-white shadow-md hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
          >
            <FolderOpen size={14} />
            <span>{entries.length > 0 ? 'Cambiar carpeta' : 'Elegir carpeta del dispositivo'}</span>
          </button>

          <button
            type="button"
            onClick={() => filesInputRef.current?.click()}
            disabled={isScanning}
            className="px-2.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-semibold text-zinc-200 hover:text-white transition-all cursor-pointer flex items-center gap-1 shrink-0"
            title="Seleccionar uno o varios archivos de video sueltos"
          >
            <FileVideo size={13} className="text-orange-400" />
            <span>Archivos</span>
          </button>

          {hasActiveHandle && (
            <button
              type="button"
              onClick={() => handleRescanActiveOrSaved()}
              disabled={isScanning}
              className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 hover:text-white transition-all cursor-pointer shrink-0"
              title="Re-escanear carpeta actual para detectar videos nuevos"
            >
              <RefreshCw size={13} className={cn(isScanning && 'animate-spin text-orange-400')} />
            </button>
          )}

          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleClearLoaded}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-red-500/15 border border-white/10 hover:border-red-500/30 text-zinc-400 hover:text-red-300 transition-all cursor-pointer shrink-0"
              title="Limpiar lista cargada"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Subcarpetas + acceso rápido a la última carpeta recordada */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <label className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => setIncludeSubfolders(e.target.checked)}
              className="rounded border-white/20 bg-black/40 text-orange-500 focus:ring-orange-500/40"
            />
            <span>Incluir subcarpetas</span>
          </label>

          {entries.length === 0 && savedHandleInfo && (
            <button
              type="button"
              onClick={() => handleRescanActiveOrSaved(savedHandleInfo.handle)}
              className="text-[11px] font-semibold text-orange-400 hover:text-orange-300 flex items-center gap-1 truncate max-w-[200px] cursor-pointer"
              title={`Reabrir última carpeta: ${savedHandleInfo.name}`}
            >
              <Sparkles size={11} className="shrink-0" />
              <span className="truncate">Reabrir &ldquo;{savedHandleInfo.name}&rdquo;</span>
            </button>
          )}

          {entries.length > 0 && locationLabel && (
            <span className="text-[10px] text-zinc-400 truncate max-w-[195px]" title={locationLabel}>
              📂 <strong className="text-zinc-200">{locationLabel}</strong> ({entries.length})
            </span>
          )}
        </div>

        {scanError && (
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
            <span>{scanError}</span>
          </div>
        )}
      </div>

      {/* ── Cuerpo Principal: Estado vacío vs Resultados Analizados ── */}
      {entries.length === 0 ? (
        <div className="p-5 flex-1 flex flex-col items-center justify-center text-center">
          <div
            onClick={handlePickFolder}
            className={cn(
              'w-full p-5 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-2',
              isDropHover
                ? 'border-orange-400 bg-orange-500/15'
                : 'border-white/15 bg-white/[0.02] hover:border-orange-500/40 hover:bg-white/[0.04]'
            )}
          >
            <div className="w-11 h-11 rounded-2xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <Upload size={20} />
            </div>
            <p className="text-xs font-bold text-white">
              Selecciona o arrastra aquí una carpeta de tu dispositivo
            </p>
            <p className="text-[11px] text-zinc-400 leading-relaxed max-w-[290px]">
              Analizaremos al instante qué videos <strong className="text-orange-300">faltan por publicar</strong> y cuáles{' '}
              <strong className="text-emerald-300">ya fueron publicados</strong> en{' '}
              <span className="text-white font-medium">{filterContextLabel}</span>.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ── Resumen y Filtro Opcional de Ya Publicados ── */}
          <div className="px-3.5 py-2.5 border-b border-white/10 bg-white/[0.015] space-y-2 shrink-0">
            {/* Pestañas de clasificación */}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('missing')}
                className={cn(
                  'px-2 py-1.5 rounded-xl border text-left transition-all cursor-pointer',
                  activeTab === 'missing'
                    ? 'bg-orange-500/20 border-orange-500/45 text-white shadow-sm'
                    : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                )}
              >
                <p className="text-[9px] uppercase font-bold tracking-wider text-orange-300">Por publicar</p>
                <p className="text-sm font-extrabold font-mono text-white">{analysisResult.counts.missing}</p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('published')}
                className={cn(
                  'px-2 py-1.5 rounded-xl border text-left transition-all cursor-pointer',
                  activeTab === 'published'
                    ? 'bg-emerald-500/20 border-emerald-500/45 text-white shadow-sm'
                    : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                )}
              >
                <p className="text-[9px] uppercase font-bold tracking-wider text-emerald-300">Ya publicados</p>
                <p className="text-sm font-extrabold font-mono text-white">{analysisResult.counts.published}</p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('scheduled')}
                className={cn(
                  'px-2 py-1.5 rounded-xl border text-left transition-all cursor-pointer',
                  activeTab === 'scheduled'
                    ? 'bg-purple-500/20 border-purple-500/45 text-white shadow-sm'
                    : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
                )}
              >
                <p className="text-[9px] uppercase font-bold tracking-wider text-purple-300">En calendario</p>
                <p className="text-sm font-extrabold font-mono text-white">{analysisResult.counts.scheduled}</p>
              </button>
            </div>

            {/* Filtro opcional directo para incluir/ocultar los videos ya publicados sin salir de "Por publicar" */}
            {activeTab === 'missing' && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showPublishedOptional}
                    onChange={(e) => setShowPublishedOptional(e.target.checked)}
                    className="rounded border-white/20 bg-black/40 text-emerald-500 focus:ring-emerald-500/40"
                  />
                  <span>Mostrar también videos ya publicados ({analysisResult.counts.published})</span>
                </label>
              </div>
            )}

            {/* Buscador + Orden */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar archivo de video..."
                  className="w-full pl-7 pr-6 py-1.5 rounded-xl bg-black/35 border border-white/10 focus:border-orange-500/50 focus:outline-none text-xs text-white placeholder:text-zinc-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Ordenar archivos"
                className="px-2 py-1.5 rounded-xl bg-black/35 border border-white/10 text-[11px] text-zinc-300 focus:outline-none focus:border-orange-500/50 cursor-pointer"
              >
                <option value="name">Nombre A-Z</option>
                <option value="recent">Más recientes</option>
                <option value="size">Tamaño</option>
              </select>
            </div>
          </div>

          {/* ── Lista de Videos Analizados ── */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[180px]">
            {visibleItems.length === 0 ? (
              <div className="py-8 px-4 text-center space-y-1.5">
                <CheckCircle2 size={24} className="mx-auto text-emerald-400/80" />
                <p className="text-xs font-semibold text-white">
                  {searchQuery
                    ? 'No hay archivos que coincidan con tu búsqueda'
                    : activeTab === 'missing'
                    ? '¡Todos los videos de esta carpeta ya están publicados o programados!'
                    : activeTab === 'published'
                    ? 'Aún no hay videos publicados de esta carpeta para este filtro'
                    : 'No hay videos programados en espera de esta carpeta'}
                </p>
                <p className="text-[11px] text-zinc-400">
                   Contexto actual: <span className="text-zinc-200">{filterContextLabel}</span>
                </p>
              </div>
            ) : (
              visibleItems.map((item) => {
                const { entry, category, primaryMatch, hadNetworkError } = item;
                const isPreviewing = previewEntryId === entry.id;

                return (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={(e) => {
                      setInternalDraggedFile(entry.file);
                      e.dataTransfer.effectAllowed = 'copy';
                      try {
                        e.dataTransfer.setData('text/plain', entry.fileName);
                      } catch {}
                    }}
                    onDragEnd={() => {
                      setInternalDraggedFile(null);
                    }}
                    className={cn(
                      'p-2.5 rounded-xl border transition-all group select-none cursor-grab active:cursor-grabbing',
                      category === 'missing'
                        ? 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 hover:border-orange-500/40'
                        : category === 'published'
                        ? 'bg-emerald-950/20 hover:bg-emerald-950/30 border-emerald-500/25'
                        : 'bg-purple-950/20 hover:bg-purple-950/30 border-purple-500/25'
                    )}
                    title="Puedes arrastrar este video directamente a un día del calendario"
                  >
                    <div className="flex items-start justify-between gap-2">
                      {/* Botón de vista previa + Metadatos del archivo */}
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => handleTogglePreview(entry)}
                          className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors cursor-pointer mt-0.5',
                            isPreviewing
                              ? 'bg-orange-500/30 border-orange-400 text-white'
                              : category === 'published'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                              : category === 'scheduled'
                              ? 'bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25'
                              : 'bg-orange-500/15 border-orange-500/30 text-orange-300 hover:bg-orange-500/25'
                          )}
                          title={isPreviewing ? 'Ocultar vista previa' : 'Previsualizar video local'}
                        >
                          <Play size={13} className={cn(isPreviewing && 'fill-current')} />
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate" title={entry.relativePath}>
                            {entry.cleanDisplayName}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10px] text-zinc-400">
                            <span className="font-mono">{formatFileSize(entry.sizeBytes)}</span>
                            {entry.relativePath.includes('/') && (
                              <span className="truncate max-w-[130px] text-zinc-500" title={entry.relativePath}>
                                · {entry.relativePath.split('/').slice(0, -1).join('/')}
                              </span>
                            )}
                            {category === 'missing' && (
                              <span className="px-1.5 py-0.5 rounded bg-orange-500/15 border border-orange-500/30 text-orange-300 font-semibold">
                                Falta publicar
                              </span>
                            )}
                            {hadNetworkError && (
                              <span className="px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-300 font-semibold">
                                Falló antes
                              </span>
                            )}
                          </div>

                          {/* Detalle si ya fue publicado o agendado */}
                          {category === 'published' && primaryMatch && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-emerald-300">
                              <CheckCircle2 size={11} className="shrink-0" />
                              <span>Publicado</span>
                              {primaryMatch.account && (
                                <span className="inline-flex items-center gap-1 text-zinc-200 font-medium">
                                  {getPlatformIcon(primaryMatch.account.plataforma, 10)}
                                  @{primaryMatch.account.username}
                                </span>
                              )}
                              <span>
                                · {format(new Date(primaryMatch.video.publicado_en || primaryMatch.video.programado_para), 'd MMM', { locale: es })}
                              </span>
                              {(primaryMatch.video.vistas_obtenidas > 0) && (
                                <span className="inline-flex items-center gap-0.5 text-orange-300 font-mono">
                                  <Eye size={10} />
                                  {formatViews(primaryMatch.video.vistas_obtenidas)}
                                </span>
                              )}
                            </div>
                          )}

                          {category === 'scheduled' && primaryMatch && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-purple-300">
                              <Clock size={11} className="shrink-0" />
                              <span>{primaryMatch.video.estado === 'ENVIADO' ? 'Enviado' : 'Programado'}</span>
                              {primaryMatch.account && (
                                <span className="inline-flex items-center gap-1 text-zinc-200 font-medium">
                                  {getPlatformIcon(primaryMatch.account.plataforma, 10)}
                                  @{primaryMatch.account.username}
                                </span>
                              )}
                              <span>
                                · {format(new Date(primaryMatch.video.programado_para), 'd MMM HH:mm', { locale: es })}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Acción rápida */}
                      <div className="shrink-0 flex items-center gap-1">
                        {category === 'missing' ? (
                          <button
                            type="button"
                            onClick={() => openScheduleModal(undefined, entry.file)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/35 border border-orange-500/40 text-[11px] font-bold text-orange-200 hover:text-white transition-all active:scale-95 cursor-pointer"
                            title="Abrir modal de programación con este video cargado"
                          >
                            <Plus size={12} />
                            <span>Programar</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            {primaryMatch && (
                              <button
                                type="button"
                                onClick={() => setSelectedVideoId(primaryMatch.video.id)}
                                className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[10px] font-semibold text-zinc-200 hover:text-white transition-colors cursor-pointer"
                                title="Ver detalles de esta publicación"
                              >
                                Ver post
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openScheduleModal(undefined, entry.file)}
                              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-orange-500/20 border border-white/10 hover:border-orange-500/35 text-zinc-400 hover:text-orange-200 transition-colors cursor-pointer"
                              title="Programar en otra fecha o cuenta"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Reproductor compacto bajo demanda */}
                    {isPreviewing && previewUrl && (
                      <div className="mt-2 rounded-xl overflow-hidden bg-black border border-white/10">
                        <video
                          src={previewUrl}
                          controls
                          autoPlay
                          playsInline
                          className="w-full max-h-48 object-contain bg-black"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </motion.aside>
  );
}

export function LocalFolderAnalyzerModal() {
  const isFolderAnalyzerOpen = useAppStore((s) => s.isFolderAnalyzerOpen);

  return (
    <AnimatePresence>
      {isFolderAnalyzerOpen && <LocalFolderAnalyzerPanel key="local-folder-analyzer-panel" />}
    </AnimatePresence>
  );
}
