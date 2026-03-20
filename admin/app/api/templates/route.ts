import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/templates
 *
 * Returns all templates (service role bypasses RLS).
 * Sorted by sort_order ascending.
 */
export async function GET() {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from('templates')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Failed to fetch templates:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
