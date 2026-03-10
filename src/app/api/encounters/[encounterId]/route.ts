import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import type { Visit, VisitStatus, UpdateVisitRequest } from '@/lib/types';

/** Normalize legacy DB statuses (e.g. "completed" → "closed") */
function normalizeStatus(status: string): VisitStatus {
  if (status === 'completed') return 'closed';
  return status as VisitStatus;
}

interface RouteParams {
  params: Promise<{ encounterId: string }>;
}

/**
 * GET /api/encounters/[encounterId]
 * Get a single visit with its chunks
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, supabase } = await requireAuth();
    const { encounterId: visitId } = await params;

    // Get visit
    const { data: visit, error } = await supabase
      .from('visits')
      .select('*')
      .eq('id', visitId)
      .eq('user_id', userId)
      .single();

    if (error || !visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }

    // Get chunks count
    const { count: chunkCount } = await supabase
      .from('transcript_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('visit_id', visitId);

    return NextResponse.json({
      ...visit,
      status: normalizeStatus(visit.status),
      chunkCount: chunkCount || 0,
    } as Visit & { chunkCount: number });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Visit fetch error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/encounters/[encounterId]
 * Update a visit
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, supabase } = await requireAuth();
    const { encounterId: visitId } = await params;

    const body: UpdateVisitRequest = await request.json();

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.patient_name !== undefined) updateData.patient_name = body.patient_name;
    if (body.patient_id !== undefined) updateData.patient_id = body.patient_id;
    if (body.visit_type !== undefined) updateData.visit_type = body.visit_type;
    if (body.visit_date !== undefined) updateData.visit_date = body.visit_date;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.soap_note !== undefined) updateData.soap_note = body.soap_note;
    if (body.patient_letter !== undefined) updateData.patient_letter = body.patient_letter;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: visit, error } = await supabase
      .from('visits')
      .update(updateData)
      .eq('id', visitId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating visit:', error);
      return NextResponse.json({ error: 'Failed to update visit' }, { status: 500 });
    }

    if (!visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }

    return NextResponse.json(visit as Visit);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Visit update error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/encounters/[encounterId]
 * Delete a visit (soft delete by default, hard delete with ?hard=true)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId, supabase } = await requireAuth();
    const { encounterId: visitId } = await params;

    const searchParams = request.nextUrl.searchParams;
    const hardDelete = searchParams.get('hard') === 'true';

    if (hardDelete) {
      // Get audio path first to clean up storage
      const { data: visit } = await supabase
        .from('visits')
        .select('audio_path')
        .eq('id', visitId)
        .eq('user_id', userId)
        .single();

      // Delete from storage if audio exists
      if (visit?.audio_path) {
        await supabase.storage.from('audio').remove([visit.audio_path]);
      }

      // Hard delete (will cascade to chunks)
      const { error } = await supabase
        .from('visits')
        .delete()
        .eq('id', visitId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting visit:', error);
        return NextResponse.json({ error: 'Failed to delete visit' }, { status: 500 });
      }
    } else {
      // Soft delete (archive)
      const { error } = await supabase
        .from('visits')
        .update({ status: 'archived' })
        .eq('id', visitId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error archiving visit:', error);
        return NextResponse.json({ error: 'Failed to archive visit' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Visit delete error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
