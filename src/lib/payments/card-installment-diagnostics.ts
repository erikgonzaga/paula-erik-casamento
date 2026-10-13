// Temporary TEST UI projection. Never retain or render the raw SDK response.
export type InstallmentOffer = {
  payment_method_id: string | null;
  issuer_id: string | null;
  issuer_name: string | null;
  installments: number;
  installment_rate: number | null;
  installment_amount: number | null;
  total_amount: number | null;
  discount_rate: number | null;
  installment_rate_collector: string[];
  labels: string[];
  payment_method_option_id: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeText(value: unknown, bin?: string): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) value = String(value);
  if (typeof value !== 'string' || !value.trim() || value.length > 128 ||
      /[\u0000-\u001f\u007f@]|https?:\/\/|\d{13,}/i.test(value) || (bin && value.includes(bin))) return null;
  return value.trim();
}

function numeric(value: unknown): number | null {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
}

function textList(value: unknown, bin?: string): string[] {
  return Array.isArray(value) ? value.slice(0, 20).flatMap(entry => {
    const text = safeText(entry, bin);
    return text === null ? [] : [text];
  }) : [];
}

export function sanitizeInstallmentOffers(value: unknown, bin?: string): InstallmentOffer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(entry => {
    const method = record(entry);
    const issuer = record(method.issuer);
    return (Array.isArray(method.payer_costs) ? method.payer_costs.slice(0, 36) : []).flatMap(entry => {
      const cost = record(entry);
      const installments = numeric(cost.installments);
      if (installments === null || !Number.isInteger(installments) || installments < 1 || installments > 36) return [];
      return [{
        payment_method_id: safeText(method.payment_method_id, bin),
        issuer_id: safeText(issuer.id, bin),
        issuer_name: safeText(issuer.name, bin),
        installments,
        installment_rate: numeric(cost.installment_rate),
        installment_amount: numeric(cost.installment_amount),
        total_amount: numeric(cost.total_amount),
        discount_rate: numeric(cost.discount_rate),
        installment_rate_collector: textList(cost.installment_rate_collector, bin),
        labels: textList(cost.labels, bin),
        payment_method_option_id: safeText(cost.payment_method_option_id, bin),
      }];
    });
  });
}

export function formatInstallmentMoney(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatInstallmentRate(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value)}%`;
}
