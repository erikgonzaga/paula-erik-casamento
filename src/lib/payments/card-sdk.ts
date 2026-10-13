export type BrickController = { unmount(): void | Promise<void> };
export type BrickSettings = {
  initialization: { amount: number; payer: { email: string } };
  customization: { paymentMethods: { types: { excluded: string[] }; minInstallments: number; maxInstallments: number };
    visual: { style: { theme: 'flat' } } };
  callbacks: { onReady(): void; onError(): void; onSubmit(data: unknown, additional: unknown): Promise<void>;
    onBinChange?(bin: unknown): void };
};
export type BrickBuilder = { create(type: 'cardPayment', id: string, settings: BrickSettings): Promise<BrickController> };
type CardSdk = { bricks(): BrickBuilder;
  getInstallments(input: { amount: string; bin: string; locale: 'pt-BR' }): Promise<unknown> };
type MercadoPagoConstructor = new (key: string, settings: { locale: 'pt-BR' }) => CardSdk;

let instance: Promise<CardSdk> | undefined;
function loadCardSdk(): Promise<CardSdk> {
  instance ??= (async () => {
    const key = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY;
    if (!key?.trim()) throw new Error('card_checkout_unavailable');
    const { loadMercadoPago } = await import('@mercadopago/sdk-js');
    await loadMercadoPago();
    const sdk = window as unknown as { MercadoPago?: MercadoPagoConstructor };
    if (!sdk.MercadoPago) throw new Error('card_checkout_unavailable');
    return new sdk.MercadoPago(key, { locale: 'pt-BR' });
  })();
  return instance;
}

let builder: Promise<BrickBuilder> | undefined;
export function loadCardBrickBuilder(): Promise<BrickBuilder> {
  builder ??= loadCardSdk().then(sdk => sdk.bricks());
  return builder;
}

// Browser-only, read-only diagnostic. Reuses the Brick's SDK instance.
export async function getCardInstallments(amount: number, bin: string): Promise<unknown> {
  if (!Number.isFinite(amount) || amount <= 0 || !/^(?:\d{6}|\d{8})$/.test(bin)) {
    throw new Error('installment_diagnostic_unavailable');
  }
  const sdk = await loadCardSdk();
  return sdk.getInstallments({ amount: String(amount), bin, locale: 'pt-BR' });
}

export function cardDeviceId(): unknown {
  return (window as unknown as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID;
}
