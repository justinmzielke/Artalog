import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import { PDFDocument, PDFPage, StandardFonts } from 'pdf-lib';

export type ParsedRequirements = {
  imageCount: number | null;
  maxIndividualFileSizeMb: number | null;
  maxTotalSizeMb: number | null;
  longestEdgePx: number | null;
  dpi: number | null;
  acceptedFormats: string[];
  notes: string[];
};

export type LabelField = 'title' | 'year' | 'medium' | 'dimensions' | 'price' | 'credit' | 'page_number';

export type ExportRequirements = {
  imageCount: number | null;
  maxIndividualFileSizeMb: number | null;
  maxTotalSizeMb: number | null;
  longestEdgePx: number | null;
  dpi: number | null;
  includeLabels: boolean;
  labelFontSizePt: number;
  labelFields: LabelField[];
  includeInventoryList: boolean;
  pdfImageLayout: 'centered' | 'full_image';
};

export type ExportType = 'portfolio_pdf' | 'images_zip';

export type ExportArtwork = {
  id: string;
  title: string;
  year: string | null;
  mediumMaterials: string | null;
  dimensionsUnit: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  price: number | null;
  currency: string | null;
  originalImagePath: string;
  imageWidth: number | null;
  imageHeight: number | null;
  caption: string | null;
  credit: string | null;
};

export type ExportGenerationInput = {
  applicationTitle: string;
  filenamePrefix: string;
  exportType: ExportType;
  requirements: ExportRequirements;
  artworks: ExportArtwork[];
  exportsDir: string;
};

export type ExportGenerationResult = {
  fileName: string;
  absolutePath: string;
  warnings: string[];
  artifactCount: number;
};

function cleanPrefix(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]+/g, '')
    .replace(/^_+|_+$/g, '') || 'artist';
}

function cleanTitleToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '') || 'Application';
}

function fileSizeMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

async function removeDirWithRetries(dirPath: string): Promise<boolean> {
  const attempts = [0, 50, 120, 250];

  for (const delayMs of attempts) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch {
      // Best effort cleanup on Windows; file handles can linger briefly.
    }
  }

  return false;
}

export function parseRequirementsFromText(text: string): ParsedRequirements {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const notes: string[] = [];

  const imageCountMatch = normalized.match(/(?:up to|maximum|max|submit|exactly)?\s*(\d{1,3})\s+(?:artwork\s+)?images?/i);
  const maxIndividualMatch = normalized.match(/(?:max(?:imum)?\s*(?:individual|each)?\s*file\s*size[^\d]{0,20}|each\s+file[^\d]{0,20})(\d+(?:\.\d+)?)\s*mb/i);
  const maxTotalMatch = normalized.match(/(?:max(?:imum)?\s*total\s*(?:submission)?\s*size[^\d]{0,20}|total\s*(?:submission)?\s*size[^\d]{0,20})(\d+(?:\.\d+)?)\s*mb/i);
  const longestEdgeMatch = normalized.match(/longest\s+edge[^\d]{0,20}(\d{3,5})\s*px/i);
  const dpiMatch = normalized.match(/(\d{2,4})\s*dpi/i);

  const formats: string[] = [];
  if (/jpe?g/i.test(normalized)) formats.push('jpg');
  if (/png/i.test(normalized)) formats.push('png');
  if (/tiff?/i.test(normalized)) formats.push('tif');

  if (!imageCountMatch) notes.push('Image count not confidently detected.');
  if (!maxIndividualMatch) notes.push('Per-file max size not confidently detected.');
  if (!longestEdgeMatch) notes.push('Longest-edge pixel requirement not confidently detected.');

  return {
    imageCount: imageCountMatch ? Number(imageCountMatch[1]) : null,
    maxIndividualFileSizeMb: maxIndividualMatch ? Number(maxIndividualMatch[1]) : null,
    maxTotalSizeMb: maxTotalMatch ? Number(maxTotalMatch[1]) : null,
    longestEdgePx: longestEdgeMatch ? Number(longestEdgeMatch[1]) : null,
    dpi: dpiMatch ? Number(dpiMatch[1]) : null,
    acceptedFormats: formats,
    notes,
  };
}

