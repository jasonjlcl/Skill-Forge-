import type { SkillLevel } from '../domain/types.js';

export const skillPromptGuide = (skillLevel: SkillLevel): string => {
  switch (skillLevel) {
    case 'advanced':
      return 'Use concise, technical guidance with standards, edge cases, and optimization tips.';
    case 'intermediate':
      return 'Use practical step-by-step instructions with short rationale and checks.';
    case 'beginner':
    default:
      return 'Use plain language, short steps, and define jargon before using it.';
  }
};

export const deriveSkillLevel = (averageQuizScore: number): SkillLevel => {
  if (averageQuizScore >= 85) {
    return 'advanced';
  }

  if (averageQuizScore >= 60) {
    return 'intermediate';
  }

  return 'beginner';
};
