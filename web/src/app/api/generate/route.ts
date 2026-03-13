import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { embedText } from '@/lib/openai';
import { generateFromTemplate } from '@/lib/anthropic';
import { extractTextFromFile } from '@/lib/file-extraction';
import { getTemplateById, getDefaultTemplate } from '@/lib/templates';
import { flattenSectionIds } from '@/lib/templates/html';
import type { GenerateResponse, SupportedLanguage } from '@/lib/types';

const RETRIEVAL_QUERY: Record<SupportedLanguage, string> = {
  en: 'Patient symptoms, diagnosis, examination findings, treatment plan, medications, follow-up',
  sk: 'Symptómy pacienta, diagnóza, vyšetrenie, plán liečby, lieky, kontrola',
  cs: 'Symptomy pacienta, diagnóza, vyšetření, plán léčby, léky, kontrola',
};

export async function POST(request: NextRequest) {
  try {
    const { userId, supabase } = await requireAuth();

    const body = await request.json();
    // Support both visitId (new) and transcriptId (legacy)
    const visitId = body.visitId || body.transcriptId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;

    if (!visitId) {
      return NextResponse.json(
        { error: 'Missing required field: visitId' },
        { status: 400 }
      );
    }

    // Fetch the visit to get its language and existing metadata (RLS enforces ownership)
    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .select('id, language, metadata')
      .eq('id', visitId)
      .single();

    if (visitError || !visit) {
      return NextResponse.json(
        { error: 'Visit not found' },
        { status: 404 }
      );
    }

    const language = (visit.language as SupportedLanguage) || 'en';

    // Process uploaded files — extract text from any that haven't been processed yet
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      id: string;
      name: string;
      type: string;
      path: string;
      source?: string;
      extracted_text?: string | null;
    }[];

    // Extract text from unprocessed files (skip recording files — handled by process-audio)
    const unprocessed = uploadedFiles.filter(
      (f) => !f.extracted_text && f.source !== 'recording' && f.path
    );

    if (unprocessed.length > 0) {
      for (const file of unprocessed) {
        try {
          const { data: fileData, error: dlError } = await supabase.storage
            .from('encounter-files')
            .download(file.path);

          if (dlError || !fileData) {
            console.error(`Failed to download ${file.name}:`, dlError);
            continue;
          }

          const buffer = Buffer.from(await fileData.arrayBuffer());
          const text = await extractTextFromFile(buffer, file.name, file.type, language, { userId, visitId });
          file.extracted_text = text;
        } catch (err) {
          console.error(`Text extraction failed for ${file.name}:`, err);
        }
      }

      // Persist extracted text back to metadata
      await supabase
        .from('visits')
        .update({ metadata: { ...visitMeta, files: uploadedFiles } })
        .eq('id', visitId);
    }

    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));

    // Look up the template
    const template =
      (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();

    // Load section labels from locale messages
    const messages = (await import(`../../../../messages/${language}.json`))
      .default;
    const templateSections: Record<string, string> =
      messages.templates?.sections || {};
    const allIds = flattenSectionIds(template);
    const sectionLabels: Record<string, string> = {};
    for (const id of allIds) {
      sectionLabels[id] = templateSections[id] || id;
    }

    // Embed a clinical retrieval query to find the most relevant chunks
    let chunkContents: string[] = [];
    let usedChunks: string[] = [];

    const queryEmbedding = await embedText(RETRIEVAL_QUERY[language], { userId, visitId });

    const { data: matches, error: rpcError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 16,
        p_visit_id: visitId,
      }
    );

    const hasFileContent = fileTexts.length > 0;

    if (rpcError) {
      console.error('match_chunks RPC error:', rpcError);
      // Only fail if we also have no doctor notes or file content
      if (!doctorNotes?.trim() && !hasFileContent) {
        return NextResponse.json(
          { error: `Chunk retrieval failed: ${rpcError.message}` },
          { status: 500 }
        );
      }
    }

    if (!matches || matches.length === 0) {
      if (!doctorNotes?.trim() && !hasFileContent) {
        return NextResponse.json(
          { error: 'No transcript, doctor notes, or file content available for generation' },
          { status: 404 }
        );
      }
    } else {
      chunkContents = matches.map(
        (m: { content: string }) => m.content
      );
      usedChunks = matches.map(
        (m: { id: string }) => m.id as string
      );
    }

    // Generate note from template
    console.log(
      'Calling Anthropic with',
      chunkContents.length,
      'chunks, language:',
      language,
      'template:',
      template.id
    );
    let generatedNote: string;
    let letter: string;
    let suggestedTitle: string;
    try {
      const result = await generateFromTemplate(
        chunkContents,
        template,
        language,
        sectionLabels,
        doctorNotes,
        fileTexts,
        { userId, visitId }
      );
      generatedNote = result.generatedNote;
      letter = result.letter;
      suggestedTitle = result.suggestedTitle;
    } catch (anthropicErr) {
      console.error('Anthropic generation failed:', anthropicErr);
      return NextResponse.json(
        {
          error: `Generation failed: ${anthropicErr instanceof Error ? anthropicErr.message : String(anthropicErr)}`,
        },
        { status: 500 }
      );
    }

    // Save generated content to the visit (preserve existing metadata)
    const existingMetadata =
      (visit.metadata as Record<string, unknown>) || {};
    const { error: updateError } = await supabase
      .from('visits')
      .update({
        soap_note: generatedNote,
        patient_letter: letter,
        metadata: {
          ...existingMetadata,
          template_id: template.id,
          ...(doctorNotes ? { doctor_notes: doctorNotes } : {}),
        },
      })
      .eq('id', visitId);

    if (updateError) {
      console.error('Failed to save generated content:', updateError);
    }

    const response: GenerateResponse = {
      generatedNote,
      letter,
      suggestedTitle: suggestedTitle || undefined,
      usedChunks,
      templateId: template.id,
      soap: generatedNote,
    };

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Generate route error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
