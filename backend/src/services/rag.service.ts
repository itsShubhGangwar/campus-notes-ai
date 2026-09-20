import { prisma } from '../config/db.js';
import { config } from '../config/env.js';
import { embeddingService } from './embedding.service.js';
import { ollamaService } from './ollama.service.js';
import { Role } from '@prisma/client';

export interface RagUserContext {
  id: string;
  role: Role;
  collegeId?: string | null;
  branchId?: string | null;
}

export interface RagRetrievalOptions {
  noteId?: string;
  subjectId?: string;
  semester?: number;
  branchId?: string;
  collegeId?: string;
  topK?: number;
  similarityThreshold?: number;
}

export interface RetrievedChunk {
  id: string;
  noteId: string;
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  tokenCount: number | null;
  similarity: number;
  noteTitle: string;
  fileName: string;
  collegeId: string;
  branchId: string;
  semester: number;
  subjectId: string;
}

export interface StructuredSource {
  chunkId: string;
  noteId: string;
  noteTitle: string;
  fileName: string;
  pageNumber: number | null;
  similarity: number;
  contentExcerpt: string;
}

export interface ConversationTurn {
  role: 'user' | 'model';
  content: string;
}

export interface RagExecutionResult {
  answer: string;
  sources: StructuredSource[];
  wasShortCircuited: boolean;
  retrievedCount: number;
  topSimilarity: number | null;
  modelUsed: string;
}

export class RagService {
  private readonly llmProvider: 'gemini' | 'ollama';
  private readonly chatModel: string;
  private readonly defaultTopK: number;
  private readonly defaultSimilarityThreshold: number;
  private readonly apiKey: string;
  private readonly maxRetries = 4;

  constructor() {
    this.llmProvider = config.ai.llmProvider;
    this.chatModel = config.ai.chatModel;
    this.defaultTopK = config.rag.topK;
    this.defaultSimilarityThreshold = config.rag.similarityThreshold;
    this.apiKey = config.ai.geminiApiKey;
  }