async function renderImageForExport(sourcePath: string, outputPath: string, requirements: ExportRequirements): Promise<void> {
  const maxEdge = requirements.longestEdgePx ?? null;
  const maxFileMb = requirements.maxIndividualFileSizeMb ?? null;

  const resizeConfig = maxEdge
    ? { width: maxEdge, height: maxEdge, fit: 'inside' as const, withoutEnlargement: true }
    : undefined;

  // Work on buffers (not file paths) so Windows does not keep the temp files locked.
  const source = await fsPromises.readFile(sourcePath);

  if (!maxFileMb) {
    const output = await sharp(source).rotate().resize(resizeConfig).jpeg({ quality: 90 }).toBuffer();
    await fsPromises.writeFile(outputPath, output);
    return;
  }

  const qualities = [90, 85, 80, 75, 70, 65, 60, 55, 50, 45];
  for (const quality of qualities) {
    const output = await sharp(source).rotate().resize(resizeConfig).jpeg({ quality }).toBuffer();
    await fsPromises.writeFile(outputPath, output);

    if (fileSizeMb(output.length) <= maxFileMb) {
      return;
    }
  }
}

function formatDimensions(artwork: ExportArtwork): string {
  const dims = [artwork.height, artwork.width, artwork.depth].filter((value) => value !== null);
  if (dims.length === 0) {
    return '';
  }
  const unit = artwork.dimensionsUnit ?? '';
  return `${dims.join(' x ')} ${unit}`.trim();
}

function formatPrice(artwork: ExportArtwork): string {
  if (artwork.price === null || artwork.price === undefined) {
    return '';
  }
  const currency = artwork.currency?.trim() || 'USD';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: artwork.price % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(artwork.price);
  return `${currency} ${formatted}`;
}

const lowercaseLabelWords = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'v', 'vs', 'via', 'with',
]);

function toDisplayCase(value: string): string {
  let wordIndex = 0;
  const lowered = value.trim().toLowerCase();

  return lowered.replace(/[A-Za-z][A-Za-z'’]*/g, (word, offset, full) => {
    const prev = offset > 0 ? full[offset - 1] : '';
    const forceCap = wordIndex === 0 || prev === '(' || prev === '/';
    wordIndex += 1;

    if (!forceCap && lowercaseLabelWords.has(word)) {
      return word;
    }

    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  });
}

function escapeCsv(value: string): string {
  // A leading = + - @ would run as a formula when the CSV is opened in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayLabelValue(field: LabelField, value: string): string {
  if (field === 'title' || field === 'medium' || field === 'credit') {
    return toDisplayCase(value);
  }
  return value;
}

function labelSegments(artwork: ExportArtwork, requirements: ExportRequirements): Array<{ field: LabelField; text: string }> {
  const orderedFields: LabelField[] = ['title', 'year', 'medium', 'dimensions', 'price', 'credit'];
  const selected = new Set(requirements.labelFields);

  return orderedFields
    .filter((field) => selected.has(field))
    .map((field) => ({
      field,
      text: displayLabelValue(field, labelFieldValue(artwork, field)).trim(),
    }))
    .filter((entry) => entry.text.length > 0);
}

function artworkLabel(artwork: ExportArtwork, requirements: ExportRequirements): string {
  return labelSegments(artwork, requirements)
    .map((entry) => entry.text)
    .join(' | ');
}

function selectedLabelFields(requirements: ExportRequirements): LabelField[] {
  const orderedFields: LabelField[] = ['title', 'year', 'medium', 'dimensions', 'price', 'credit'];
  const selected = new Set(requirements.labelFields);
  return orderedFields.filter((field) => selected.has(field));
}

function labelFieldValue(artwork: ExportArtwork, field: LabelField): string {
  if (field === 'title') {
    return artwork.title;
  }
  if (field === 'year') {
    return artwork.year ?? '';
  }
  if (field === 'medium') {
    return artwork.mediumMaterials ?? '';
  }
  if (field === 'dimensions') {
    return formatDimensions(artwork);
  }
  if (field === 'credit') {
    return artwork.credit ?? '';
  }
  return formatPrice(artwork);
}

