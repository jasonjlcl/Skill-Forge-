import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { z } from 'zod';
import type { QuizQuestionDraft, SkillLevel } from '../domain/types.js';
import { env } from '../config/env.js';
import { skillPromptGuide } from './profiling.js';
import type { RetrievedChunk } from './vectorStore.js';

const quizSchema = z.array(
  z.object({
    prompt: z.string().min(5),
    type: z.enum(['multiple_choice', 'short_answer']),
    options: z.array(z.string()).optional(),
    answerKey: z.string().min(1),
    explanation: z.string().min(5),
  }),
);

const toContextText = (chunks: RetrievedChunk[]): string =>
  chunks
    .map((chunk, index) => `[${index + 1}] (${chunk.source}) ${chunk.text}`)
    .join('\n');

const cleanJsonText = (raw: string): string => {
  const match = raw.match(/```json([\s\S]*?)```/i);
  if (match) {
    return match[1].trim();
  }
  return raw.trim();
};

export interface LlmClient {
  generateAssistance(input: {
    question: string;
    language: string;
    skillLevel: SkillLevel;
    module: string;
    contextChunks: RetrievedChunk[];
  }): Promise<{ answer: string }>;
  generateQuiz(input: {
    topic: string;
    language: string;
    skillLevel: SkillLevel;
    contextChunks: RetrievedChunk[];
  }): Promise<QuizQuestionDraft[]>;
  explainWhy(input: {
    question: string;
    answer: string;
    language: string;
    contextChunks: RetrievedChunk[];
  }): Promise<string>;
}

export class GeminiLlmClient implements LlmClient {
  private readonly gemini = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;
  private readonly openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

  private async runModel(systemPrompt: string, prompt: string): Promise<string | null> {
    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const response = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
        });

        return response.response.text().trim();
      } catch {
        // fall through to OpenAI/local fallback
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        });

        return response.choices[0]?.message?.content?.trim() ?? null;
      } catch {
        return null;
      }
    }

    return null;
  }

  async generateAssistance(input: {
    question: string;
    language: string;
    skillLevel: SkillLevel;
    module: string;
    contextChunks: RetrievedChunk[];
  }): Promise<{ answer: string }> {
    const context = toContextText(input.contextChunks);
    const systemPrompt = [
      'You are a manufacturing training assistant for SME factory workers.',
      `Respond in language code: ${input.language}.`,
      skillPromptGuide(input.skillLevel),
      'Provide actionable guidance first, then a short reason section prefixed with "Why:".',
      'If the context is insufficient, say what is missing and still provide a safe next step.',
    ].join(' ');

    const prompt = [
      `Module: ${input.module}`,
      `Worker question: ${input.question}`,
      'Retrieved training context:',
      context || 'No retrieved context found.',
      'Answer with 2-5 concise bullet points plus one brief "Why:" paragraph.',
    ].join('\n\n');

    const generated = await this.runModel(systemPrompt, prompt);
    if (generated) {
      return { answer: generated };
    }

    const fallbackContext =
      input.contextChunks[0]?.text ??
      'Follow lockout/tagout procedures, confirm PPE, and escalate to a supervisor when uncertain.';

    return {
      answer:
        `1) Review the relevant SOP step for ${input.module}.\n` +
        '2) Perform the task in sequence and confirm each safety checkpoint.\n' +
        '3) If a machine behaves unexpectedly, stop and escalate before continuing.\n' +
        `Why: This guidance aligns with your request and the available training context: ${fallbackContext}`,
    };
  }

  async generateQuiz(input: {
    topic: string;
    language: string;
    skillLevel: SkillLevel;
    contextChunks: RetrievedChunk[];
  }): Promise<QuizQuestionDraft[]> {
    const context = toContextText(input.contextChunks);
    const systemPrompt = [
      'You generate structured factory-training quizzes.',
      `Respond in language code: ${input.language}.`,
      skillPromptGuide(input.skillLevel),
      'Output only valid JSON with an array of 3 to 5 questions.',
      'Each question must include prompt, type, options(optional for short answers), answerKey, explanation.',
      'Use "multiple_choice" or "short_answer" values for type.',
    ].join(' ');

    const prompt = [
      `Topic: ${input.topic}`,
      'Retrieved context:',
      context || 'No context found.',
      'Generate questions that test procedural understanding and safety judgment.',
      'For multiple choice, answerKey should be the option letter (A/B/C/D).',
    ].join('\n\n');

    const generated = await this.runModel(systemPrompt, prompt);
    if (generated) {
      try {
        const parsed = quizSchema.safeParse(JSON.parse(cleanJsonText(generated)));
        if (parsed.success && parsed.data.length >= 3) {
          return parsed.data.map((question) => ({
            ...question,
            options: question.type === 'multiple_choice' ? question.options ?? [] : undefined,
          }));
        }
      } catch {
        // fall through to deterministic fallback quiz
      }
    }

    const fallback: QuizQuestionDraft[] = [
      {
        prompt: `What is the first action before starting a ${input.topic} task?`,
        type: 'multiple_choice',
        options: [
          'A) Skip checks to save time',
          'B) Verify PPE and safety status',
          'C) Ask maintenance to run it',
          'D) Start machine immediately',
        ],
        answerKey: 'B',
        explanation: 'Safety checks and PPE verification always come before machine operation.',
      },
      {
        prompt: `Name one reason lockout/tagout is important in ${input.topic}.`,
        type: 'short_answer',
        answerKey: 'prevents unexpected machine startup',
        explanation: 'Lockout/tagout controls hazardous energy and prevents accidental activation.',
      },
      {
        prompt: `When quality readings are out of tolerance, what should you do first?`,
        type: 'multiple_choice',
        options: [
          'A) Continue production',
          'B) Disable all alarms',
          'C) Stop and report per SOP',
          'D) Ignore one-time deviations',
        ],
        answerKey: 'C',
        explanation: 'Out-of-tolerance readings require immediate SOP-based containment and escalation.',
      },
    ];

    return fallback;
  }

  async explainWhy(input: {
    question: string;
    answer: string;
    language: string;
    contextChunks: RetrievedChunk[];
  }): Promise<string> {
    const context = toContextText(input.contextChunks);
    const systemPrompt = [
      'You provide transparent reasoning for manufacturing training answers.',
      `Respond in language code: ${input.language}.`,
      'Be concise, factual, and grounded in provided context.',
    ].join(' ');

    const prompt = JSON.stringify(
      {
        task: 'explain_reasoning',
        question: input.question,
        answer: input.answer,
        context,
      },
      null,
      2,
    );

    const generated = await this.runModel(systemPrompt, prompt);
    if (generated) {
      return generated;
    }

    return 'The response prioritized safety and SOP compliance, then selected actions supported by the retrieved training snippets.';
  }
}

let activeLlm: LlmClient | null = null;

export const getLlmClient = (): LlmClient => {
  if (!activeLlm) {
    activeLlm = new GeminiLlmClient();
  }
  return activeLlm;
};

export const setLlmClient = (client: LlmClient): void => {
  activeLlm = client;
};
