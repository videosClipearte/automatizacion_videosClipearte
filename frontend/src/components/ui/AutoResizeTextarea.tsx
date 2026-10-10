'use client';
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

export interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
  maxHeight?: number;
}

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  (
    {
      minHeight = 72,
      maxHeight = 320,
      value,
      defaultValue,
      onChange,
      onInput,
      className = '',
      style,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    const setRefs = (node: HTMLTextAreaElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref && 'current' in ref) {
        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    };

    const adjustHeight = () => {
      const el = internalRef.current;
      if (!el) return;

      // Restablecer temporalmente para medir la altura real de scroll
      el.style.height = 'auto';

      const scrollH = el.scrollHeight;
      const targetH = Math.max(minHeight, Math.min(scrollH, maxHeight));

      el.style.height = `${targetH}px`;
      el.style.overflowY = scrollH > maxHeight ? 'auto' : 'hidden';
    };

    // Ajustar cuando cambie el valor controlado o por defecto (ej. al autogenerar con IA o cargar datos)
    useEffect(() => {
      adjustHeight();
    }, [value, defaultValue]);

    // Ajuste al montar y al cambiar tamaño de ventana
    useEffect(() => {
      adjustHeight();

      const handleWindowResize = () => {
        adjustHeight();
      };

      window.addEventListener('resize', handleWindowResize);
      return () => {
        window.removeEventListener('resize', handleWindowResize);
      };
    }, []);

    return (
      <textarea
        ref={setRefs}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          adjustHeight();
          onChange?.(e);
        }}
        onInput={(e) => {
          adjustHeight();
          onInput?.(e);
        }}
        className={`w-full transition-[height] duration-100 ease-out [scrollbar-gutter:stable] ${className}`}
        style={{
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
          ...style,
        }}
        {...props}
      />
    );
  }
);

AutoResizeTextarea.displayName = 'AutoResizeTextarea';
