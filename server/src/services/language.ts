const LANGUAGE_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'es', pattern: /[¿¡]|\b(hola|gracias|seguridad|maquina|calidad)\b/i },
  { code: 'fr', pattern: /\b(bonjour|merci|sécurité|machine|qualité)\b/i },
  { code: 'de', pattern: /\b(hallo|danke|sicherheit|maschine|qualität)\b/i },
  { code: 'pt', pattern: /\b(olá|obrigado|segurança|máquina|qualidade)\b/i },
  { code: 'hi', pattern: /[\u0900-\u097F]/ },
  { code: 'zh', pattern: /[\u4e00-\u9fff]/ },
];

export const detectLanguage = (text: string): string | null => {
  for (const { code, pattern } of LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return code;
    }
  }

  return null;
};

export const normalizeLanguage = (language: string | undefined): string => {
  if (!language) {
    return 'en';
  }

  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return 'en';
  }

  if (normalized.length === 2) {
    return normalized;
  }

  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  if (normalized.startsWith('fr')) return 'fr';
  if (normalized.startsWith('de')) return 'de';
  if (normalized.startsWith('pt')) return 'pt';
  if (normalized.startsWith('hi')) return 'hi';
  if (normalized.startsWith('zh')) return 'zh';

  return 'en';
};
