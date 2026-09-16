import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  updateDoc,
  getDocs,
  writeBatch,
  Unsubscribe,
  Firestore,
} from 'firebase/firestore';
import { Book, BookStatus, StoreSettings } from '../types';
import rawConfig from '../../firebase-applet-config.json';

export const firebaseConfig = rawConfig;

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with the provisioned named database
export const db: Firestore = getFirestore(
  app,
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined
);

const BOOKS_COLLECTION = 'books';
const SETTINGS_DOC_ID = 'store_settings';
const CATALOGS_DOC_ID = 'catalog_genres';

/**
 * Subscribe to real-time updates for books catalog.
 * Any admin change (add, edit, status change, delete, toggle featured)
 * triggers instant notification to all active clients.
 */
export function subscribeToBooks(
  onUpdate: (books: Book[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const booksRef = collection(db, BOOKS_COLLECTION);
  return onSnapshot(
    booksRef,
    (snapshot) => {
      const booksList: Book[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const primaryImages = Array.isArray(data.images) && data.images.length > 0
          ? data.images
          : (data.coverUrl ? [data.coverUrl] : []);
        const primaryCover = primaryImages[0] || data.coverUrl || '';

        booksList.push({
          id: docSnap.id,
          title: data.title || 'Sin Título',
          author: data.author || 'Autor Desconocido',
          genre: data.genre || 'General',
          price: Number(data.price) || 0,
          currency: data.currency || 'USD',
          status: data.status || 'disponible',
          featured: Boolean(data.featured),
          coverUrl: primaryCover,
          images: primaryImages.length > 0 ? primaryImages : (primaryCover ? [primaryCover] : []),
          synopsis: data.synopsis || '',
          editorial: data.editorial,
          pages: data.pages ? Number(data.pages) : undefined,
          publishedYear: data.publishedYear ? Number(data.publishedYear) : undefined,
          isbn: data.isbn,
          createdAt: data.createdAt || Date.now(),
        });
      });

      // Sort by creation date descending
      booksList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onUpdate(booksList);
    },
    (err) => {
      console.error('Firebase Books listener error:', err);
      onError?.(err);
    }
  );
}

/**
 * Subscribe to store settings in real-time.
 */
export function subscribeToSettings(
  onUpdate: (settings: StoreSettings) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const settingsDocRef = doc(db, 'settings', SETTINGS_DOC_ID);
  return onSnapshot(
    settingsDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        onUpdate(data);
      }
    },
    (err) => {
      console.error('Firebase Settings listener error:', err);
      onError?.(err);
    }
  );
}

/**
 * Subscribe to catalogs / genres in real-time.
 */
export function subscribeToCatalogs(
  onUpdate: (catalogs: string[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const catalogsDocRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
  return onSnapshot(
    catalogsDocRef,
    (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (Array.isArray(data.items)) {
          onUpdate(data.items);
        }
      }
    },
    (err) => {
      console.error('Firebase Catalogs listener error:', err);
      onError?.(err);
    }
  );
}

/**
 * Save or update a book in Firestore.
 */
export async function saveBookToFirestore(book: Book): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, book.id);
  const dataToSave = {
    ...book,
    updatedAt: Date.now(),
  };
  await setDoc(docRef, dataToSave, { merge: true });
}

/**
 * Delete a book from Firestore.
 */
export async function deleteBookFromFirestore(bookId: string): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  await deleteDoc(docRef);
}

/**
 * Update a book status in Firestore.
 */
export async function updateBookStatusInFirestore(bookId: string, status: BookStatus): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  await updateDoc(docRef, {
    status,
    updatedAt: Date.now(),
  });
}

/**
 * Toggle book featured status in Firestore.
 */
export async function toggleBookFeaturedInFirestore(bookId: string, featured: boolean): Promise<void> {
  const docRef = doc(db, BOOKS_COLLECTION, bookId);
  await updateDoc(docRef, {
    featured,
    updatedAt: Date.now(),
  });
}

/**
 * Save store settings in Firestore.
 */
export async function saveSettingsToFirestore(settings: StoreSettings): Promise<void> {
  const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
  await setDoc(docRef, { ...settings, updatedAt: Date.now() }, { merge: true });
}

/**
 * Save catalogs list in Firestore.
 */
export async function saveCatalogsToFirestore(catalogs: string[]): Promise<void> {
  const docRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
  await setDoc(docRef, { items: catalogs, updatedAt: Date.now() }, { merge: true });
}

/**
 * Initial Seeding: if Firestore collections are empty, populate them with the initial catalogue.
 */
export async function seedFirestoreIfEmpty(
  initialBooks: Book[],
  initialSettings: StoreSettings,
  initialCatalogs: string[]
): Promise<void> {
  try {
    const booksRef = collection(db, BOOKS_COLLECTION);
    const snap = await getDocs(booksRef);

    if (snap.empty && initialBooks.length > 0) {
      console.log('Seeding initial books to Firestore...');
      const batch = writeBatch(db);
      for (const book of initialBooks) {
        const bookDoc = doc(db, BOOKS_COLLECTION, book.id);
        batch.set(bookDoc, { ...book, createdAt: book.createdAt || Date.now() });
      }
      await batch.commit();
      console.log('Books seeded to Firestore successfully.');
    }

    // Seed settings if missing
    const settingsDocRef = doc(db, 'settings', SETTINGS_DOC_ID);
    const settingsSnap = await getDocs(collection(db, 'settings'));
    if (settingsSnap.empty) {
      await setDoc(settingsDocRef, { ...initialSettings, updatedAt: Date.now() });
    }

    // Seed catalogs if missing
    const catalogsSnap = await getDocs(collection(db, 'catalogs'));
    if (catalogsSnap.empty) {
      const catalogsDocRef = doc(db, 'catalogs', CATALOGS_DOC_ID);
      await setDoc(catalogsDocRef, { items: initialCatalogs, updatedAt: Date.now() });
    }
  } catch (err) {
    console.warn('Firestore seeding check skipped or failed:', err);
  }
}
