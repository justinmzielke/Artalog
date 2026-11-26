import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from './db';
import { DATA_DIR, FRONTEND_DIR } from './config';
import { generateExportArtifact, parseRequirementsFromText } from './exporter';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';

const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const loopbackHostPattern = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// Only formats we re-encode and can safely serve; never trust the uploaded file name or type.
const IMAGE_EXTENSIONS: Record<string, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  tiff: '.tif',
  avif: '.avif',
};
const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbnails');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const HAS_FRONTEND = existsSync(path.join(FRONTEND_DIR, 'index.html'));

void fs.mkdir(ORIGINALS_DIR, { recursive: true });
void fs.mkdir(THUMBS_DIR, { recursive: true });
void fs.mkdir(EXPORTS_DIR, { recursive: true });

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Rejecting other Host names stops a web page from reaching the archive through DNS rebinding.
  if (['127.0.0.1', 'localhost', '::1'].includes(HOST) && !loopbackHostPattern.test(req.headers.host ?? '')) {
    res.status(403).send('Forbidden');
    return;
  }
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOriginPattern.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Blocked by CORS policy'));
    },
  }),
);
// Desktop app mode: only the app window (which holds the launch token) may use the local server,
// so other programs or web pages on this computer cannot read or change the archive.
const ACCESS_TOKEN = process.env.ARTALOG_TOKEN;
if (ACCESS_TOKEN) {
  const COOKIE_NAME = 'artalog_session';
  const tokenBuffer = Buffer.from(ACCESS_TOKEN);
  const matches = (candidate: unknown): boolean => {
    if (typeof candidate !== 'string') return false;
    const buffer = Buffer.from(candidate);
    return buffer.length === tokenBuffer.length && crypto.timingSafeEqual(buffer, tokenBuffer);
  };
  app.use((req, res, next) => {
    if (req.path === '/api/health') {
      next();
      return;
    }
    if (matches(req.query.token)) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${ACCESS_TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
      res.redirect(302, req.path);
      return;
    }
    const cookies = (req.headers.cookie ?? '').split(';').map((part) => part.trim());
    const session = cookies.find((part) => part.startsWith(`${COOKIE_NAME}=`));
    if (session && matches(session.slice(COOKIE_NAME.length + 1))) {
      next();
      return;
    }
    res.status(401).send('Unauthorized');
  });
}
app.use(express.json({ limit: '10mb' }));
app.use('/files/originals', express.static(ORIGINALS_DIR));
app.use('/files/thumbnails', express.static(THUMBS_DIR));
app.use('/files/exports', express.static(EXPORTS_DIR));
if (HAS_FRONTEND) {
  app.use(express.static(FRONTEND_DIR));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 20,
    fileSize: 50 * 1024 * 1024,
  },
});

const BLURB_WORD_LIMIT = 100;
const STATEMENT_WORD_LIMIT = 250;

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const artworkPayloadSchema = z.object({
  title: z.string().min(1),
  year: z.string().optional().nullable(),
  mediumMaterials: z.string().optional().nullable(),
  materials: z.string().optional().nullable(),
  height: z.number().optional().nullable(),
  width: z.number().optional().nullable(),
  depth: z.number().optional().nullable(),
  dimensionsUnit: z.string().optional().nullable(),
  weight: z.number().optional().nullable(),
  weightUnit: z.string().optional().nullable(),
  editionInfo: z.string().optional().nullable(),
  price: z.number().optional().nullable(),
  currency: z.string().optional().nullable(),
  availability: z.string().optional().nullable(),
  collectionSeries: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  shortDescription: z.string().optional().nullable().refine((value) => {
    if (value === null || value === undefined) {
      return true;
    }
    return countWords(value) <= BLURB_WORD_LIMIT;
  }, `Description must be ${BLURB_WORD_LIMIT} words or fewer.`),
  longDescription: z.string().optional().nullable(),
  artworkStatement: z.string().optional().nullable().refine((value) => {
    if (value === null || value === undefined) {
      return true;
    }
    return countWords(value) <= STATEMENT_WORD_LIMIT;
  }, `Statement must be ${STATEMENT_WORD_LIMIT} words or fewer.`),
  processNotes: z.string().optional().nullable(),
  exhibitionHistory: z.string().optional().nullable(),
  privateNotes: z.string().optional().nullable(),
});

