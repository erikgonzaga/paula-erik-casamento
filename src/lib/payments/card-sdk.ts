export type BrickController = { unmount(): void | Promise<void> };
export type BrickSettings = {
  initialization: { amount: number; payer: { email: string } };
  customization: { paymentMethods: { types: { excluded: string[] }; minInstallments: number; maxInstallments: number };
    visual: { style: { theme: 'flat' } } };
  callbacks: { onReady(): void; onError(): void; onSubmit(data: unknown, additional: unknown): Promise<void> };
};
export type BrickBuilder = { create(type: 'cardPayment', id: string, settings: BrickSettings): Promise<BrickController> };
type MercadoPagoConstructor = new (key: string, settings: { locale: 'pt-BR' }) => { bricks(): BrickBuilder };

let builder: Promise<BrickBuilder> | undefined;
export function loadCardBrickBuilder(): Promise<BrickBuilder> {
  builder ??= (async () => {
    const key = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY;
    if (!key?.trim()) throw new Error('card_checkout_unavailable');
    const { loadMercadoPago } = await import('@mercadopago/sdk-js');
    await loadMercadoPago();
    const sdk = window as unknown as { MercadoPago?: MercadoPagoConstructor };
    if (!sdk.MercadoPago) throw new Error('card_checkout_unavailable');
    return new sdk.MercadoPago(key, { locale: 'pt-BR' }).bricks();
  })();
  return builder;
}

export function cardDeviceId(): unknown {
  return (window as unknown as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID;
}
