// src/lib/dragBridge.ts
// Puente ligero en memoria para permitir arrastrar un archivo File ya cargado en el navegador
// (p.ej. desde el Analizador de Carpeta Local) directamente hacia las celdas del Calendario
// o hacia los modales de programación/detalle sin perder la referencia al objeto File nativo.

let activeInternalDraggedFile: File | null = null;

export function setInternalDraggedFile(file: File | null): void {
  activeInternalDraggedFile = file;
}

export function getInternalDraggedFile(): File | null {
  return activeInternalDraggedFile;
}