  /**
   * Performs a secure, parameterized pgvector similarity search on note_chunks.
   * Scopes queries according to user authorization and explicit filters.
   */
  public async retrieveContext(
    query: string,
    options: RagRetrievalOptions,
    user: RagUserContext
  ): Promise<RetrievedChunk[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    // 1. Generate query embedding vector (768 dimensions)
    const queryVector = await embeddingService.generateEmbedding(query.trim());
    const queryVectorJson = JSON.stringify(queryVector);

    const similarityThreshold = options.similarityThreshold ?? this.defaultSimilarityThreshold;
    const topK = Math.min(Math.max(options.topK ?? this.defaultTopK, 1), 20);

    // 2. Build parameterized WHERE conditions safely
    const params: any[] = [queryVectorJson, similarityThreshold];
    const whereClauses: string[] = [
      'c.embedding IS NOT NULL',
      // Cosine distance <=> operator: similarity = 1 - distance
      '(1 - (c.embedding <=> $1::vector)) >= $2',
    ];

    // Authorization & Visibility Filter
    if (options.noteId) {
      // If scoped to a specific note, verify note existence and authorization
      const targetNote = await prisma.note.findUnique({
        where: { id: options.noteId },
        select: { id: true, isPublished: true, uploaderId: true, collegeId: true },
      });

      if (!targetNote) {
        throw new Error('Requested note not found.');
      }

      // Check access permission: Published, Owner, or Admin
      const isOwner = targetNote.uploaderId === user.id;
      const isAdmin = user.role === Role.ADMIN;
      if (!targetNote.isPublished && !isOwner && !isAdmin) {
        throw new Error('You do not have permission to query this private note.');
      }

      params.push(options.noteId);
      whereClauses.push(`n.id = $${params.length}`);
    } else {
      // General catalog query: Only published notes accessible to this user
      if (user.role !== Role.ADMIN) {
        whereClauses.push('n."isPublished" = true');

        // If student is enrolled in a college, scope to their college or public catalog
        if (user.collegeId) {
          params.push(user.collegeId);
          whereClauses.push(`n."collegeId" = $${params.length}`);
        }
      } else {
        // Admin: Allow querying any note if not explicitly restricted
        whereClauses.push('n."isPublished" = true');
      }

      // Explicit academic hierarchy filters (validated)
      if (options.subjectId) {
        params.push(options.subjectId);
        whereClauses.push(`n."subjectId" = $${params.length}`);
      }
      if (options.semester) {
        params.push(Number(options.semester));
        whereClauses.push(`n.semester = $${params.length}`);
      }
      if (options.branchId) {
        params.push(options.branchId);
        whereClauses.push(`n."branchId" = $${params.length}`);
      }
      if (options.collegeId && user.role === Role.ADMIN) {
        params.push(options.collegeId);
        whereClauses.push(`n."collegeId" = $${params.length}`);
      }
    }

    params.push(topK);
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT
        c.id,
        c."noteId",
        c."chunkIndex",
        c."pageNumber",
        c.content,
        c."tokenCount",
        (1 - (c.embedding <=> $1::vector)) AS similarity,
        n.title AS "noteTitle",
        n."fileName" AS "fileName",
        n."collegeId",
        n."branchId",
        n.semester,
        n."subjectId"
      FROM note_chunks c
      JOIN notes n ON c."noteId" = n.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT ${limitParam};
    `;

    const results = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    return results.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      chunkIndex: row.chunkIndex,
      pageNumber: row.pageNumber,
      content: row.content,
      tokenCount: row.tokenCount,
      similarity: Number(row.similarity),
      noteTitle: row.noteTitle,
      fileName: row.fileName,
      collegeId: row.collegeId,
      branchId: row.branchId,
      semester: row.semester,
      subjectId: row.subjectId,
    }));
  }

  /**
   * Synthesizes an answer strictly grounded in retrieved note context using the configured LLM provider.
   */
  public async generateGroundedAnswer(
    question: string,
    contextChunks: RetrievedChunk[],
    history: ConversationTurn[] = []
  ): Promise<string> {
    // Build context blocks with clear headers
    const contextBlocks = contextChunks.map((c, idx) => {
      const pageInfo = c.pageNumber ? `Page ${c.pageNumber}` : 'Page Unknown';
      const simPercent = Math.round(c.similarity * 100);
      return `[Source ${idx + 1}: "${c.noteTitle}", ${pageInfo} | Relevance: ${simPercent}%]\n${c.content}`;
    }).join('\n\n');

    const systemInstruction = `You are CampusNotes AI, a strict academic study assistant for college students.
Your mission is to answer the student's question using ONLY the provided verified study note excerpts below.

GROUNDING RULES:
1. Rely SOLELY on facts and definitions explicitly stated in the provided note excerpts. Do NOT assume, extrapolate, or bring in outside/general knowledge.
2. If the provided excerpts do not contain sufficient facts to answer the question, you MUST clearly state:
   "Based on the provided notes, there is not enough information to answer this question."
3. Never invent facts, definitions, or equations and claim they come from the notes.
4. Format your answer cleanly using markdown with bold headings, bullet points, and concise explanations where appropriate.
5. Cite the sources in your answer using bracket notation matching the sources provided in context, e.g.: [Source: <Note Title>, Page <X>].`;

    if (this.llmProvider === 'ollama') {
      return await ollamaService.generateGroundedAnswer(question, contextBlocks, systemInstruction, history);
    }

    return await this.generateGeminiGroundedAnswer(question, contextBlocks, systemInstruction, history);
  }

  /**
   * Generates a grounded answer using Google Gemini models with multi-model fallback.
   */
  public async generateGeminiGroundedAnswer(
    question: string,
    contextBlocks: string,
    systemInstruction: string,
    history: ConversationTurn[] = []
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in backend environment.');
    }

    const promptText = `=== VERIFIED STUDY NOTE EXCERPTS ===
${contextBlocks}
====================================

STUDENT QUESTION:
${question}

Answer the student's question strictly following the grounding rules:`;

    // Limit conversation history to the last 6 turns (3 pairs) to avoid context bloat
    const boundedHistory = history.slice(-6).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.content }],
    }));

    const contents = [
      ...boundedHistory,
      {
        role: 'user',
        parts: [{ text: promptText }],
      },
    ];

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        temperature: 0.2, // Low temperature for deterministic, factual grounding
        topP: 0.8,
        maxOutputTokens: 1024,
      },
    };

    const modelsToTry = [this.chatModel, 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite']
      .filter((m, idx, arr) => arr.indexOf(m) === idx);

    let lastError: Error | null = null;
    let totalAttempts = 0;

    for (const currentModel of modelsToTry) {
      let modelAttempt = 0;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

      while (modelAttempt < 2) {
        modelAttempt++;
        totalAttempts++;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorData = (await response.json().catch(() => ({}))) as any;
            const msg = errorData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
            lastError = new Error(`Gemini Chat API Error (${response.status}) [${currentModel}]: ${this.sanitizeMessage(msg)}`);

            // If quota exhausted on this model, break out to the next fallback model
            if (response.status === 429 && (msg.includes('Quota exceeded') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('per_day'))) {
              console.warn(`[RagService] Daily/RPM quota exhausted for model ${currentModel}. Falling back to next available model...`);
              break;
            }

            if (response.status === 429 || response.status >= 500) {
              const retryMatch = msg.match(/retry in ([0-9.]+)s/i);
              const explicitWait = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1500 : 0;
              const delay = explicitWait > 0 ? explicitWait : 3000;
              console.warn(`[RagService] Gemini generation rate limited (${response.status}) on ${currentModel}. Retrying in ${delay}ms...`);
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            throw lastError;
          }

          const data = (await response.json()) as any;
          const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

          if (!candidateText) {
            throw new Error(`Gemini (${currentModel}) returned an empty response candidate.`);
          }

          return candidateText.trim();
        } catch (err: any) {
          lastError = err;
          if (err.message?.includes('(400)') || err.message?.includes('(401)') || err.message?.includes('(403)')) {
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    throw new Error(`Failed to generate answer after ${totalAttempts} attempts across fallback models: ${this.sanitizeMessage(lastError?.message || 'Unknown error')}`);
  }

  /**
   * Complete End-to-End RAG execution workflow.
   * 1. Vector similarity search via pgvector
   * 2. Short-circuits gracefully if no chunks pass similarity threshold
   * 3. Calls LLM with strict grounding prompt (via configured provider: Gemini or Ollama)
   * 4. Assembles backend-verified citation sources
   */
  public async executeRagQuery(
    question: string,
    options: RagRetrievalOptions,
    user: RagUserContext,
    history: ConversationTurn[] = []
  ): Promise<RagExecutionResult> {
    const chunks = await this.retrieveContext(question, options, user);
    const activeModel = this.llmProvider === 'ollama' ? config.ollama.model : this.chatModel;

    // 1. Short-circuit safeguard: No chunks meet the similarity threshold
    if (chunks.length === 0) {
      return {
        answer: 'Based on the provided notes, there is not enough information to answer this question. Please ensure relevant notes are uploaded or selected.',
        sources: [],
        wasShortCircuited: true,
        retrievedCount: 0,
        topSimilarity: null,
        modelUsed: activeModel,
      };
    }

    // 2. Generate grounded answer
    const answer = await this.generateGroundedAnswer(question, chunks, history);

    // 3. Assemble verified structured sources directly from PostgreSQL metadata
    const sources: StructuredSource[] = chunks.map((c) => ({
      chunkId: c.id,
      noteId: c.noteId,
      noteTitle: c.noteTitle,
      fileName: c.fileName,
      pageNumber: c.pageNumber,
      similarity: Math.round(c.similarity * 1000) / 1000,
      contentExcerpt: c.content.length > 200 ? `${c.content.substring(0, 200)}...` : c.content,
    }));

    return {
      answer,
      sources,
      wasShortCircuited: false,
      retrievedCount: chunks.length,
      topSimilarity: chunks[0]?.similarity ?? null,
      modelUsed: activeModel,
    };
  }

  private sanitizeMessage(msg: string): string {
    if (!msg) return '';
    return msg.replace(/key=[A-Za-z0-9_\-]+/gi, 'key=REDACTED');
  }

  get activeProvider(): 'gemini' | 'ollama' {
    return this.llmProvider;
  }

  get configuredModel(): string {
    return this.llmProvider === 'ollama' ? config.ollama.model : this.chatModel;
  }

  get configuredThreshold(): number {
    return this.defaultSimilarityThreshold;
  }

  get configuredTopK(): number {
    return this.defaultTopK;
  }
}

export const ragService = new RagService();
