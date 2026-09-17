const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatGiftAmount(amount: number | null) {
  return amount === null ? 'Contribuição livre' : currency.format(amount);
}
