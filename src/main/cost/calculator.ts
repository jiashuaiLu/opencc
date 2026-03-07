export interface ModelPricing {
  modelId: string;
  modelName: string;
  provider: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  cacheCreationPricePer1k?: number;
  cacheReadPricePer1k?: number;
  currency: string;
  updatedAt: string;
}

export const defaultPricing: ModelPricing[] = [
  {
    modelId: 'claude-3-5-sonnet-20241022',
    modelName: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    cacheCreationPricePer1k: 0.00375,
    cacheReadPricePer1k: 0.0003,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'claude-3-5-haiku-20241022',
    modelName: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    inputPricePer1k: 0.001,
    outputPricePer1k: 0.005,
    cacheCreationPricePer1k: 0.00125,
    cacheReadPricePer1k: 0.0001,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'claude-3-opus-20240229',
    modelName: 'Claude 3 Opus',
    provider: 'Anthropic',
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    cacheCreationPricePer1k: 0.01875,
    cacheReadPricePer1k: 0.0015,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'gpt-4o',
    modelName: 'GPT-4o',
    provider: 'OpenAI',
    inputPricePer1k: 0.005,
    outputPricePer1k: 0.015,
    cacheCreationPricePer1k: 0.00625,
    cacheReadPricePer1k: 0.0005,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'gpt-4o-mini',
    modelName: 'GPT-4o Mini',
    provider: 'OpenAI',
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'gpt-4-turbo',
    modelName: 'GPT-4 Turbo',
    provider: 'OpenAI',
    inputPricePer1k: 0.01,
    outputPricePer1k: 0.03,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'deepseek-chat',
    modelName: 'DeepSeek Chat',
    provider: 'DeepSeek',
    inputPricePer1k: 0.00014,
    outputPricePer1k: 0.00028,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'deepseek-coder',
    modelName: 'DeepSeek Coder',
    provider: 'DeepSeek',
    inputPricePer1k: 0.00014,
    outputPricePer1k: 0.00028,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'gemini-2.0-flash-exp',
    modelName: 'Gemini 2.0 Flash',
    provider: 'Google',
    inputPricePer1k: 0,
    outputPricePer1k: 0,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
  {
    modelId: 'gemini-1.5-pro',
    modelName: 'Gemini 1.5 Pro',
    provider: 'Google',
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.005,
    currency: 'USD',
    updatedAt: '2025-01-15',
  },
];

export class CostCalculator {
  private pricing: ModelPricing[];

  constructor(customPricing?: ModelPricing[]) {
    this.pricing = customPricing || defaultPricing;
  }

  calculateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number
  ): number {
    const modelPricing = this.pricing.find((p) => p.modelId === modelId);
    
    if (!modelPricing) {
      console.warn(`Pricing not found for model: ${modelId}`);
      return 0;
    }

    let totalCost = 0;

    totalCost += (inputTokens / 1000) * modelPricing.inputPricePer1k;
    totalCost += (outputTokens / 1000) * modelPricing.outputPricePer1k;

    if (cacheCreationTokens && modelPricing.cacheCreationPricePer1k) {
      totalCost += (cacheCreationTokens / 1000) * modelPricing.cacheCreationPricePer1k;
    }

    if (cacheReadTokens && modelPricing.cacheReadPricePer1k) {
      totalCost += (cacheReadTokens / 1000) * modelPricing.cacheReadPricePer1k;
    }

    return totalCost;
  }

  getModelPricing(modelId: string): ModelPricing | undefined {
    return this.pricing.find((p) => p.modelId === modelId);
  }

  getAllPricing(): ModelPricing[] {
    return this.pricing;
  }

  updatePricing(pricing: ModelPricing[]): void {
    this.pricing = pricing;
  }

  formatCost(cost: number): string {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    if (cost < 1) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }

  estimateMonthlyCost(
    modelId: string,
    dailyInputTokens: number,
    dailyOutputTokens: number
  ): number {
    const monthlyInput = dailyInputTokens * 30;
    const monthlyOutput = dailyOutputTokens * 30;
    return this.calculateCost(modelId, monthlyInput, monthlyOutput);
  }
}