const imageMetaSchema = z.object({
  caption: z.string().optional().nullable(),
  credit: z.string().optional().nullable(),
  isDetail: z.boolean().optional(),
});

const imageOrderSchema = z.object({
  imageIds: z.array(z.string()).min(1),
});

const requirementParseSchema = z.object({
  text: z.string().min(1).max(50_000),
});

const exportRequirementsSchema = z.object({
  imageCount: z.number().int().positive().nullable().optional(),
  maxIndividualFileSizeMb: z.number().positive().nullable().optional(),
  maxTotalSizeMb: z.number().positive().nullable().optional(),
  longestEdgePx: z.number().int().positive().nullable().optional(),
  dpi: z.number().int().positive().nullable().optional(),
  includeLabels: z.boolean().default(true),
  labelFontSizePt: z.number().int().min(8).max(24).default(12),
  labelFields: z.array(z.enum(['title', 'year', 'medium', 'dimensions', 'price', 'credit', 'page_number'])).default(['title', 'year', 'medium', 'dimensions']),
  includeInventoryList: z.boolean().default(true),
  pdfImageLayout: z.enum(['centered', 'full_image']).default('centered'),
});

const exportGenerateSchema = z.object({
  applicationTitle: z.string().min(1),
  filenamePrefix: z.string().min(1),
  exportType: z.enum(['portfolio_pdf', 'images_zip']),
  selectedArtworkIds: z.array(z.string()).min(1),
  requirements: exportRequirementsSchema,
});

function nowIso(): string {
  return new Date().toISOString();
}

