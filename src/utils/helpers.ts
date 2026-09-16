import { Book, BookStatus, CurrencyCode, StoreSettings } from '../types';
import { BcvRates, calculateBcvBreakdown, formatCurrencyAmount } from '../services/bcvRates';
import { DEFAULT_STORE_SETTINGS } from '../data/initialData';

export function formatPrice(
  amount: number,
  currencySymbolOrCode: string = '$',
  currency?: CurrencyCode
): string {
  const code: CurrencyCode = currency || (currencySymbolOrCode === '€' ? 'EUR' : currencySymbolOrCode === 'Bs.' ? 'VES' : 'USD');
  return formatCurrencyAmount(amount, code, true);
}

export function getStatusDetails(status: BookStatus) {
  switch (status) {
    case 'disponible':
      return {
        label: 'Disponible',
        tagText: 'Disponible',
        fullDescription: 'Disponible para entrega inmediata',
        badgeBg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        dotColor: 'bg-emerald-500',
      };
    case 'bajo_pedido':
      return {
        label: 'Bajo Pedido',
        tagText: 'Bajo Pedido',
        fullDescription: 'Bajo pedido (disponible en 3 a 5 días hábiles)',
        badgeBg: 'bg-amber-50 border-amber-200 text-amber-800',
        dotColor: 'bg-amber-500',
      };
    case 'agotado':
      return {
        label: 'Agotado',
        tagText: 'Agotado',
        fullDescription: 'Agotado temporalmente (puedes consultar reposición)',
        badgeBg: 'bg-stone-100 border-stone-200 text-stone-600',
        dotColor: 'bg-stone-400',
      };
  }
}

export function cleanPhoneNumber(phone?: string): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Normalizes text for search comparison:
 * - Lowercase
 * - Strips accents/tildes (á->a, é->e, í->i, ó->o, ú->u, ü->u, etc.)
 * - Trims and cleans whitespace
 */
