const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatGiftAmount(amount: number | null) {
  return amount === null ? 'Contribuição livre' : currency.format(amount);
}

// Compact whole-real values, without discarding cents when they exist.
export function formatGoalAmount(amount: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatGiftPercentage(percentage: number) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(percentage)}%`;
}
