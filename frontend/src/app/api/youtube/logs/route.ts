// src/app/api/youtube/logs/route.ts
// Devuelve los logs de publicación de YouTube desde la tabla publicacion_logs
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const publicacion_id = searchParams.get('publicacion_id');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);

    const { getSupabase } = await import('@/lib/supabase');
    const supabase = getSupabase();

    let query = supabase
      .from('publicacion_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (publicacion_id) {
      query = query.eq('publicacion_id', publicacion_id);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({
        success: false,
        error: `Error al consultar logs: ${error.message}`,
        hint: 'Ejecuta el SQL de migración en Supabase para crear la tabla publicacion_logs.',
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, logs: data ?? [], total: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
