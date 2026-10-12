const API_KEY = "api_key";
const BASE_URL = "base_url";
const MODEL = "model";
const PROVIDER = "chat_provider";
const ANTHROPIC_API_KEY = "anthropic_api_key";
const ANTHROPIC_MODEL = "anthropic_model";
const CHAT_CAMERAS = "chat_cameras";

/**
 * - openai: any OpenAI compatible API (OpenAI, Ollama, custom), configured by
 *   API key, base URL and model.
 * - anthropic: the Claude API. Its key and model are kept apart from the
 *   OpenAI ones, so switching between the two loses neither.
 */
export type ChatProvider = "openai" | "anthropic";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-nano";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export function getProviderFromLocalStorage(): ChatProvider {
  return localStorage.getItem(PROVIDER) === "anthropic" ? "anthropic" : "openai";
}

export function setProviderToLocalStorage(provider: ChatProvider) {
  localStorage.setItem(PROVIDER, provider);
}

export function getApiKeyFromLocalStorage(): string {
  return localStorage.getItem(API_KEY) || "";
}

export function setApiKeyToLocalStorage(key: string) {
  localStorage.setItem(API_KEY, key);
}

export function getBaseURLFromLocalStorage(): string {
  return localStorage.getItem(BASE_URL) || "";
}

export function setBaseURLToLocalStorage(url: string) {
  localStorage.setItem(BASE_URL, url);
}

export function getAnthropicApiKeyFromLocalStorage(): string {
  return localStorage.getItem(ANTHROPIC_API_KEY) || "";
}

export function setAnthropicApiKeyToLocalStorage(key: string) {
  localStorage.setItem(ANTHROPIC_API_KEY, key);
}

export function getAnthropicModelFromLocalStorage(): string {
  return localStorage.getItem(ANTHROPIC_MODEL) || "";
}

export function setAnthropicModelToLocalStorage(model: string) {
  localStorage.setItem(ANTHROPIC_MODEL, model);
}

function systemPromptKey(robotName?: string) {
  return robotName ? `system_prompt_${robotName}` : "system_prompt";
}

export function getSystemPromptFromLocalStorage(robotName?: string): string {
  return localStorage.getItem(systemPromptKey(robotName)) || "";
}

export function setSystemPromptToLocalStorage(
  prompt: string,
  robotName?: string
) {
  localStorage.setItem(systemPromptKey(robotName), prompt);
}

export function getModelFromLocalStorage(): string {
  return localStorage.getItem(MODEL) || "";
}

export function setModelToLocalStorage(model: string) {
  localStorage.setItem(MODEL, model);
}

/** Names of the cameras whose snapshots go with each chat message. */
export function getChatCamerasFromLocalStorage(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_CAMERAS) ?? "[]");
    return Array.isArray(stored) ? stored.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

export function setChatCamerasToLocalStorage(names: string[]) {
  localStorage.setItem(CHAT_CAMERAS, JSON.stringify(names));
}

// 后续可以添加更多设置项的 get/set 方法
