import type { QuizQuestion } from '../domain/types.js';

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

export const evaluateQuizAnswer = (question: QuizQuestion, userAnswer: string): boolean => {
  const normalizedUser = normalize(userAnswer);
  const normalizedExpected = normalize(question.answerKey);

  if (question.type === 'multiple_choice') {
    if (normalizedUser === normalizedExpected) {
      return true;
    }

    if (!question.options) {
      return false;
    }

    const optionIndex = question.options.findIndex((option) => normalize(option) === normalizedUser);
    if (optionIndex >= 0) {
      const optionLetter = String.fromCharCode(65 + optionIndex).toLowerCase();
      return optionLetter === normalizedExpected;
    }

    return false;
  }

  const expectedTokens = normalizedExpected.split(' ').filter(Boolean);
  const matches = expectedTokens.filter((token) => normalizedUser.includes(token)).length;
  return expectedTokens.length === 0 ? false : matches / expectedTokens.length >= 0.6;
};
