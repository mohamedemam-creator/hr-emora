const DB_NAME = 'selin-ios-secure'
const STORE_NAME = 'device'
const KEY_RECORD = 'device-key'

export type IosWebKey = {
  browserId: string
  publicKeySpki: string
  privateKey: CryptoKey
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of array) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve((request.result as T) ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function dbSet(key: string, value: unknown) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function isIosBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const classicIos = /iPhone|iPad|iPod/i.test(ua)
  const ipadDesktopMode =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classicIos || ipadDesktopMode
}

export async function getExistingIosWebKey(
  allowNonIos = false,
): Promise<IosWebKey | null> {
  if (
    (!isIosBrowser() && !allowNonIos) ||
    !window.crypto?.subtle ||
    !window.indexedDB
  ) return null
  const stored = await dbGet<{
    browserId: string
    publicKeySpki: string
    privateKey: CryptoKey
  }>(KEY_RECORD)
  if (!stored?.browserId || !stored?.publicKeySpki || !stored.privateKey) return null
  return stored
}

export async function ensureIosWebKey(
  allowNonIos = false,
): Promise<IosWebKey> {
  const existing = await getExistingIosWebKey(allowNonIos)
  if (existing) return existing

  if (!isIosBrowser() && !allowNonIos) {
    throw new Error('الحضور من المتصفح غير مصرح لهذا الحساب.')
  }
  if (!window.crypto?.subtle || !window.indexedDB) {
    throw new Error('المتصفح الحالي لا يدعم التخزين الآمن المطلوب للحضور.')
  }

  const generated = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )

  const publicSpki = await crypto.subtle.exportKey('spki', generated.publicKey)
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', generated.privateKey)

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privatePkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const value: IosWebKey = {
    browserId: crypto.randomUUID(),
    publicKeySpki: bytesToBase64(publicSpki),
    privateKey,
  }

  await dbSet(KEY_RECORD, value)
  return value
}

export async function signIosPayload(
  privateKey: CryptoKey,
  payload: string,
) {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(payload),
  )
  return bytesToBase64(signature)
}

export function makeSignedPayload(
  action: string,
  browserId: string,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    action,
    browserId,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    ...extra,
  })
}