function drawStyledLabel(
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  entries: Array<{ field: LabelField; text: string }>,
  regularFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
  boldFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  let cursorX = x;

  entries.forEach((entry, index) => {
    if (index > 0) {
      const separator = ' | ';
      page.drawText(separator, { x: cursorX, y, size, font: regularFont });
      cursorX += regularFont.widthOfTextAtSize(separator, size);
    }

    const currentFont = entry.field === 'title' ? boldFont : regularFont;
    page.drawText(entry.text, { x: cursorX, y, size, font: currentFont });
    cursorX += currentFont.widthOfTextAtSize(entry.text, size);
  });
}

function labelFieldHeading(field: LabelField): string {
  if (field === 'title') return 'title';
  if (field === 'year') return 'year';
  if (field === 'medium') return 'medium';
  if (field === 'dimensions') return 'dimensions';
  if (field === 'credit') return 'photo_credit';
  return 'price';
}

async function createPortfolioPdf(outputPath: string, input: ExportGenerationInput, preparedImagePaths: string[]): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const labelFontSize = Math.min(Math.max(input.requirements.labelFontSizePt ?? 12, 8), 24);
  const labelPadding = 8;
  const centeredLabelGap = 8;

  for (let i = 0; i < preparedImagePaths.length; i += 1) {
    const imageBytes = await fsPromises.readFile(preparedImagePaths[i]);
    const image = await pdf.embedJpg(imageBytes);
    const dims = image.scale(1);

    const isFullImageLayout = input.requirements.pdfImageLayout === 'full_image';
    const entries = labelSegments(input.artworks[i], input.requirements);
    const shouldDrawPageNumber = input.requirements.includeLabels && input.requirements.labelFields.includes('page_number');
    const shouldDrawLabel = input.requirements.includeLabels && entries.length > 0;
    const shouldReserveLabelArea = shouldDrawLabel || shouldDrawPageNumber;
    const pageNumberText = String(i + 1);

    if (isFullImageLayout) {
      const labelHeight = shouldReserveLabelArea ? labelFontSize + labelPadding * 2 : 0;
      const isLandscape = dims.width > dims.height;
      const pageWidth = isLandscape ? 792 : 612;
      const pageHeight = isLandscape ? 612 : 792;
      const imageAreaHeight = pageHeight - labelHeight;
      const page = pdf.addPage([pageWidth, pageHeight]);

      // Use "cover" so the image fully fills the page width/height area.
      // Overflow is intentionally clipped by the page bounds.
      const scale = Math.max(pageWidth / dims.width, imageAreaHeight / dims.height);
      const drawWidth = Math.ceil(dims.width * scale);
      const drawHeight = Math.ceil(dims.height * scale);
      const drawX = Math.floor((pageWidth - drawWidth) / 2);
      const drawY = labelHeight + Math.floor((imageAreaHeight - drawHeight) / 2);

      page.drawImage(image, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });

      if (shouldDrawLabel) {
        drawStyledLabel(page, labelPadding, labelPadding, labelFontSize, entries, font, boldFont);
      }
      if (shouldDrawPageNumber) {
        const pageNumberWidth = font.widthOfTextAtSize(pageNumberText, labelFontSize);
        page.drawText(pageNumberText, {
          x: pageWidth - labelPadding - pageNumberWidth,
          y: labelPadding,
          size: labelFontSize,
          font,
        });
      }
      continue;
    }

    const pageWidth = 612;
    const pageHeight = 792;
    const page = pdf.addPage([pageWidth, pageHeight]);

    const margin = 46;

    const labelHeight = shouldReserveLabelArea ? labelFontSize + labelPadding * 2 : 0;
    const labelGap = shouldReserveLabelArea ? centeredLabelGap : 0;
    const labelSpace = labelHeight + labelGap;
    const frameX = margin;
    const frameY = margin + labelSpace;
    const frameWidth = pageWidth - margin * 2;
    const frameHeight = pageHeight - margin * 2 - labelSpace;

    const scale = Math.min(frameWidth / dims.width, frameHeight / dims.height, 1);
    const drawWidth = dims.width * scale;
    const drawHeight = dims.height * scale;
    const x = frameX + (frameWidth - drawWidth) / 2;
    const y = frameY + (frameHeight - drawHeight) / 2;

    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });

    if (shouldDrawLabel) {
      drawStyledLabel(page, margin, margin + labelPadding, labelFontSize, entries, font, boldFont);
    }
    if (shouldDrawPageNumber) {
      const pageNumberWidth = font.widthOfTextAtSize(pageNumberText, labelFontSize);
      page.drawText(pageNumberText, {
        x: pageWidth - margin - pageNumberWidth,
        y: margin + labelPadding,
        size: labelFontSize,
        font,
      });
    }
  }

  let inventoryPage = pdf.addPage([612, 792]);
  inventoryPage.drawText('Inventory List', { x: 46, y: 740, size: 18, font });

  const rowHeight = 96;
  const thumbSize = 76;
  const thumbX = 46;
  const textX = thumbX + thumbSize + 12;
  let y = 700;

  for (let i = 0; i < input.artworks.length; i += 1) {
    if (y < 80) {
      inventoryPage = pdf.addPage([612, 792]);
      inventoryPage.drawText('Inventory List (cont.)', { x: 46, y: 740, size: 16, font });
      y = 700;
    }

    const thumbBytes = await sharp(await fsPromises.readFile(preparedImagePaths[i]))
      .resize({ width: thumbSize, height: thumbSize, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    const thumbImage = await pdf.embedJpg(thumbBytes);
    const thumbDims = thumbImage.scale(1);
    const thumbScale = Math.min(thumbSize / thumbDims.width, thumbSize / thumbDims.height, 1);
    const drawWidth = thumbDims.width * thumbScale;
    const drawHeight = thumbDims.height * thumbScale;
    const drawX = thumbX + (thumbSize - drawWidth) / 2;
    const drawY = y - drawHeight + 6;
    inventoryPage.drawImage(thumbImage, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });

    const artwork = input.artworks[i];
    const inventoryLine = `${String(i + 1).padStart(2, '0')}. ${artworkLabel(artwork, input.requirements) || artwork.title}`;
    inventoryPage.drawText(inventoryLine, { x: textX, y: y - 6, size: 10, font });

    y -= rowHeight;
  }

  const bytes = await pdf.save();
  await fsPromises.writeFile(outputPath, bytes);
}

