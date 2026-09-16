import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { INITIAL_BOOKS, DEFAULT_STORE_SETTINGS } from './src/data/initialData';
import { DEFAULT_CATALOGS } from './src/hooks/useBooksStore';
import { Book, StoreSettings } from './src/types';

const PORT = 3000;
const DATA_DIR = path.join(process.cwd(), 'data');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CATALOGS_FILE = path.join(DATA_DIR, 'catalogs.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper to safely read JSON file with fallback
function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return fallback;
}

// Helper to safely write JSON file
function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Initialize files if they don't exist
if (!fs.existsSync(BOOKS_FILE)) {
  writeJsonFile(BOOKS_FILE, INITIAL_BOOKS);
}
if (!fs.existsSync(SETTINGS_FILE)) {
  writeJsonFile(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
}
if (!fs.existsSync(CATALOGS_FILE)) {
  writeJsonFile(CATALOGS_FILE, DEFAULT_CATALOGS);
}

async function startServer() {
  const app = express();

  // Allow high-res base64 images uploads for book gallery (up to 50MB)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes: Health
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // API Routes: Books Catalog
  app.get('/api/books', (_req: Request, res: Response) => {
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    res.json(books);
  });

  app.post('/api/books', (req: Request, res: Response) => {
    const newBookData = req.body;
    if (!newBookData || !newBookData.title || !newBookData.author) {
      res.status(400).json({ error: 'Título y autor son obligatorios' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const images = Array.isArray(newBookData.images) && newBookData.images.length > 0
      ? newBookData.images.filter(Boolean)
      : (newBookData.coverUrl ? [newBookData.coverUrl] : []);
    const coverUrl = images[0] || newBookData.coverUrl || '';

    const newBook: Book = {
      ...newBookData,
      id: newBookData.id || `book-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: newBookData.createdAt || Date.now(),
      coverUrl,
      images: images.length > 0 ? images : [coverUrl],
      price: Number(newBookData.price) || 0,
    };

    const updatedBooks = [newBook, ...books.filter((b) => b.id !== newBook.id)];
    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.status(201).json(newBook);
  });

  app.put('/api/books/:id', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const updatedData = req.body;
    if (!updatedData) {
      res.status(400).json({ error: 'Datos del libro son obligatorios' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const existingIndex = books.findIndex((b) => b.id === bookId);

    const images = Array.isArray(updatedData.images) && updatedData.images.length > 0
      ? updatedData.images.filter(Boolean)
      : (updatedData.coverUrl ? [updatedData.coverUrl] : []);
    const coverUrl = images[0] || updatedData.coverUrl || '';

    const sanitizedBook: Book = {
      ...updatedData,
      id: bookId,
      coverUrl,
      images: images.length > 0 ? images : [coverUrl],
      price: Number(updatedData.price) || 0,
      createdAt: updatedData.createdAt || (existingIndex >= 0 ? books[existingIndex].createdAt : Date.now()),
    };

    let updatedBooks: Book[];
    if (existingIndex >= 0) {
      updatedBooks = books.map((b) => (b.id === bookId ? sanitizedBook : b));
    } else {
      updatedBooks = [sanitizedBook, ...books];
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(sanitizedBook);
  });

  app.delete('/api/books/:id', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    const updatedBooks = books.filter((b) => b.id !== bookId);
    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json({ success: true, id: bookId });
  });

  app.patch('/api/books/:id/status', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: 'Estado es obligatorio' });
      return;
    }

    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    let targetBook: Book | null = null;
    const updatedBooks = books.map((b) => {
      if (b.id === bookId) {
        targetBook = { ...b, status };
        return targetBook;
      }
      return b;
    });

    if (!targetBook) {
      res.status(404).json({ error: 'Libro no encontrado' });
      return;
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(targetBook);
  });

  app.patch('/api/books/:id/featured', (req: Request, res: Response) => {
    const bookId = req.params.id;
    const books = readJsonFile<Book[]>(BOOKS_FILE, INITIAL_BOOKS);
    let targetBook: Book | null = null;
    const updatedBooks = books.map((b) => {
      if (b.id === bookId) {
        targetBook = { ...b, featured: !b.featured };
        return targetBook;
      }
      return b;
    });

    if (!targetBook) {
      res.status(404).json({ error: 'Libro no encontrado' });
      return;
    }

    writeJsonFile(BOOKS_FILE, updatedBooks);
    res.json(targetBook);
  });

  // API Routes: Settings
  app.get('/api/settings', (_req: Request, res: Response) => {
    const settings = readJsonFile<StoreSettings>(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    res.json(settings);
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const newSettings = req.body;
    const currentSettings = readJsonFile<StoreSettings>(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    const merged = { ...currentSettings, ...newSettings };
    writeJsonFile(SETTINGS_FILE, merged);
    res.json(merged);
  });

  // API Routes: Catalogs / Genres
  app.get('/api/catalogs', (_req: Request, res: Response) => {
    const catalogs = readJsonFile<string[]>(CATALOGS_FILE, DEFAULT_CATALOGS);
    res.json(catalogs);
  });

  app.put('/api/catalogs', (req: Request, res: Response) => {
    const { catalogs } = req.body;
    if (Array.isArray(catalogs)) {
      writeJsonFile(CATALOGS_FILE, catalogs);
      res.json({ success: true, catalogs });
      return;
    }
    res.status(400).json({ error: 'Formato de catálogos inválido' });
  });

  // API Routes: Reset to Defaults
  app.post('/api/reset', (_req: Request, res: Response) => {
    writeJsonFile(BOOKS_FILE, INITIAL_BOOKS);
    writeJsonFile(SETTINGS_FILE, DEFAULT_STORE_SETTINGS);
    writeJsonFile(CATALOGS_FILE, DEFAULT_CATALOGS);
    res.json({ success: true, books: INITIAL_BOOKS, settings: DEFAULT_STORE_SETTINGS, catalogs: DEFAULT_CATALOGS });
  });

  // Vite middleware for development vs Static files for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Books EM running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
