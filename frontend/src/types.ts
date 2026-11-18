export type ArtworkSummary = {
  id: string;
  title: string;
  year: string | null;
  mediumMaterials: string | null;
  dimensionsUnit?: string | null;
  height?: number | null;
  width?: number | null;
  depth?: number | null;
  price?: number | null;
  currency?: string | null;
  collectionSeries: string | null;
  tags: string[];
  primaryThumbnailUrl: string | null;
  primaryImageCredit: string | null;
  updatedAt: string;
};

export type LabelField = 'title' | 'year' | 'medium' | 'dimensions' | 'price' | 'credit' | 'page_number';

export type ArtworkImage = {
  id: string;
  artworkId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  credit: string | null;
  isPrimary: boolean;
  isDetail: boolean;
  sortOrder: number;
  originalUrl: string;
  thumbnailUrl: string;
  createdAt: string;
};

export type Artwork = {
  id: string;
  title: string;
  year: string | null;
  mediumMaterials: string | null;
  materials: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionsUnit: string | null;
  weight: number | null;
  weightUnit: string | null;
  editionInfo: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  collectionSeries: string | null;
  tags: string[];
  shortDescription: string | null;
  longDescription: string | null;
  artworkStatement: string | null;
  processNotes: string | null;
  exhibitionHistory: string | null;
  privateNotes: string | null;
  createdAt: string;
  updatedAt: string;
  images: ArtworkImage[];
};

export type ArtworkPayload = {
  title: string;
  year: string | null;
  mediumMaterials: string | null;
  materials: string | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionsUnit: string | null;
  weight: number | null;
  weightUnit: string | null;
  editionInfo: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  collectionSeries: string | null;
  tags: string[];
  shortDescription: string | null;
  longDescription: string | null;
  artworkStatement: string | null;
  processNotes: string | null;
  exhibitionHistory: string | null;
  privateNotes: string | null;
};

export type ParsedRequirements = {
  imageCount: number | null;
  maxIndividualFileSizeMb: number | null;
  maxTotalSizeMb: number | null;
  longestEdgePx: number | null;
  dpi: number | null;
  acceptedFormats: string[];
  notes: string[];
};

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

export type ExportGenerationResult = {
  fileName: string;
  downloadUrl: string;
  exportedCount: number;
  warnings: string[];
};