async function createImagesZip(
  outputPath: string,
  preparedImagePaths: string[],
  artworks: ExportArtwork[],
  fileStem: string,
  requirements: ExportRequirements,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const zip = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', (error: Error) => reject(error));
    zip.on('error', (error: Error) => reject(error));

    zip.pipe(output);

    void (async () => {
      const fields = selectedLabelFields(requirements);
      const inventoryHeader = [
        'index',
        'image_file',
        'thumbnail_file',
        ...fields.map((field) => labelFieldHeading(field)),
      ];
      const inventoryRows = [inventoryHeader.join(',')];
      const inventoryHtmlRows: string[] = [];

      for (let index = 0; index < preparedImagePaths.length; index += 1) {
        const imagePath = preparedImagePaths[index];
        const artwork = artworks[index];
        const fileName = `${fileStem}_${String(index + 1).padStart(2, '0')}.jpg`;
        const thumbName = `${String(index + 1).padStart(2, '0')}.jpg`;
        const thumbPathInZip = `inventory_thumbnails/${thumbName}`;

        const imageBuffer = await fsPromises.readFile(imagePath);
        zip.append(imageBuffer, { name: fileName });

        const thumbBuffer = await sharp(imageBuffer)
          .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
        zip.append(thumbBuffer, { name: thumbPathInZip });

        const fieldValues = fields.map((field) => displayLabelValue(field, labelFieldValue(artwork, field)));
        inventoryRows.push(
          [
            String(index + 1),
            escapeCsv(fileName),
            escapeCsv(thumbPathInZip),
            ...fieldValues.map((value) => escapeCsv(value)),
          ].join(','),
        );

        const htmlFieldCells = fieldValues
          .map((value) => `<td>${escapeHtml(value)}</td>`)
          .join('');
        inventoryHtmlRows.push(
          `<tr><td>${String(index + 1).padStart(2, '0')}</td><td><img src="${thumbPathInZip}" width="96" height="96" alt="thumb ${index + 1}" /></td>${htmlFieldCells}<td>${fileName}</td></tr>`,
        );
      }

      const htmlHeaders = fields
        .map((field) => `<th>${labelFieldHeading(field)}</th>`)
        .join('');

      zip.append(inventoryRows.join('\n'), { name: 'inventory.csv' });
      zip.append(
        [
          '<!doctype html>',
          '<html><head><meta charset="utf-8"><title>Inventory</title></head>',
          '<body style="font-family: Arial, sans-serif; font-size: 13px;">',
          '<h2>Inventory</h2>',
          '<table border="1" cellspacing="0" cellpadding="6">',
          `<thead><tr><th>#</th><th>Thumb</th>${htmlHeaders}<th>Image File</th></tr></thead>`,
          `<tbody>${inventoryHtmlRows.join('')}</tbody>`,
          '</table>',
          '</body></html>',
        ].join(''),
        { name: 'inventory.html' },
      );

      await zip.finalize();
    })().catch((error: Error) => reject(error));
  });
}