export function normalizeSearch(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Checks if a book matches a search query:
 * - Multi-word token matching (all words must be present in the book metadata)
 * - Accent and diacritic insensitive
 * - Matches across title, author, genre, synopsis, editorial, isbn
 */
export function matchBookSearch(book: Book, query: string): boolean {
  if (!query || !query.trim()) return true;

  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const bookSearchableString = normalizeSearch(
    `${book.title || ''} ${book.author || ''} ${book.genre || ''} ${book.synopsis || ''} ${book.editorial || ''} ${book.isbn || ''}`
  );

  return tokens.every((token) => bookSearchableString.includes(token));
}

export function buildWhatsAppMessage(
  book: Book,
  settings?: StoreSettings,
  rates?: BcvRates
): string {
  const safeSettings = settings || DEFAULT_STORE_SETTINGS;
  const statusInfo = getStatusDetails(book.status);
  const template = safeSettings.whatsappTemplate || '¡Hola {tienda}! Me interesa comprar el libro "{titulo}" de {autor}.';
  const currency: CurrencyCode = book.currency || 'USD';
  const priceDisplay = formatPrice(book.price, safeSettings.currencySymbol, currency);

  let bcvPriceDisplay = priceDisplay;
  if (rates && currency !== 'VES') {
    const breakdown = calculateBcvBreakdown(book.price, currency, rates);
    bcvPriceDisplay = `${priceDisplay} (Aprox. ${breakdown.bolivaresFormatted} tasa oficial BCV)`;
  }

  let msg = template
    .replace(/{titulo}/gi, book.title)
    .replace(/{autor}/gi, book.author)
    .replace(/{precio}/gi, bcvPriceDisplay)
    .replace(/{estado}/gi, statusInfo.label)
    .replace(/{tienda}/gi, safeSettings.storeName || 'Books EM')
    .replace(/{genero}/gi, book.genre)
    .replace(/{id}/gi, book.id);

  return msg;
}

export function generateWhatsAppUrl(
  book: Book,
  settings?: StoreSettings,
  rates?: BcvRates
): string {
  const safeSettings = settings || DEFAULT_STORE_SETTINGS;
  const rawNumber = safeSettings.whatsappNumber || '';
  const cleanNumber = cleanPhoneNumber(rawNumber);
  const text = buildWhatsAppMessage(book, safeSettings, rates);

  if (!cleanNumber) {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}

export function generateWishlistWhatsAppUrl(
  books: Book[],
  settings?: StoreSettings,
  rates?: BcvRates
): string {
  const safeSettings = settings || DEFAULT_STORE_SETTINGS;
  const rawNumber = safeSettings.whatsappNumber || '';
  const cleanNumber = cleanPhoneNumber(rawNumber);

  const bookListStr = books
    .map((b, i) => {
      const cur: CurrencyCode = b.currency || 'USD';
      const pStr = formatPrice(b.price, safeSettings.currencySymbol, cur);
      let bcvExtra = '';
      if (rates && cur !== 'VES') {
        const bd = calculateBcvBreakdown(b.price, cur, rates);
        bcvExtra = ` ~ ${bd.bolivaresFormatted} BCV`;
      }
      return `${i + 1}. *${b.title}* - ${b.author} (${pStr}${bcvExtra} | ${getStatusDetails(b.status).label})`;
    })
    .join('\n');

  const text = `¡Hola ${safeSettings.storeName || 'Books EM'}! 👋📚\nEstuve revisando su catálogo y me gustaría cotizar o adquirir los siguientes ${books.length} libros:\n\n${bookListStr}\n\n¿Tienen disponibilidad y cómo procedemos con el pago y envío según tasa oficial BCV? ¡Muchas gracias!`;

  if (!cleanNumber) {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}

/**
 * Fallback image in case an external cover fails to load
 */
export const FALLBACK_BOOK_COVER =
  'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80';

/**
 * High-performance browser canvas compression for uploaded images.
 * Downscales images to max dimensions and compresses to JPEG with 0.82 quality,
 * reducing 3MB-8MB camera files down to ~40KB-75KB.
 * This completely avoids localStorage quota errors and speeds up app performance.
 */
export async function compressImageFile(
  file: File,
  maxWidth = 1080,
  maxHeight = 1440,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    // If it's an SVG, read directly as data URL without rasterizing
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(typeof readerEvent.target?.result === 'string' ? readerEvent.target.result : '');
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        try {
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        } catch {
          resolve(typeof readerEvent.target?.result === 'string' ? readerEvent.target.result : '');
        }
      };

      img.onerror = () => {
        resolve(typeof readerEvent.target?.result === 'string' ? readerEvent.target.result : '');
      };

      img.src = typeof readerEvent.target?.result === 'string' ? readerEvent.target.result : '';
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image to the server so it becomes a permanent public URL (/uploads/...)
 * accessible to all users, visitors, and devices across the web app.
 */
export async function uploadImageToServer(file: File, prefix = 'foto'): Promise<string> {
  // Compress client-side first for fast transfer and optimal sizing (~50-80KB)
  const compressedDataUrl = await compressImageFile(file, 1200, 1600, 0.84);
  if (!compressedDataUrl) {
    return '';
  }

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: compressedDataUrl,
        filename: file.name ? `${prefix}_${file.name}` : prefix,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        return data.url;
      }
    }
  } catch (err) {
    console.warn('Direct image upload to /api/upload failed, using compressed fallback:', err);
  }

  // Graceful fallback to dataUrl if offline or standalone
  return compressedDataUrl;
}

/**
 * Uploads multiple images to the server in parallel.
 */
export async function uploadImagesBatch(files: File[], prefix = 'foto'): Promise<string[]> {
  const results = await Promise.all(
    files.map((file, idx) => uploadImageToServer(file, `${prefix}_${idx + 1}`))
  );
  return results.filter(Boolean);
}


