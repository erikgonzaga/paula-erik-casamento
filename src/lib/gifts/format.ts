const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatGiftPrice(price: number) {
  return currency.format(price);
}
