import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import OpenAI from "openai";
import {
  ElderTurnPlanSchema,
  MemoryAnswerSchema,
  MemoryPlanSchema,
  ParsedMemoryQuerySchema,
  type ElderTurnPlan,
  type MemoryAnswer,
  type MemoryPlan,
  type PersonalContext,
  type ParsedMemoryQuery,
} from "@goldmem/memory-schema";
import {
  normalizeMemoryPlanResult,
} from "./normalizers/memory-plan.js";
import { normalizeElderTurnPlanResult } from "./normalizers/turn-plan.js";
import { normalizeParsedMemoryQueryResult } from "./normalizers/query.js";
import { normalizeMemoryAnswerResult } from "./normalizers/answer.js";

export type TranscriptionResult = {
  text: string;
  confidence?: number;
  language?: string;
};

export type GenerateMemoryPlanInput = {
  transcript: string;
  tenantId: string;
  sourceId: string;
  elderId: string;
  createdAt: string;
  context: PersonalContext;
};

export type GenerateMemoryAnswerInput = {
  query: string;
  parsedQuery: ParsedMemoryQuery;
  evidence: RetrievedEvidence[];
  responseStyle: "elder_friendly_voice" | "family_summary";
};

export type PlanElderTurnInput = {
  tenantId: string;
  elderId: string;
  text: string;
  now: string;
  context: PersonalContext;
};

export type ParseMemoryQueryInput = {
  tenantId: string;
  elderId: string;
  query: string;
  now: string;
  context: PersonalContext;
};

export type RetrievedEvidence = {
  sourceId: string;
  eventId?: string;
  createdAt: string;
  summary: string;
  transcriptQuote?: string;
  score: number;
  canPlayAudio: boolean;
  retrievalSource: "postgres" | "mem0" | "context_link" | "graphiti";
};

export interface ModelGateway {
  transcribe(audio: Uint8Array): Promise<TranscriptionResult>;
  generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan>;
  planElderTurn(input: PlanElderTurnInput): Promise<ElderTurnPlan>;
  parseMemoryQuery(input: ParseMemoryQueryInput): Promise<ParsedMemoryQuery>;
  generateMemoryAnswer(input: GenerateMemoryAnswerInput): Promise<MemoryAnswer>;
}

export class NotImplementedModelGateway implements ModelGateway {
  async transcribe(): Promise<TranscriptionResult> {
    throw new Error("ModelGateway.transcribe is not implemented");
  }

  async generateMemoryPlan(): Promise<MemoryPlan> {
    throw new Error("ModelGateway.generateMemoryPlan is not implemented");
  }

  async planElderTurn(): Promise<ElderTurnPlan> {
    throw new Error("ModelGateway.planElderTurn is not implemented");
  }

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    throw new Error("ModelGateway.parseMemoryQuery is not implemented");
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    throw new Error("ModelGateway.generateMemoryAnswer is not implemented");
  }
}

export type ModelGatewayErrorCode =
  | "provider_error"
  | "schema_validation_error"
  | "empty_evidence_error"
  | "unsafe_output_error";

export class ModelGatewayError extends Error {
  constructor(
    readonly code: ModelGatewayErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  transcriptionModel?: string;
  promptsDir?: string;
  promptVersion?: string;
  timeoutMs?: number;
};

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly promptVersion: string;

  constructor(private readonly options: OpenAIModelGatewayOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 15_000,
      maxRetries: 0,
    });
    this.promptVersion = options.promptVersion ?? "v1";
  }

  async transcribe(audio: Uint8Array): Promise<TranscriptionResult> {
    try {
      const file = new File([Buffer.from(audio)], "audio.wav", { type: "audio/wav" });
      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: this.options.transcriptionModel ?? "whisper-1",
        response_format: "json",
      });

      return {
        text: transcription.text,
      };
    } catch (error) {
      throw new ModelGatewayError("provider_error", "OpenAI transcription failed", error);
    }
  }

  async generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan> {
    const prompt = await this.loadPrompt("extract-memory-plan.md");
    const result = await this.completeJson(prompt, {
      ...input,
      promptVersion: this.promptVersion,
    });
    const normalized = normalizeMemoryPlanResult(result, input, this.options.model, this.promptVersion);

    try {
      return MemoryPlanSchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI MemoryPlan output failed schema validation", error);
    }
  }

  async planElderTurn(input: PlanElderTurnInput): Promise<ElderTurnPlan> {
    const prompt = await this.loadPrompt("elder-turn.md");
    const result = await this.completeJson(prompt, input);
    const normalized = normalizeElderTurnPlanResult(result, input);

    try {
      return ElderTurnPlanSchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI elder turn output failed schema validation", error);
    }
  }

  async parseMemoryQuery(input: ParseMemoryQueryInput): Promise<ParsedMemoryQuery> {
    const prompt = await this.loadPrompt("query-memory.md");
    const result = await this.completeJson(prompt, input);
    const normalized = normalizeParsedMemoryQueryResult(result, input);

    try {
      return ParsedMemoryQuerySchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI query parse output failed schema validation", error);
    }
  }

  async generateMemoryAnswer(input: GenerateMemoryAnswerInput): Promise<MemoryAnswer> {
    if (input.evidence.length === 0) {
      throw new ModelGatewayError("empty_evidence_error", "Cannot generate memory answer without evidence");
    }

    const prompt = await this.loadPrompt("answer-memory-query.md");
    const result = await this.completeJson(prompt, input);
    const normalized = normalizeMemoryAnswerResult(result, input);

    try {
      return MemoryAnswerSchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI answer output failed schema validation", error);
    }
  }

  private async completeJson(systemPrompt: string, input: unknown): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(input) },
        ],
      });

      const content = response.choices[0]?.message.content;
      if (!content) {
        throw new ModelGatewayError("provider_error", "OpenAI returned an empty response");
      }

      return JSON.parse(content) as unknown;
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("provider_error", "OpenAI JSON completion failed", error);
    }
  }

  private async loadPrompt(filename: string): Promise<string> {
    const promptsDir = this.options.promptsDir ?? join(process.cwd(), "prompts");
    return readFile(join(promptsDir, filename), "utf8");
  }
}
