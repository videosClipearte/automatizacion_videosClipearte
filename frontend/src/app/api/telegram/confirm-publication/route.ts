// src/app/api/telegram/confirm-publication/route.ts
// Endpoint para confirmación de publicación.
// Delega en publicationConfirmationService para asegurar consistencia total.

import { NextRequest, NextResponse } from 'next/server';
import { confirmPublicationAndProcessMetrics } from '@/lib/services/publicationConfirmationService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { publicacion_id, post_url, cuenta_id, vistas } = body as {
      publicacion_id: string;
      post_url?: string;
      cuenta_id?: string;
      vistas?: number;
    };

    if (!publicacion_id) {
      return NextResponse.json(
        { success: false, error: 'publicacion_id es obligatorio' },
        { status: 400 }
      );
    }

    const result = await confirmPublicationAndProcessMetrics({
      publicacionId: publicacion_id,
      postUrl: post_url,
      cuentaId: cuenta_id,
      vistas,
      fuente: 'telegram',
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || result.message }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[confirm-publication] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error en servidor' }, { status: 500 });
  }
}
