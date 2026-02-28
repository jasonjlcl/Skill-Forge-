import type { RetrievedChunk } from './vectorStore.js';

export type SafetyCategory =
  | 'dangerous_instructions'
  | 'self_harm'
  | 'violence'
  | 'hate'
  | 'sexual'
  | 'illegal_activity';

export type SafetyDecision = 'allow' | 'reframe' | 'block';
export type ContextTrustLevel = 'high' | 'medium' | 'low';

interface OutputRule {
  category: SafetyCategory;
  decision: Exclude<SafetyDecision, 'allow'>;
  patterns: RegExp[];
}

const OUTPUT_RULES: OutputRule[] = [
  {
    category: 'dangerous_instructions',
    decision: 'reframe',
    patterns: [
      /\bbypass\b.*\b(guard|safety|interlock|alarm|lockout|tagout)\b/i,
      /\bdisable\b.*\b(guard|safety|interlock|alarm)\b/i,
      /\bignore\b.*\b(safety|ppe|lockout|tagout|supervisor)\b/i,
      /\btamper\b.*\b(guard|sensor|interlock|alarm)\b/i,
    ],
  },
  {
    category: 'self_harm',
    decision: 'block',
    patterns: [/\b(suicide|kill myself|hurt myself|self-harm)\b/i],
  },
  {
    category: 'violence',
    decision: 'block',
    patterns: [/\b(build|make)\b.*\b(bomb|explosive|weapon)\b/i, /\bhow to\b.*\bkill\b/i],
  },
  {
    category: 'hate',
    decision: 'block',
    patterns: [/\b(ethnic cleansing|hate crime|racial superiority)\b/i],
  },
  {
    category: 'sexual',
    decision: 'block',
    patterns: [/\bsexually explicit\b/i, /\bchild sexual\b/i],
  },
  {
    category: 'illegal_activity',
    decision: 'block',
    patterns: [/\b(steal|fraud|counterfeit|sabotage)\b/i],
  },
];

interface ContextRule {
  tag: string;
  pattern: RegExp;
}

const CONTEXT_INJECTION_RULES: ContextRule[] = [
  { tag: 'instruction_override', pattern: /\bignore\b.*\b(previous|prior|above)\b.*\binstructions?\b/i },
  { tag: 'prompt_leakage_request', pattern: /\b(system|developer)\s+prompt\b/i },
  { tag: 'role_hijack', pattern: /\byou are now\b|\bact as\b/i },
  { tag: 'policy_override', pattern: /\bdo not follow\b.*\b(policy|rules?|instructions?)\b/i },
  { tag: 'secret_exfiltration', pattern: /\b(reveal|print|show)\b.*\b(secret|token|password|api key)\b/i },
  { tag: 'script_injection', pattern: /<script\b|javascript:/i },
];

const SAFETY_POLICY_VERSION = 'v1';

const stripControlChars = (value: string): string => {
  let sanitized = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    if ((code >= 32 && code !== 127) || isAllowedWhitespace) {
      sanitized += char;
    } else {
      sanitized += ' ';
    }
  }
  return sanitized;
};

const normalizeLine = (line: string): string => stripControlChars(line).trim();

const evaluateOutputFlags = (text: string): { categories: SafetyCategory[]; decision: SafetyDecision } => {
  const categories: SafetyCategory[] = [];
  let decision: SafetyDecision = 'allow';

  for (const rule of OUTPUT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      categories.push(rule.category);
      if (rule.decision === 'block') {
        decision = 'block';
      } else if (decision === 'allow') {
        decision = 'reframe';
      }
    }
  }

  return { categories, decision };
};

const chooseTrustLevel = (source: string, riskTags: string[]): ContextTrustLevel => {
  if (riskTags.length > 0) {
    return 'low';
  }

  if (/\.(md|markdown|txt|pdf)$/i.test(source) || source.startsWith('docs/') || source.startsWith('training/')) {
    return 'high';
  }

  return 'medium';
};

export interface ModerationResult {
  categories: SafetyCategory[];
  decision: SafetyDecision;
  policyVersion: string;
  text: string;
}

export interface ModerationInput {
  answer: string;
  module?: string;
}

export const moderateAssistantOutput = (input: ModerationInput): ModerationResult => {
  const { categories, decision } = evaluateOutputFlags(input.answer);

  if (decision === 'allow') {
    return {
      categories: [],
      decision,
      policyVersion: SAFETY_POLICY_VERSION,
      text: input.answer,
    };
  }

  if (decision === 'block') {
    return {
      categories,
      decision,
      policyVersion: SAFETY_POLICY_VERSION,
      text: [
        "I can't provide that.",
        'I can help with safe, policy-compliant workplace guidance instead:',
        `1) Follow approved SOP steps for ${input.module ?? 'the task'}.`,
        '2) Keep PPE and lockout/tagout controls in place.',
        '3) Escalate to a supervisor if anything is unclear or unsafe.',
      ].join('\n'),
    };
  }

  return {
    categories,
    decision,
    policyVersion: SAFETY_POLICY_VERSION,
    text: [
      "I can't help with bypassing or disabling safety controls.",
      `Use this safe approach for ${input.module ?? 'the task'}:`,
      '1) Stop work and restore all required guards/interlocks.',
      '2) Follow lockout/tagout and PPE requirements.',
      '3) Continue only after supervisor-approved SOP checks pass.',
    ].join('\n'),
  };
};

export interface SanitizedRetrievedChunk extends RetrievedChunk {
  trustLevel: ContextTrustLevel;
  riskTags: string[];
  wasSanitized: boolean;
}

export const sanitizeRetrievedContext = (chunks: RetrievedChunk[]): SanitizedRetrievedChunk[] => {
  return chunks.map((chunk) => {
    const riskTags = new Set<string>();
    const keptLines: string[] = [];

    for (const rawLine of chunk.text.split(/\r?\n/)) {
      const line = normalizeLine(rawLine);
      if (!line) {
        continue;
      }

      let flagged = false;
      for (const rule of CONTEXT_INJECTION_RULES) {
        if (rule.pattern.test(line)) {
          riskTags.add(rule.tag);
          flagged = true;
        }
      }

      if (!flagged) {
        keptLines.push(line);
      }
    }

    const tags = [...riskTags];
    const sanitizedText = keptLines.join('\n').trim() || '[Context removed by safety policy]';
    const wasSanitized = tags.length > 0 || sanitizedText !== chunk.text;
    const trustLevel = chooseTrustLevel(chunk.source, tags);

    return {
      ...chunk,
      text: sanitizedText,
      riskTags: tags,
      trustLevel,
      wasSanitized,
    };
  });
};

export const getSafetyPolicyVersion = (): string => SAFETY_POLICY_VERSION;
