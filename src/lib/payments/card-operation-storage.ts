// References only. Financial state and all checkout data come from the backend.
export type CardOperationReference = { version: 1; gift_id: string; key: string; created_at: string };
export const cardReferencePrefix = 'pe:card-operation:v1:';
export const cardReferenceRetentionMs = 30 * 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCardReference(giftId: string): CardOperationReference | null {
  const raw = window.localStorage.getItem(cardReferencePrefix + giftId);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || value.gift_id !== giftId || !uuid.test(value.key) ||
      typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
      Object.keys(value).sort().join(',') !== 'created_at,gift_id,key,version') throw new Error('invalid_card_reference');
  return value;
}

// Web Locks serialize selection AND sending across tabs. No racy storage lease
// fallback: unsupported browsers can follow an operation but cannot submit cards.
export async function withCardOperation<T>(giftId: string,
  action: (reference: CardOperationReference, created: boolean) => Promise<T>): Promise<T> {
  if (!navigator.locks || !uuid.test(giftId)) throw new Error('card_coordination_unavailable');
  return navigator.locks.request(cardReferencePrefix + giftId, async () => {
    let reference = readCardReference(giftId);
    const created = !reference;
    if (!reference) {
      reference = { version: 1, gift_id: giftId, key: crypto.randomUUID(), created_at: new Date().toISOString() };
      window.localStorage.setItem(cardReferencePrefix + giftId, JSON.stringify(reference));
      if (readCardReference(giftId)?.key !== reference.key) throw new Error('card_storage_unavailable');
    }
    return action(reference, created);
  });
}

// Call only after an authoritative terminal response. Never age out uncertain
// operations: an old reference still needs a status check, including after 404.
export async function clearTerminalCardReference(giftId: string, key: string) {
  if (!navigator.locks) throw new Error('card_coordination_unavailable');
  await navigator.locks.request(cardReferencePrefix + giftId, async () => {
    if (readCardReference(giftId)?.key === key) window.localStorage.removeItem(cardReferencePrefix + giftId);
  });
}
