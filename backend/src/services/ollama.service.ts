import { config } from '../config/env.js';
import { ConversationTurn } from './rag.service.js';

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  eval_count?: number;
}

export class OllamaService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = config.ollama.baseUrl.replace(/\/+$/, '');
    this.model = config.ollama.model;
  }

  /**
   * Health-check: Checks if Ollama is running and whether the target model is installed.
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; modelFound: boolean; models: string[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return { isHealthy: false, modelFound: false, models: [] };
      }

      const data = (await response.json()) as { models?: Array<{ name: string; model: string }> };
      const modelNames = (data.models || []).map((m) => m.name);
      const modelFound = modelNames.some((name) =>
        name === this.model || name.startsWith(`${this.model}:`) || this.model.startsWith(`${name}:`)
      );

      return {
        isHealthy: true,
        modelFound,
        models: modelNames,
      };
    } catch (err) {
      return { isHealthy: false, modelFound: false, models: [] };
    }
  }

  /**
   * Generates a factual grounded answer using Ollama /api/chat.
   * Sends the strict grounding system prompt, retrieved note chunks, bounded history, and user question.
   */
  public async generateGroundedAnswer(
    question: string,
    contextBlocks: string,
    systemInstruction: string,
    history: ConversationTurn[] = []
  ): Promise<string> {
    const promptText = `=== VERIFIED STUDY NOTE EXCERPTS ===
${contextBlocks}
====================================

STUDENT QUESTION:
${question}

Answer the student's question strictly following the grounding rules:`;

    // Map conversation history to Ollama message roles (user / assistant)
    const boundedHistory = history.slice(-6).map((turn) => ({
      role: turn.role === 'user' ? 'user' : 'assistant',
      content: turn.content,
    }));

    const messages = [
      {
        role: 'system',
        content: systemInstruction,
      },
      ...boundedHistory,
      {
        role: 'user',
        content: promptText,
      },
    ];

    const requestBody = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: 0.2, // Low temperature for deterministic, factual grounding
        top_p: 0.8,
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (networkErr: any) {
      throw new Error(
        `Failed to connect to Ollama at ${this.baseUrl}. Please verify that the Ollama daemon is running. Error: ${networkErr.message}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Ollama API Error (${response.status} ${response.statusText}): ${errorText || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    const answer = data.message?.content?.trim();

    if (!answer) {
      throw new Error(`Ollama (${this.model}) returned an empty answer.`);
    }

    return answer;
  }

  get configuredModel(): string {
    return this.model;
  }

  get configuredBaseUrl(): string {
    return this.baseUrl;
  }
}

export const ollamaService = new OllamaService();
