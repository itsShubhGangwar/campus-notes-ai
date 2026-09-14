import { config } from '../config/env';

export interface IEmbeddingResult {
  values: number[];
  dimension: number;
}

export class EmbeddingService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimension: number;
  private readonly maxRetries = 3;
  private readonly defaultBatchSize = 20;

  constructor() {
    this.apiKey = config.ai.geminiApiKey;
    this.model = config.ai.embeddingModel;
    this.dimension = config.ai.embeddingDimension;
  }

  /**
   * Generates a 768-dimensional embedding vector for a single text chunk.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateBatchEmbeddings([text]);
    if (!results || results.length === 0) {
      throw new Error('No embedding returned for text chunk.');
    }
    return results[0];
  }

  /**
   * Generates 768-dimensional embeddings for a batch of text chunks with automatic sub-batching and retry backoff.
   */
  async generateBatchEmbeddings(texts: string[], batchSize = this.defaultBatchSize): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in environment variables.');
    }

    if (texts.length === 0) {
      return [];
    }

    const allEmbeddings: number[][] = [];

    // Process in sub-batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const chunkBatch = texts.slice(i, i + batchSize);
      const batchVectors = await this.executeBatchWithRetry(chunkBatch);
      allEmbeddings.push(...batchVectors);
    }

    return allEmbeddings;
  }

  /**
   * Executes a single batch request to Gemini with exponential backoff retries.
   */
  private async executeBatchWithRetry(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/${this.model}:batchEmbedContents?key=${encodeURIComponent(this.apiKey)}`;

    const requestBody = {
      requests: texts.map((text) => ({
        model: this.model,
        content: {
          parts: [{ text: text.trim() || ' ' }],
        },
        outputDimensionality: this.dimension,
      })),
    };

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      attempt++;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as any)?.error?.message || `HTTP ${response.status} ${response.statusText}`;

          // If rate limited or service unavailable, retry with backoff
          if (response.status === 429 || response.status === 503 || response.status >= 500) {
            const retryMatch = errorMessage.match(/retry in ([0-9.]+)s/i);
            const explicitWait = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1500 : 0;
            const delayMs = explicitWait > 0 ? explicitWait : Math.min(2000 * Math.pow(2, attempt - 1), 30000);
            console.warn(`[EmbeddingService] Gemini API returned ${response.status}. Retrying attempt ${attempt}/${this.maxRetries} after ${delayMs}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }

          throw new Error(`Gemini Embedding API Error (${response.status}): ${this.sanitizeMessage(errorMessage)}`);
        }

        const data = await response.json() as { embeddings?: Array<{ values?: number[] }> };
        const embeddings = data.embeddings || [];

        if (embeddings.length !== texts.length) {
          throw new Error(`Gemini returned ${embeddings.length} embeddings for ${texts.length} input texts.`);
        }

        return embeddings.map((emb, idx) => {
          const values = emb.values || [];
          if (values.length !== this.dimension) {
            throw new Error(`Expected embedding dimension ${this.dimension}, but received ${values.length} for chunk ${idx}.`);
          }
          return values;
        });
      } catch (err: any) {
        lastError = err;
        // Don't retry if it's already max attempts or fatal client error (400, 401, 403)
        if (err.message?.includes('(400)') || err.message?.includes('(401)') || err.message?.includes('(403)') || attempt >= this.maxRetries) {
          break;
        }
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Failed to generate embeddings after ${attempt} attempts: ${this.sanitizeMessage(lastError?.message || 'Unknown error')}`);
  }

  /**
   * Sanitizes error messages to ensure API keys and sensitive tokens are never printed or leaked.
   */
  private sanitizeMessage(msg: string): string {
    if (!msg) return '';
    return msg.replace(/key=[A-Za-z0-9_\-]+/gi, 'key=REDACTED');
  }

  get targetDimension(): number {
    return this.dimension;
  }
}

export const embeddingService = new EmbeddingService();
