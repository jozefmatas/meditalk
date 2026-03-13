import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import {
  anthropic,
  buildTemplateSystemPrompt,
  buildTemplateUserMessage,
  NOT_STATED,
} from '@/lib/anthropic';
import { getTemplateById, getDefaultTemplate } from '@/lib/templates';
import { buildTemplateHtml, flattenSectionIds } from '@/lib/templates/html';
import { logUsage } from '@/lib/usage';
import type { SupportedLanguage } from '@/lib/types';

/**
 * Streaming regeneration endpoint.
 *
 * Skips OpenAI embedding + vector search (chunks are fetched directly by visit_id).
 * Streams Anthropic response as SSE so sections appear progressively on the client.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireAuth>>['supabase'];

  try {
    const auth = await requireAuth();
    userId = auth.userId;
    supabase = auth.supabase;
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const visitId: string | undefined = body.visitId;
    const templateId: string | undefined = body.templateId;
    const doctorNotes: string | undefined = body.doctorNotes;

    if (!visitId) {
      return new Response(JSON.stringify({ error: 'Missing visitId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch visit metadata (RLS enforces ownership)
    const { data: visit, error: visitError } = await supabase
      .from('visits')
      .select('id, language, metadata')
      .eq('id', visitId)
      .single();

    if (visitError || !visit) {
      return new Response(JSON.stringify({ error: 'Visit not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const language = (visit.language as SupportedLanguage) || 'en';

    // Fetch chunks directly by visit_id — skip embedding + vector search
    const { data: chunks, error: chunksError } = await supabase
      .from('transcript_chunks')
      .select('id, content')
      .eq('visit_id', visitId)
      .order('chunk_index', { ascending: true });

    // Collect already-extracted file texts from metadata
    const visitMeta = (visit.metadata ?? {}) as Record<string, unknown>;
    const uploadedFiles = (visitMeta.files ?? []) as {
      name: string;
      type: string;
      extracted_text?: string | null;
    }[];
    const fileTexts = uploadedFiles
      .filter((f) => f.extracted_text)
      .map((f) => ({ name: f.name, type: f.type, text: f.extracted_text! }));

    const chunkContents = chunks?.map((c) => c.content) ?? [];
    const usedChunkIds = chunks?.map((c) => c.id as string) ?? [];

    if (chunkContents.length === 0 && !doctorNotes?.trim() && fileTexts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No transcript, doctor notes, or file content available' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (chunksError) {
      console.error('Chunk fetch error:', chunksError);
    }

    // Resolve template
    const template =
      (templateId ? getTemplateById(templateId) : null) || getDefaultTemplate();
    const allIds = flattenSectionIds(template);

    // Load section labels from locale messages
    const messages = (await import(`../../../../messages/${language}.json`)).default;
    const templateSections: Record<string, string> =
      messages.templates?.sections || {};
    const sectionLabels: Record<string, string> = {};
    for (const id of allIds) {
      sectionLabels[id] = templateSections[id] || id;
    }

    // Build prompts
    const systemPrompt = buildTemplateSystemPrompt(template, language, sectionLabels);
    const userMessage = buildTemplateUserMessage(chunkContents, template, doctorNotes, fileTexts);

    // Stream Anthropic response
    const stream = anthropic().messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const encoder = new TextEncoder();
    const sectionIdSet = new Set(allIds);
    // Track which sections we've already emitted
    const emittedSections = new Set<string>();

    const readable = new ReadableStream({
      async start(controller) {
        let accumulated = '';
        let inputTokens = 0;
        let outputTokens = 0;

        function sendEvent(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }

        /**
         * Try to extract completed "key": "value" pairs from the accumulated JSON.
         * Emits SSE events for each newly completed template section.
         */
        function tryExtractSections() {
          for (const id of sectionIdSet) {
            if (emittedSections.has(id)) continue;

            // Look for "sectionId": "...value..."
            // Match the key, then capture the string value (handling escaped quotes)
            const keyPattern = `"${id}"\\s*:\\s*"`;
            const keyMatch = accumulated.match(new RegExp(keyPattern));
            if (!keyMatch) continue;

            const valueStart = keyMatch.index! + keyMatch[0].length;
            // Find the closing unescaped quote
            let pos = valueStart;
            let found = false;
            while (pos < accumulated.length) {
              if (accumulated[pos] === '\\') {
                pos += 2; // skip escaped char
                continue;
              }
              if (accumulated[pos] === '"') {
                found = true;
                break;
              }
              pos++;
            }

            if (!found) continue;

            // Extract the raw value and unescape
            const rawValue = accumulated.slice(valueStart, pos);
            let value: string;
            try {
              value = JSON.parse(`"${rawValue}"`);
            } catch {
              value = rawValue;
            }

            emittedSections.add(id);
            sendEvent({
              type: 'section',
              id,
              title: sectionLabels[id] || id,
              content: value,
            });
          }
        }

        try {
          stream.on('text', (delta) => {
            accumulated += delta;
            tryExtractSections();
          });

          // Wait for stream to complete
          const finalMessage = await stream.finalMessage();
          inputTokens = finalMessage.usage.input_tokens;
          outputTokens = finalMessage.usage.output_tokens;

          // Parse the full JSON for the final result
          const fullText =
            finalMessage.content[0].type === 'text'
              ? finalMessage.content[0].text
              : '';
          const jsonMatch = fullText.match(/\{[\s\S]*\}/);

          if (!jsonMatch) {
            sendEvent({ type: 'error', error: 'Failed to parse response' });
            controller.close();
            return;
          }

          const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;

          const letter =
            typeof parsed.letter === 'string'
              ? parsed.letter
              : JSON.stringify(parsed.letter || '');
          delete parsed.letter;

          const suggestedTitle =
            typeof parsed.title === 'string' ? parsed.title : '';
          delete parsed.title;

          const notStated = NOT_STATED[language];
          const sectionContents: Record<string, string> = {};
          for (const id of allIds) {
            const value = parsed[id];
            sectionContents[id] = typeof value === 'string' ? value : notStated;
          }

          const generatedNote = buildTemplateHtml(template, sectionContents, sectionLabels);

          // Save to DB
          const existingMetadata =
            (visit.metadata as Record<string, unknown>) || {};
          supabase
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
            .eq('id', visitId)
            .then(({ error }) => {
              if (error) console.error('Failed to save regenerated content:', error);
            });

          // Log usage
          logUsage({
            userId,
            visitId,
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            operation: 'generate_template',
            inputTokens,
            outputTokens,
          });

          // Send final complete event
          sendEvent({
            type: 'complete',
            generatedNote,
            letter,
            suggestedTitle,
            usedChunks: usedChunkIds,
            templateId: template.id,
          });

          controller.close();
        } catch (err) {
          console.error('Regenerate stream error:', err);
          sendEvent({
            type: 'error',
            error: err instanceof Error ? err.message : 'Generation failed',
          });
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Regenerate route error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