export async function generateExportArtifact(input: ExportGenerationInput): Promise<ExportGenerationResult> {
  await fsPromises.mkdir(input.exportsDir, { recursive: true });

  const warnings: string[] = [];
  const req = input.requirements;

  if (req.imageCount && input.artworks.length > req.imageCount) {
    warnings.push(`Selected ${input.artworks.length} images; requirement indicates ${req.imageCount}.`);
  }

  if (req.imageCount && input.artworks.length < req.imageCount) {
    warnings.push(`Selected ${input.artworks.length} images; requirement indicates ${req.imageCount}.`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileStem = `${cleanPrefix(input.filenamePrefix)}_${cleanTitleToken(input.applicationTitle)}`;
  const base = `${fileStem}_${timestamp}`;
  const tempDir = path.join(input.exportsDir, `${base}_tmp`);
  await fsPromises.mkdir(tempDir, { recursive: true });

  const preparedImagePaths: string[] = [];

  try {
    for (let i = 0; i < input.artworks.length; i += 1) {
      const outputImagePath = path.join(tempDir, `${String(i + 1).padStart(2, '0')}.jpg`);
      await renderImageForExport(input.artworks[i].originalImagePath, outputImagePath, req);
      preparedImagePaths.push(outputImagePath);
    }

    let fileName = `${base}.pdf`;
    let absolutePath = path.join(input.exportsDir, fileName);

    if (input.exportType === 'images_zip') {
      fileName = `${base}_submission_images.zip`;
      absolutePath = path.join(input.exportsDir, fileName);
      await createImagesZip(
        absolutePath,
        preparedImagePaths,
        input.artworks,
        fileStem,
        input.requirements,
      );
    } else {
      await createPortfolioPdf(absolutePath, input, preparedImagePaths);
    }

    const stats = await fsPromises.stat(absolutePath);
    if (req.maxTotalSizeMb && fileSizeMb(stats.size) > req.maxTotalSizeMb) {
      warnings.push(
        `Final package is ${fileSizeMb(stats.size).toFixed(2)} MB, above requested ${req.maxTotalSizeMb} MB.`,
      );
    }

    return {
      fileName,
      absolutePath,
      warnings,
      artifactCount: input.artworks.length,
    };
  } finally {
    const cleaned = await removeDirWithRetries(tempDir);
    if (!cleaned) {
      console.warn(`Could not fully remove temp export directory: ${tempDir}`);
    }
  }
}