function id(): string {
  return crypto.randomUUID();
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapArtwork(row: any) {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    mediumMaterials: row.medium_materials,
    materials: row.materials,
    height: row.height,
    width: row.width,
    depth: row.depth,
    dimensionsUnit: row.dimensions_unit,
    weight: row.weight,
    weightUnit: row.weight_unit,
    editionInfo: row.edition_info,
    price: row.price,
    currency: row.currency,
    availability: row.availability,
    collectionSeries: row.collection_series,
    tags: JSON.parse(row.tags || '[]'),
    shortDescription: row.short_description,
    longDescription: row.long_description,
    artworkStatement: row.artwork_statement,
    processNotes: row.process_notes,
    exhibitionHistory: row.exhibition_history,
    privateNotes: row.private_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImage(row: any) {
  return {
    id: row.id,
    artworkId: row.artwork_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    caption: row.caption,
    credit: row.credit,
    isPrimary: Boolean(row.is_primary),
    isDetail: Boolean(row.is_detail),
    sortOrder: row.sort_order,
    originalUrl: `/files/originals/${row.artwork_id}/${row.stored_filename}`,
    thumbnailUrl: `/files/thumbnails/${row.artwork_id}/${row.stored_filename}.jpg`,
    createdAt: row.created_at,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res, next) => {
  if (HAS_FRONTEND) {
    next();
    return;
  }
  res.status(200).json({
    name: 'Artalog backend',
    ok: true,
    frontend: 'http://127.0.0.1:5173',
    health: '/api/health',
  });
});

app.get('/api/artworks', (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT a.*, i.stored_filename AS primary_image_filename, i.credit AS primary_image_credit
      FROM artworks a
      LEFT JOIN artwork_images i ON i.artwork_id = a.id AND i.is_primary = 1
      ORDER BY datetime(a.updated_at) DESC
      `,
    )
    .all();

  const list = rows.map((row: any) => ({
    ...mapArtwork(row),
    primaryThumbnailUrl: row.primary_image_filename
      ? `/files/thumbnails/${row.id}/${row.primary_image_filename}.jpg`
      : null,
    primaryImageCredit: row.primary_image_credit ?? null,
  }));

  res.json(list);
});

app.get('/api/artworks/:id', (req, res) => {
  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(req.params.id);
  if (!artwork) {
    res.status(404).json({ error: 'Artwork not found' });
    return;
  }

  const images = db
    .prepare(
      `SELECT * FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC, datetime(created_at) ASC`,
    )
    .all(req.params.id)
    .map(mapImage);

  res.json({ ...mapArtwork(artwork), images });
});

app.post('/api/artworks', (req, res) => {
  const parsed = artworkPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const artworkId = id();
  const now = nowIso();

  db.prepare(
    `
    INSERT INTO artworks (
      id, title, year, medium_materials, materials, height, width, depth, dimensions_unit,
      weight, weight_unit, edition_info, price, currency, availability,
      collection_series, tags, short_description, long_description,
      artwork_statement, process_notes, exhibition_history, private_notes,
      created_at, updated_at
    ) VALUES (
      @id, @title, @year, @medium_materials, @materials, @height, @width, @depth, @dimensions_unit,
      @weight, @weight_unit, @edition_info, @price, @currency, @availability,
      @collection_series, @tags, @short_description, @long_description,
      @artwork_statement, @process_notes, @exhibition_history, @private_notes,
      @created_at, @updated_at
    )
    `,
  ).run({
    id: artworkId,
    title: data.title,
    year: data.year ?? null,
    medium_materials: data.mediumMaterials ?? null,
    materials: data.materials ?? null,
    height: toNumberOrNull(data.height),
    width: toNumberOrNull(data.width),
    depth: toNumberOrNull(data.depth),
    dimensions_unit: data.dimensionsUnit ?? 'in',
    weight: toNumberOrNull(data.weight),
    weight_unit: data.weightUnit ?? 'lb',
    edition_info: data.editionInfo ?? null,
    price: toNumberOrNull(data.price),
    currency: data.currency ?? null,
    availability: data.availability ?? null,
    collection_series: data.collectionSeries ?? null,
    tags: JSON.stringify(data.tags ?? []),
    short_description: data.shortDescription ?? null,
    long_description: data.longDescription ?? null,
    artwork_statement: data.artworkStatement ?? null,
    process_notes: data.processNotes ?? null,
    exhibition_history: data.exhibitionHistory ?? null,
    private_notes: data.privateNotes ?? null,
    created_at: now,
    updated_at: now,
  });

  const created = db.prepare('SELECT * FROM artworks WHERE id = ?').get(artworkId);
  res.status(201).json(mapArtwork(created));
});

app.put('/api/artworks/:id', (req, res) => {
  const parsed = artworkPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = db.prepare('SELECT id FROM artworks WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Artwork not found' });
    return;
  }

  const data = parsed.data;
  db.prepare(
    `
    UPDATE artworks SET
      title = @title,
      year = @year,
      medium_materials = @medium_materials,
      materials = @materials,
      height = @height,
      width = @width,
      depth = @depth,
      dimensions_unit = @dimensions_unit,
      weight = @weight,
      weight_unit = @weight_unit,
      edition_info = @edition_info,
      price = @price,
      currency = @currency,
      availability = @availability,
      collection_series = @collection_series,
      tags = @tags,
      short_description = @short_description,
      long_description = @long_description,
      artwork_statement = @artwork_statement,
      process_notes = @process_notes,
      exhibition_history = @exhibition_history,
      private_notes = @private_notes,
      updated_at = @updated_at
    WHERE id = @id
    `,
  ).run({
    id: req.params.id,
    title: data.title,
    year: data.year ?? null,
    medium_materials: data.mediumMaterials ?? null,
    materials: data.materials ?? null,
    height: toNumberOrNull(data.height),
    width: toNumberOrNull(data.width),
    depth: toNumberOrNull(data.depth),
    dimensions_unit: data.dimensionsUnit ?? 'in',
    weight: toNumberOrNull(data.weight),
    weight_unit: data.weightUnit ?? 'lb',
    edition_info: data.editionInfo ?? null,
    price: toNumberOrNull(data.price),
    currency: data.currency ?? null,
    availability: data.availability ?? null,
    collection_series: data.collectionSeries ?? null,
    tags: JSON.stringify(data.tags ?? []),
    short_description: data.shortDescription ?? null,
    long_description: data.longDescription ?? null,
    artwork_statement: data.artworkStatement ?? null,
    process_notes: data.processNotes ?? null,
    exhibition_history: data.exhibitionHistory ?? null,
    private_notes: data.privateNotes ?? null,
    updated_at: nowIso(),
  });

  const updated = db.prepare('SELECT * FROM artworks WHERE id = ?').get(req.params.id);
  res.json(mapArtwork(updated));
});

app.delete('/api/artworks/:id', async (req, res) => {
  const existing = db.prepare('SELECT id FROM artworks WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Artwork not found' });
    return;
  }

  db.prepare('DELETE FROM artworks WHERE id = ?').run(req.params.id);
  await fs.rm(path.join(ORIGINALS_DIR, req.params.id), { recursive: true, force: true });
  await fs.rm(path.join(THUMBS_DIR, req.params.id), { recursive: true, force: true });
  res.status(204).send();
});

app.post('/api/artworks/:id/images', upload.array('images', 20), async (req, res) => {
  const artworkId = String(req.params.id);
  const artwork = db.prepare('SELECT id FROM artworks WHERE id = ?').get(artworkId);
  if (!artwork) {
    res.status(404).json({ error: 'Artwork not found' });
    return;
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const checked: Array<{ file: Express.Multer.File; ext: string; width: number | null; height: number | null }> = [];
  for (const file of files) {
    try {
      const meta = await sharp(file.buffer).metadata();
      const ext = meta.format ? IMAGE_EXTENSIONS[meta.format] : undefined;
      if (!ext) {
        throw new Error('Unsupported image format');
      }
      checked.push({ file, ext, width: meta.width ?? null, height: meta.height ?? null });
    } catch {
      res.status(400).json({ error: `"${file.originalname}" is not a supported image (JPEG, PNG, WebP, GIF, TIFF or AVIF).` });
      return;
    }
  }

  const artworkOriginalsDir = path.join(ORIGINALS_DIR, artworkId);
  const artworkThumbsDir = path.join(THUMBS_DIR, artworkId);
  await fs.mkdir(artworkOriginalsDir, { recursive: true });
  await fs.mkdir(artworkThumbsDir, { recursive: true });

  const maxSortRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM artwork_images WHERE artwork_id = ?')
    .get(artworkId) as { max_sort: number };

  let sortOrder = maxSortRow.max_sort + 1;

  for (const { file, ext, width, height } of checked) {
    const imageId = id();
    const storedFilename = `${imageId}${ext}`;
    const originalPath = path.join(artworkOriginalsDir, storedFilename);
    const thumbPath = path.join(artworkThumbsDir, `${storedFilename}.jpg`);

    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbPath);

    await fs.writeFile(originalPath, file.buffer);

    db.prepare(
      `
      INSERT INTO artwork_images (
        id, artwork_id, original_filename, stored_filename, mime_type,
        size_bytes, width, height, caption, credit, is_primary,
        is_detail, sort_order, created_at
      ) VALUES (
        @id, @artwork_id, @original_filename, @stored_filename, @mime_type,
        @size_bytes, @width, @height, @caption, @credit, @is_primary,
        @is_detail, @sort_order, @created_at
      )
      `,
    ).run({
      id: imageId,
      artwork_id: artworkId,
      original_filename: file.originalname,
      stored_filename: storedFilename,
      mime_type: file.mimetype,
      size_bytes: file.size,
      width,
      height,
      caption: null,
      credit: null,
      is_primary: 0,
      is_detail: 0,
      sort_order: sortOrder,
      created_at: nowIso(),
    });

    sortOrder += 1;
  }

  const imageCount = db
    .prepare('SELECT COUNT(*) AS c FROM artwork_images WHERE artwork_id = ?')
    .get(artworkId) as { c: number };

  if (imageCount.c > 0) {
    const hasPrimary = db
      .prepare('SELECT id FROM artwork_images WHERE artwork_id = ? AND is_primary = 1 LIMIT 1')
      .get(artworkId);

    if (!hasPrimary) {
      const firstImage = db
        .prepare('SELECT id FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC LIMIT 1')
        .get(artworkId) as { id: string };
      if (firstImage) {
        db.prepare('UPDATE artwork_images SET is_primary = 1 WHERE id = ?').run(firstImage.id);
      }
    }
  }

  const images = db
    .prepare('SELECT * FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC')
    .all(artworkId)
    .map(mapImage);

  res.status(201).json(images);
});

app.patch('/api/images/:id', (req, res) => {
  const parsed = imageMetaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = db.prepare('SELECT * FROM artwork_images WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  const data = parsed.data;
  db.prepare(
    `
    UPDATE artwork_images SET
      caption = @caption,
      credit = @credit,
      is_detail = @is_detail
    WHERE id = @id
    `,
  ).run({
    id: req.params.id,
    caption: data.caption ?? null,
    credit: data.credit ?? null,
    is_detail: data.isDetail ? 1 : 0,
  });

  const updated = db.prepare('SELECT * FROM artwork_images WHERE id = ?').get(req.params.id);
  res.json(mapImage(updated));
});

app.patch('/api/images/:id/primary', (req, res) => {
  const existing = db.prepare('SELECT * FROM artwork_images WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  db.prepare('UPDATE artwork_images SET is_primary = 0 WHERE artwork_id = ?').run(existing.artwork_id);
  db.prepare('UPDATE artwork_images SET is_primary = 1 WHERE id = ?').run(req.params.id);

  const images = db
    .prepare('SELECT * FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC')
    .all(existing.artwork_id)
    .map(mapImage);

  res.json(images);
});

app.put('/api/artworks/:id/images/order', (req, res) => {
  const parsed = imageOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tx = db.transaction((imageIds: string[]) => {
    imageIds.forEach((imageId, index) => {
      db.prepare('UPDATE artwork_images SET sort_order = ? WHERE id = ? AND artwork_id = ?').run(
        index,
        imageId,
        req.params.id,
      );
    });
  });

  tx(parsed.data.imageIds);

  const images = db
    .prepare('SELECT * FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC')
    .all(req.params.id)
    .map(mapImage);

  res.json(images);
});

app.delete('/api/images/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM artwork_images WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  db.prepare('DELETE FROM artwork_images WHERE id = ?').run(req.params.id);

  const originalPath = path.join(ORIGINALS_DIR, existing.artwork_id, existing.stored_filename);
  const thumbPath = path.join(THUMBS_DIR, existing.artwork_id, `${existing.stored_filename}.jpg`);
  await fs.rm(originalPath, { force: true });
  await fs.rm(thumbPath, { force: true });

  const remaining = db
    .prepare('SELECT * FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC')
    .all(existing.artwork_id) as any[];

  if (remaining.length > 0 && !remaining.some((img) => img.is_primary === 1)) {
    db.prepare('UPDATE artwork_images SET is_primary = 1 WHERE id = ?').run(remaining[0].id);
  }

  res.status(204).send();
});

app.post('/api/requirements/parse', (req, res) => {
  const parsed = requirementParseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const result = parseRequirementsFromText(parsed.data.text);
  res.json(result);
});

app.post('/api/exports/generate', async (req, res) => {
  const parsed = exportGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const input = parsed.data;

  const placeholders = input.selectedArtworkIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `
      SELECT
        a.id,
        a.title,
        a.year,
        a.medium_materials,
        a.dimensions_unit,
        a.height,
        a.width,
        a.depth,
        a.price,
        a.currency,
        i.stored_filename,
        i.width AS image_width,
        i.height AS image_height,
        i.caption,
        i.credit
      FROM artworks a
      LEFT JOIN artwork_images i
        ON i.artwork_id = a.id
        AND i.is_primary = 1
      WHERE a.id IN (${placeholders})
      `,
    )
    .all(...input.selectedArtworkIds) as any[];

  const rowById = new Map<string, any>(rows.map((row) => [row.id, row]));

  const artworks = input.selectedArtworkIds
    .map((artworkId) => rowById.get(artworkId))
    .filter(Boolean)
    .map((row) => ({
      id: row.id,
      title: row.title,
      year: row.year,
      mediumMaterials: row.medium_materials,
      dimensionsUnit: row.dimensions_unit,
      height: row.height,
      width: row.width,
      depth: row.depth,
      price: row.price,
      currency: row.currency,
      originalImagePath: path.join(ORIGINALS_DIR, row.id, row.stored_filename ?? ''),
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      caption: row.caption,
      credit: row.credit,
    }))
    .filter((row) => row.originalImagePath && path.extname(row.originalImagePath));

  if (artworks.length === 0) {
    res.status(400).json({ error: 'No selected artworks have primary images to export.' });
    return;
  }

  const missingPrimaryImages = input.selectedArtworkIds.length - artworks.length;
  const warnings: string[] = [];
  if (missingPrimaryImages > 0) {
    warnings.push(`${missingPrimaryImages} selected artworks were skipped because they have no primary image.`);
  }

  try {
    const artifact = await generateExportArtifact({
      applicationTitle: input.applicationTitle,
      filenamePrefix: input.filenamePrefix,
      exportType: input.exportType,
      requirements: {
        imageCount: input.requirements.imageCount ?? null,
        maxIndividualFileSizeMb: input.requirements.maxIndividualFileSizeMb ?? null,
        maxTotalSizeMb: input.requirements.maxTotalSizeMb ?? null,
        longestEdgePx: input.requirements.longestEdgePx ?? 2048,
        dpi: input.requirements.dpi ?? null,
        includeLabels: input.requirements.includeLabels,
        labelFontSizePt: input.requirements.labelFontSizePt ?? 12,
        labelFields: input.requirements.labelFields,
        includeInventoryList: true,
        pdfImageLayout: input.requirements.pdfImageLayout,
      },
      artworks,
      exportsDir: EXPORTS_DIR,
    });

    res.json({
      fileName: artifact.fileName,
      downloadUrl: `/files/exports/${artifact.fileName}`,
      exportedCount: artifact.artifactCount,
      warnings: [...warnings, ...artifact.warnings],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate export artifact.' });
  }
});

// One ZIP with everything needed to rebuild the archive: database, images, settings.
app.get('/api/backup', async (_req, res) => {
  const snapshotPath = path.join(os.tmpdir(), `artalog-snapshot-${id()}.sqlite`);
  try {
    await db.backup(snapshotPath);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create the backup.' });
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Artalog-backup-${stamp}.zip"`);

  const zip = new ZipArchive({ zlib: { level: 1 } });
  const cleanup = () => void fs.rm(snapshotPath, { force: true });
  res.on('close', cleanup);
  zip.on('error', (error: Error) => {
    console.error(error);
    res.destroy(error);
  });
  zip.pipe(res);
  zip.file(snapshotPath, { name: 'artalog.sqlite' });
  if (existsSync(SETTINGS_PATH)) {
    zip.file(SETTINGS_PATH, { name: 'settings.json' });
  }
  zip.directory(ORIGINALS_DIR, 'originals');
  zip.directory(THUMBS_DIR, 'thumbnails');
  await zip.finalize();
});

const settingsSchema = z.object({
  theme: z.enum(['gallery_white', 'archive_green', 'charcoal', 'custom']).optional(),
  customColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

async function readSettings(): Promise<z.infer<typeof settingsSchema>> {
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

app.get('/api/settings', async (_req, res) => {
  res.json(await readSettings());
});

app.put('/api/settings', async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const merged = { ...(await readSettings()), ...parsed.data };
  const tempPath = `${SETTINGS_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(merged, null, 2));
  await fs.rename(tempPath, SETTINGS_PATH);
  res.json(merged);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Artalog backend running at http://${HOST}:${PORT}`);
});
