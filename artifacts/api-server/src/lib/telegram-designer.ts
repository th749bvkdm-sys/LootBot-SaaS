export type TelegramDesignerSettings = {
  welcomeMessage: string;
  helpMessage: string;
  catalogIntro: string;
  showStock: boolean;
};

export const DEFAULT_TELEGRAM_DESIGNER: TelegramDesignerSettings = {
  welcomeMessage: "",
  helpMessage: "",
  catalogIntro: "",
  showStock: true,
};

export function parseTelegramDesignerSettings(value: unknown): TelegramDesignerSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const textKeys = ["welcomeMessage", "helpMessage", "catalogIntro"] as const;
  if (textKeys.some((key) => typeof item[key] !== "string" || (item[key] as string).length > 400)) return null;
  if (typeof item.showStock !== "boolean") return null;
  return {
    welcomeMessage: (item.welcomeMessage as string).trim(),
    helpMessage: (item.helpMessage as string).trim(),
    catalogIntro: (item.catalogIntro as string).trim(),
    showStock: item.showStock,
  };
}

export function readTelegramDesignerSettings(value: unknown): TelegramDesignerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_TELEGRAM_DESIGNER;
  const settings = (value as Record<string, unknown>).telegramDesigner;
  return parseTelegramDesignerSettings(settings) ?? DEFAULT_TELEGRAM_DESIGNER;
}
