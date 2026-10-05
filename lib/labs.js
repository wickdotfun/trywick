// Les labos d'IA (OpenRouter) : leur nom depuis le début de l'id d'un modèle
// (« anthropic/claude-sonnet-4.5 »), et leur logo s'il est sur le site (public/brand/ai/).
const LABS = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'x-ai': 'xAI', deepseek: 'DeepSeek', qwen: 'Qwen',
  mistralai: 'Mistral AI', moonshotai: 'Moonshot AI', minimax: 'MiniMax', 'z-ai': 'Z.ai', 'meta-llama': 'Meta',
  nvidia: 'NVIDIA', amazon: 'Amazon', 'bytedance-seed': 'ByteDance Seed', microsoft: 'Microsoft', cohere: 'Cohere',
  perplexity: 'Perplexity', nousresearch: 'Nous Research', baidu: 'Baidu', tencent: 'Tencent', xiaomi: 'Xiaomi',
  'arcee-ai': 'Arcee AI', inception: 'Inception', ibm: 'IBM', liquid: 'Liquid', thudm: 'THUDM', 'aion-labs': 'AionLabs',
};
const LOGOS = { openai: 'openai', anthropic: 'anthropic', google: 'gemini', 'x-ai': 'xai', deepseek: 'deepseek', qwen: 'qwen', mistralai: 'mistral', moonshotai: 'moonshot', minimax: 'minimax', 'z-ai': 'zai', 'meta-llama': 'meta' };
export const labOf = (id) => String(id).split('/')[0];
export const labName = (id) => LABS[labOf(id)] || labOf(id).replace(/(^|-)([a-z])/g, (_, s, c) => `${s ? ' ' : ''}${c.toUpperCase()}`);
export const labLogo = (id) => (LOGOS[labOf(id)] ? `/brand/ai/${LOGOS[labOf(id)]}.svg` : null);
