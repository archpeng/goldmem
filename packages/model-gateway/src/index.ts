import type { MemoryAnswer, MemoryPlan, ParsedMemoryQuery } from "@goldmem/memory-schema";

export type TranscriptionResult = {
  text: string;
  confidence?: number;
  language?: string;
};

export type GenerateMemoryPlanInput = {
  transcript: string;
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

export type ParseMemoryQueryInput = {
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
};

export type PersonalContext = {
  elderProfile?: Record<string, unknown>;
  recentEvents: Array<{ title: string; summary: string; createdAt: string }>;
  semanticMemories: Array<{ memory: string; score?: number }>;
  knownEntities: Array<{ type: string; name: string; aliases?: string[] }>;
  familyRelations: Array<{ name: string; relationship: string; userId?: string }>;
  safetyPolicy: string[];
};

export interface ModelGateway {
  transcribe(audio: Uint8Array): Promise<TranscriptionResult>;
  generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan>;
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

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    throw new Error("ModelGateway.parseMemoryQuery is not implemented");
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    throw new Error("ModelGateway.generateMemoryAnswer is not implemented");
  }
}
