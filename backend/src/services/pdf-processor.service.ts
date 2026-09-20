import { Readable } from 'stream';
import crypto from 'crypto';
// @ts-ignore
import { PDFParse } from 'pdf-parse';
import { prisma } from '../config/db.js';
import { storageService } from './storage.service.js';
import { embeddingService } from './embedding.service.js';
import { ProcessingStatus } from '@prisma/client';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  pageNumber: number;
  content: string;
  tokenCount: number;
}

export interface ProcessResult {
  success: boolean;
  pageCount: number;
  chunkCount: number;
  error?: string;
}

export class PdfProcessorService {
  private activeProcessing = new Set<string>();

  /**
   * Cleans raw extracted text: removes non-printable noise, excessive spaces,
   * while preserving meaningful paragraph breaks and sentence structure.
   */
  public cleanText(rawText: string): string {
    if (!rawText) return '';

    return (
      rawText
        // Strip out any synthetic page footer markers from parser (e.g. "-- 1 of 3 --")
        .replace(/-- \d+ of \d+ --/g, '')
        // Replace non-printable ASCII/control characters (except \n, \r, \t)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        // Normalize CRLF to LF
        .replace(/\r\n/g, '\n')
        // Replace multiple horizontal spaces/tabs with single space
        .replace(/[ \t]+/g, ' ')
        // Remove trailing space on each line
        .replace(/ +\n/g, '\n')
        // Collapse 3 or more consecutive newlines into 2 (preserve paragraphs)
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  /**
   * Chunks page text into bounded semantic chunks with overlap.
   * Target size: ~600-800 characters (~150 words)
   * Overlap: ~100 characters (~25 words)
   */
  public chunkPages(
    pages: ExtractedPage[],
    maxChunkSize = 750,
    overlap = 100
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let globalChunkIndex = 0;

    for (const page of pages) {
      const cleaned = this.cleanText(page.text);
      if (!cleaned || cleaned.length === 0) continue;

      // If page text is within chunk limit, save as single chunk
      if (cleaned.length <= maxChunkSize) {
        chunks.push({
          chunkIndex: globalChunkIndex++,
          pageNumber: page.pageNumber,
          content: cleaned,
          tokenCount: Math.ceil(cleaned.split(/\s+/).length),
        });
        continue;
      }

      // Recursive / sliding window chunking on sentence/paragraph boundaries
      let start = 0;
      while (start < cleaned.length) {
        let end = Math.min(start + maxChunkSize, cleaned.length);

        // If not at the end of the text, try to find a natural boundary to break
        if (end < cleaned.length) {
          const paragraphBreak = cleaned.lastIndexOf('\n\n', end);
          const sentenceBreak = cleaned.lastIndexOf('. ', end);
          const lineBreak = cleaned.lastIndexOf('\n', end);
          const spaceBreak = cleaned.lastIndexOf(' ', end);

          if (paragraphBreak > start + maxChunkSize * 0.5) {
            end = paragraphBreak + 2;
          } else if (sentenceBreak > start + maxChunkSize * 0.5) {
            end = sentenceBreak + 2;
          } else if (lineBreak > start + maxChunkSize * 0.5) {
            end = lineBreak + 1;
          } else if (spaceBreak > start + maxChunkSize * 0.5) {
            end = spaceBreak + 1;
          }
        }

        const chunkText = cleaned.substring(start, end).trim();
        if (chunkText.length > 0) {
          chunks.push({
            chunkIndex: globalChunkIndex++,
            pageNumber: page.pageNumber,
            content: chunkText,
            tokenCount: Math.ceil(chunkText.split(/\s+/).length),
          });
        }

        if (end >= cleaned.length) break;

        // Slide window with overlap
        start = Math.max(start + 1, end - overlap);
      }
    }

    return chunks;
  }

  /**
   * Helper to convert readable stream into a Buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Main pipeline entry point:
   * 1. Extracts & cleans text per page
   * 2. Generates semantic chunks
   * 3. Generates vector embeddings via Gemini
   * 4. Stores chunks and vectors in PostgreSQL with pgvector
   * 5. Updates processingStatus atomically
   */
  public async processNote(noteId: string): Promise<ProcessResult> {
    if (this.activeProcessing.has(noteId)) {
      console.log(`[PDF Processor] Note ${noteId} is already being processed. Awaiting in-flight job...`);
      while (this.activeProcessing.has(noteId)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const note = await prisma.note.findUnique({ where: { id: noteId } });
      const chunkCount = await prisma.noteChunk.count({ where: { noteId } });
      return {
        success: note?.processingStatus === ProcessingStatus.COMPLETED,
        pageCount: note?.pageCount || 0,
        chunkCount,
      };
    }

    this.activeProcessing.add(noteId);

    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) {
      this.activeProcessing.delete(noteId);
      throw new Error(`Note ${noteId} not found`);
    }

    // 1. Update status to PROCESSING
    await prisma.note.update({
      where: { id: noteId },
      data: {
        processingStatus: ProcessingStatus.PROCESSING,
        processingError: null,
      },
    });

    let parser: any = null;

    try {
      // 2. Fetch file stream from Storage Service
      const { stream } = await storageService.getFileStream(note.fileKey);
      const pdfBuffer = await this.streamToBuffer(stream);

      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('PDF file is empty or missing from storage');
      }

      // 3. Extract text per page using PDFParse
      parser = new PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();

      const totalPages = textResult.total || (textResult.pages ? textResult.pages.length : 1);
      const extractedPages: ExtractedPage[] = textResult.pages && textResult.pages.length > 0
        ? textResult.pages.map((p: any) => ({
            pageNumber: p.num || 1,
            text: p.text || '',
          }))
        : [{ pageNumber: 1, text: textResult.text || '' }];

      // 4. Generate clean structured chunks with sequential order and overlap
      const chunks = this.chunkPages(extractedPages);

      // 5. Generate vector embeddings for every chunk via Gemini
      let embeddings: number[][] = [];
      if (chunks.length > 0) {
        console.log(`[PDF Processor] Generating vector embeddings for ${chunks.length} chunks of note ${noteId}...`);
        const chunkTexts = chunks.map((c) => c.content);
        embeddings = await embeddingService.generateBatchEmbeddings(chunkTexts);
        console.log(`[PDF Processor] Successfully generated ${embeddings.length} embeddings (${embeddingService.targetDimension} dimensions).`);
      }

      // 6. Atomic database transaction:
      // Remove stale chunks, insert new chunks with vectors, mark COMPLETED
      await prisma.$transaction(async (tx) => {
        // Idempotency: Purge any existing chunks for this note
        await tx.$executeRawUnsafe('DELETE FROM note_chunks WHERE "noteId" = $1', noteId);

        if (chunks.length > 0) {
          // Batch insert in groups of 25 for optimal SQL performance
          const batchSize = 25;
          for (let i = 0; i < chunks.length; i += batchSize) {
            const slice = chunks.slice(i, i + batchSize);
            const placeholders: string[] = [];
            const params: any[] = [];

            slice.forEach((chunk, idx) => {
              const offset = idx * 7;
              placeholders.push(
                `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::vector, NOW(), NOW())`
              );
              params.push(
                crypto.randomUUID(),
                noteId,
                chunk.chunkIndex,
                chunk.pageNumber,
                chunk.content,
                chunk.tokenCount,
                JSON.stringify(embeddings[i + idx])
              );
            });

            await tx.$executeRawUnsafe(
              `INSERT INTO note_chunks (id, "noteId", "chunkIndex", "pageNumber", content, "tokenCount", embedding, "createdAt", "updatedAt")
               VALUES ${placeholders.join(', ')}`,
              ...params
            );
          }
        }

        await tx.note.update({
          where: { id: noteId },
          data: {
            pageCount: totalPages,
            processingStatus: ProcessingStatus.COMPLETED,
            processingError: null,
          },
        });
      }, { timeout: 30000, maxWait: 10000 });

      console.log(`✅ [PDF Processor] Note ${noteId} fully processed: ${totalPages} pages, ${chunks.length} chunks with vectors stored.`);

      return {
        success: true,
        pageCount: totalPages,
        chunkCount: chunks.length,
      };
    } catch (err: any) {
      const errorMessage = err.message || 'Unknown PDF processing error';
      console.error(`❌ [PDF Processor] Failed to process note ${noteId}:`, errorMessage);

      // Record failure gracefully in database
      await prisma.note.update({
        where: { id: noteId },
        data: {
          processingStatus: ProcessingStatus.FAILED,
          processingError: errorMessage,
        },
      });

      return {
        success: false,
        pageCount: 0,
        chunkCount: 0,
        error: errorMessage,
      };
    } finally {
      this.activeProcessing.delete(noteId);
      if (parser) {
        await parser.destroy().catch(() => {});
      }
    }
  }
}

export const pdfProcessorService = new PdfProcessorService();
