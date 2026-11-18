import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import {
  apiBase,
  createArtwork,
  deleteArtwork,
  deleteImage,
  generateExport,
  getArtwork,
  getSettings,
  listArtworks,
  parseRequirements,
  reorderImages,
  saveSettings,
  setPrimaryImage,
  updateArtwork,
  updateImage,
  uploadArtworkImages,
} from './api';
import type {
  Artwork,
  ArtworkImage,
  ArtworkPayload,
  ArtworkSummary,
  ExportGenerationResult,
  LabelField,
  ExportRequirements,
  ExportType,
} from './types';

type ArtworkDraft = {
  title: string;
  year: string;
  mediumMaterials: string;
  materials: string;
  height: string;
  width: string;
  depth: string;
  dimensionsUnit: string;
  weight: string;
  weightUnit: string;
  editionInfo: string;
  price: string;
  currency: string;
  availability: string;
  collectionSeries: string;
  tags: string;
  shortDescription: string;
  longDescription: string;
  artworkStatement: string;
  processNotes: string;
  exhibitionHistory: string;
  privateNotes: string;
};

const blankDraft: ArtworkDraft = {
  title: '',
  year: '',
  mediumMaterials: '',
  materials: '',
  height: '',
  width: '',
  depth: '',
  dimensionsUnit: 'cm',
  weight: '',
  weightUnit: 'kg',
  editionInfo: '',
  price: '',
  currency: 'USD',
  availability: 'Available',
  collectionSeries: '',
  tags: '',
  shortDescription: '',
  longDescription: '',
  artworkStatement: '',
  processNotes: '',
  exhibitionHistory: '',
  privateNotes: '',
};

const suggestedKeywords = [
  'Sculpture',
  'Wood',
  'Bronze',
  'Painting',
  'Drawing',
  'Installation',
  'Video',
  'Music Video',
  'Photography',
  'Performance',
  'Mixed Media',
  'Digital',
  'Ceramics',
  'Textile',
];

const lowercaseLabelWords = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'v', 'vs', 'via', 'with',
]);

const BLURB_WORD_LIMIT = 100;
const STATEMENT_WORD_LIMIT = 250;
const THEME_STORAGE_KEY = 'artalog.appearanceTheme';
const CUSTOM_COLOR_STORAGE_KEY = 'artalog.appearanceCustomColor';

type AppearanceTheme = 'gallery_white' | 'archive_green' | 'charcoal' | 'custom';

type ThemePalette = {
  sidebarBg: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarActiveBg: string;
  sidebarHoverBg: string;
  mainBg: string;
  panelBg: string;
  panelHeaderBg: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  inputBg: string;
  inputBorder: string;
  primaryButtonBg: string;
  primaryButtonText: string;
};

const PRESET_THEMES: Record<Exclude<AppearanceTheme, 'custom'>, ThemePalette> = {
  gallery_white: {
    sidebarBg: '#F7F7F5',
    sidebarText: '#252525',
    sidebarMuted: '#666561',
    sidebarActiveBg: '#E9E9E7',
    sidebarHoverBg: '#EFEFED',
    mainBg: '#ECECEB',
    panelBg: '#F8F8F7',
    panelHeaderBg: '#F8F8F7',
    border: '#DEDEDC',
    textPrimary: '#252525',
    textMuted: '#6A6966',
    accent: '#7B7A77',
    inputBg: '#FFFFFF',
    inputBorder: '#DEDEDC',
    primaryButtonBg: '#252525',
    primaryButtonText: '#F7F7F5',
  },
  archive_green: {
    sidebarBg: '#29332F',
    sidebarText: '#F0EDE4',
    sidebarMuted: '#B9B8AC',
    sidebarActiveBg: '#3A4444',
    sidebarHoverBg: '#333D3D',
    mainBg: '#E8E4DB',
    panelBg: '#F4F0E8',
    panelHeaderBg: '#F4F0E8',
    border: '#D8D0C4',
    textPrimary: '#282824',
    textMuted: '#63625B',
    accent: '#485A50',
    inputBg: '#FAF8F3',
    inputBorder: '#CEC7BB',
    primaryButtonBg: '#282824',
    primaryButtonText: '#F9F7F2',
  },
  charcoal: {
    sidebarBg: '#202122',
    sidebarText: '#F2F0EC',
    sidebarMuted: '#BCBAB4',
    sidebarActiveBg: '#56585B',
    sidebarHoverBg: '#4A4C4E',
    mainBg: '#262728',
    panelBg: '#343536',
    panelHeaderBg: '#343536',
    border: '#56585B',
    textPrimary: '#F2F0EC',
    textMuted: '#C9C7C3',
    accent: '#56585B',
    inputBg: '#414243',
    inputBorder: '#64666A',
    primaryButtonBg: '#F2F0EC',
    primaryButtonText: '#222325',
  },
};

function normalizeHex(value: string): string {
  const hex = value.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) {
    return '#3B46D9';
  }
  return `#${hex}`;
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
  const hex = normalizeHex(value).replace('#', '');
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function tint(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function readableTextColor(bg: string): string {
  const { r, g, b } = hexToRgb(bg);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.57 ? '#1E1E1E' : '#F5F4F1';
}

function customThemePalette(color: string): ThemePalette {
  const base = normalizeHex(color);
  const sidebarText = readableTextColor(base);
  const isLightText = sidebarText !== '#1E1E1E';
  return {
    sidebarBg: base,
    sidebarText,
    sidebarMuted: isLightText ? tint(base, 0.56) : shade(base, 0.42),
    sidebarActiveBg: isLightText ? tint(base, 0.2) : shade(base, 0.16),
    sidebarHoverBg: isLightText ? tint(base, 0.14) : shade(base, 0.1),
    mainBg: '#EAEAE8',
    panelBg: '#F6F6F4',
    panelHeaderBg: '#F6F6F4',
    border: '#DEDEDC',
    textPrimary: '#252525',
    textMuted: '#666561',
    accent: base,
    inputBg: '#FFFFFF',
    inputBorder: '#DEDEDC',
    primaryButtonBg: base,
    primaryButtonText: sidebarText,
  };
}

function paletteToCssVars(palette: ThemePalette): CSSProperties {
  return {
    '--color-sidebar-bg': palette.sidebarBg,
    '--color-sidebar-text': palette.sidebarText,
    '--color-sidebar-muted': palette.sidebarMuted,
    '--color-sidebar-active-bg': palette.sidebarActiveBg,
    '--color-sidebar-hover-bg': palette.sidebarHoverBg,
    '--color-main-bg': palette.mainBg,
    '--color-panel-bg': palette.panelBg,
    '--color-panel-header-bg': palette.panelHeaderBg,
    '--color-border': palette.border,
    '--color-text-primary': palette.textPrimary,
    '--color-text-muted': palette.textMuted,
    '--color-accent': palette.accent,
    '--color-input-bg': palette.inputBg,
    '--color-input-border': palette.inputBorder,
    '--color-primary-button-bg': palette.primaryButtonBg,
    '--color-primary-button-text': palette.primaryButtonText,
  } as CSSProperties;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function clampToWordLimit(value: string, limit: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) {
    return value;
  }
  return words.slice(0, limit).join(' ');
}

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

function normalizeAvailability(value: string | null): string {
  if (!value || value === 'Yes') {
    return 'Available';
  }
  if (value === 'In Show') {
    return 'On Exhibition';
  }
  return value;
}

function draftFromArtwork(artwork: Artwork): ArtworkDraft {
  return {
    title: artwork.title ?? '',
    year: artwork.year ?? '',
    mediumMaterials: artwork.mediumMaterials ?? '',
    materials: artwork.materials ?? '',
    height: artwork.height?.toString() ?? '',
    width: artwork.width?.toString() ?? '',
    depth: artwork.depth?.toString() ?? '',
    dimensionsUnit: artwork.dimensionsUnit ?? 'cm',
    weight: artwork.weight?.toString() ?? '',
    weightUnit: artwork.weightUnit ?? 'kg',
    editionInfo: artwork.editionInfo ?? '',
    price: artwork.price?.toString() ?? '',
    currency: artwork.currency ?? 'USD',
    availability: normalizeAvailability(artwork.availability),
    collectionSeries: artwork.collectionSeries ?? '',
    tags: artwork.tags.join(', '),
    shortDescription: artwork.shortDescription ?? '',
    longDescription: artwork.longDescription ?? '',
    artworkStatement: artwork.artworkStatement ?? '',
    processNotes: artwork.processNotes ?? '',
    exhibitionHistory: artwork.exhibitionHistory ?? '',
    privateNotes: artwork.privateNotes ?? '',
  };
}

function payloadFromDraft(draft: ArtworkDraft): ArtworkPayload {
  const toNullableString = (value: string) => (value.trim() ? value.trim() : null);
  const toNullableNumber = (value: string) => {
    if (!value.trim()) {
      return null;
    }

    // Accept common artist-entered formats like "$1,200" and "1 200".
    const normalized = value.replace(/[$,\s]/g, '').trim();
    if (!normalized) {
      return null;
    }

    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  return {
    title: draft.title.trim(),
    year: toNullableString(draft.year),
    mediumMaterials: toNullableString(draft.mediumMaterials),
    materials: toNullableString(draft.materials),
    height: toNullableNumber(draft.height),
    width: toNullableNumber(draft.width),
    depth: toNullableNumber(draft.depth),
    dimensionsUnit: toNullableString(draft.dimensionsUnit),
    weight: toNullableNumber(draft.weight),
    weightUnit: toNullableString(draft.weightUnit),
    editionInfo: toNullableString(draft.editionInfo),
    price: toNullableNumber(draft.price),
    currency: toNullableString(draft.currency),
    availability: toNullableString(draft.availability),
    collectionSeries: toNullableString(draft.collectionSeries),
    tags: draft.tags
      .split(/[\n,]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    shortDescription: toNullableString(draft.shortDescription),
    longDescription: toNullableString(draft.longDescription),
    artworkStatement: toNullableString(draft.artworkStatement),
    processNotes: toNullableString(draft.processNotes),
    exhibitionHistory: toNullableString(draft.exhibitionHistory),
    privateNotes: toNullableString(draft.privateNotes),
  };
}

function App() {
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>(() => {
    if (typeof window === 'undefined') {
      return 'archive_green';
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'gallery_white' || saved === 'archive_green' || saved === 'charcoal' || saved === 'custom') {
      return saved;
    }
    return 'archive_green';
  });
  const [customThemeColor, setCustomThemeColor] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return '#3B46D9';
    }
    return normalizeHex(window.localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY) ?? '#3B46D9');
  });
  const [viewMode, setViewMode] = useState<'archive' | 'application'>('archive');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [artworks, setArtworks] = useState<ArtworkSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Artwork | null>(null);
  const [draft, setDraft] = useState<ArtworkDraft>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [archiveEditing, setArchiveEditing] = useState(false);
  const [archiveView, setArchiveView] = useState<'large' | 'small'>('large');
  const [activeArtworkTab, setActiveArtworkTab] = useState<'overview' | 'statement' | 'history'>('overview');
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveKeywordFilter, setArchiveKeywordFilter] = useState('All');
  const [selectedForExportIds, setSelectedForExportIds] = useState<string[]>([]);
  const [draggedExportArtworkId, setDraggedExportArtworkId] = useState<string | null>(null);
  const [requirementsPrompt, setRequirementsPrompt] = useState('');
  const [applicationTitle, setApplicationTitle] = useState('');
  const [filenamePrefix, setFilenamePrefix] = useState('justin_zielke');
  const [applicationPanelTab, setApplicationPanelTab] = useState<'builder' | 'selection'>('selection');
  const [exportType, setExportType] = useState<ExportType>('portfolio_pdf');
  const [exportRequirements, setExportRequirements] = useState<ExportRequirements>({
    imageCount: null,
    maxIndividualFileSizeMb: null,
    maxTotalSizeMb: null,
    longestEdgePx: 2048,
    dpi: null,
    includeLabels: true,
    labelFontSizePt: 12,
    labelFields: ['title', 'year', 'medium', 'dimensions'],
    includeInventoryList: true,
    pdfImageLayout: 'centered',
  });
  const [builderStatus, setBuilderStatus] = useState('');
  const [parsingRequirements, setParsingRequirements] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportGenerationResult | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeHero = useMemo(() => detail?.images.find((img) => img.isPrimary) ?? detail?.images[0] ?? null, [detail]);
  const previewImage = useMemo(() => {
    if (!detail) {
      return null;
    }
    return detail.images.find((img) => img.id === previewImageId) ?? activeHero;
  }, [detail, previewImageId, activeHero]);

  const activeKeywords = useMemo(
    () =>
      draft.tags
        .split(/[\n,]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    [draft.tags],
  );

  const blurbWords = useMemo(() => wordCount(draft.shortDescription), [draft.shortDescription]);
  const statementWords = useMemo(() => wordCount(draft.artworkStatement), [draft.artworkStatement]);

  const archiveKeywordOptions = useMemo(() => {
    const all = new Set<string>(suggestedKeywords);
    for (const artwork of artworks) {
      for (const tag of artwork.tags) {
        if (tag.trim()) {
          all.add(tag.trim());
        }
      }
    }
    return ['All', ...Array.from(all).sort((a, b) => a.localeCompare(b))];
  }, [artworks]);

  const filteredArtworks = useMemo(() => {
    const query = archiveQuery.trim().toLowerCase();

    return artworks.filter((artwork) => {
      if (archiveKeywordFilter !== 'All') {
        const hasKeyword = artwork.tags.some(
          (tag) => tag.toLowerCase() === archiveKeywordFilter.toLowerCase(),
        );
        if (!hasKeyword) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      const haystack = [artwork.title, artwork.year ?? '', artwork.mediumMaterials ?? '', artwork.tags.join(' ')].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [artworks, archiveQuery, archiveKeywordFilter]);

  const selectedForExportArtworks = useMemo(() => {
    const byId = new Map(artworks.map((artwork) => [artwork.id, artwork]));
    return selectedForExportIds
      .map((artworkId) => byId.get(artworkId))
      .filter((artwork): artwork is ArtworkSummary => Boolean(artwork));
  }, [artworks, selectedForExportIds]);

  const exportFileStem = useMemo(() => {
    const safePrefix = (filenamePrefix || 'artist')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]+/g, '')
      .replace(/^_+|_+$/g, '') || 'artist';
    const safeTitle = (applicationTitle || 'Application')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '') || 'Application';
    return `${safePrefix}_${safeTitle}`;
  }, [filenamePrefix, applicationTitle]);

  const activePalette = useMemo(() => {
    if (appearanceTheme === 'custom') {
      return customThemePalette(customThemeColor);
    }
    return PRESET_THEMES[appearanceTheme];
  }, [appearanceTheme, customThemeColor]);

  const themeVars = useMemo(() => paletteToCssVars(activePalette), [activePalette]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, appearanceTheme);
  }, [appearanceTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(CUSTOM_COLOR_STORAGE_KEY, normalizeHex(customThemeColor));
  }, [customThemeColor]);

  // The archive folder is the source of truth for settings, so they follow the data across
  // updates and computers. Browser storage above is only a cache that avoids a flash on load.
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((saved) => {
        if (cancelled) {
          return;
        }
        if (saved.theme) {
          setAppearanceTheme(saved.theme);
        }
        if (saved.customColor) {
          setCustomThemeColor(normalizeHex(saved.customColor));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }
    saveSettings({ theme: appearanceTheme, customColor: normalizeHex(customThemeColor) }).catch(() => undefined);
  }, [settingsLoaded, appearanceTheme, customThemeColor]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    void refreshArtworks();
  }, []);

  useEffect(() => {
    if (!detail) {
      setPreviewImageId(null);
      return;
    }

    const fallback = detail.images.find((img) => img.isPrimary) ?? detail.images[0] ?? null;
    if (!fallback) {
      setPreviewImageId(null);
      return;
    }

    setPreviewImageId((prev) => {
      if (prev && detail.images.some((img) => img.id === prev)) {
        return prev;
      }
      return fallback.id;
    });
  }, [detail]);

  async function refreshArtworks() {
    setLoading(true);
    try {
      const list = await listArtworks();
      setArtworks(list);
      if (!selectedId && list.length > 0) {
        await openArtwork(list[0].id);
      }
      if (selectedId && !list.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
        setDraft(blankDraft);
      }
    } catch (error) {
      console.error(error);
      setStatus('Failed to load artworks.');
    } finally {
      setLoading(false);
    }
  }

  async function openArtwork(id: string) {
    setSelectedId(id);
    const artwork = await getArtwork(id);
    setDetail(artwork);
    setDraft(draftFromArtwork(artwork));
    setArchiveEditing(false);
    setStatus('');
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      setStatus('Title is required.');
      return;
    }

    if (blurbWords > BLURB_WORD_LIMIT) {
      setStatus(`Description must be ${BLURB_WORD_LIMIT} words or fewer.`);
      return;
    }

    if (statementWords > STATEMENT_WORD_LIMIT) {
      setStatus(`Statement must be ${STATEMENT_WORD_LIMIT} words or fewer.`);
      return;
    }

    setSaving(true);
    try {
      const payload = payloadFromDraft(draft);
      if (!selectedId) {
        const created = await createArtwork(payload);
        setSelectedId(created.id);
        await openArtwork(created.id);
      } else {
        await updateArtwork(selectedId, payload);
        await openArtwork(selectedId);
      }
      await refreshArtworks();
      setStatus('Saved.');
    } catch (error) {
      console.error(error);
      setStatus('Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteArtwork() {
    if (!selectedId) {
      return;
    }
    const confirmed = window.confirm('Delete this artwork and all associated images?');
    if (!confirmed) {
      return;
    }

    await deleteArtwork(selectedId);
    setSelectedId(null);
    setDetail(null);
    setDraft(blankDraft);
    setArchiveEditing(false);
    await refreshArtworks();
    setStatus('Artwork deleted.');
  }

  async function ensureArtworkForUpload(): Promise<string | null> {
    if (selectedId) {
      return selectedId;
    }

    if (!draft.title.trim()) {
      setStatus('Add a title before uploading images for a new artwork.');
      return null;
    }

    const created = await createArtwork(payloadFromDraft(draft));
    setSelectedId(created.id);
    await openArtwork(created.id);
    await refreshArtworks();
    return created.id;
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) {
      return;
    }

    setUploading(true);
    try {
      const artworkId = await ensureArtworkForUpload();
      if (!artworkId) {
        return;
      }

      await uploadArtworkImages(artworkId, Array.from(event.target.files));
      await openArtwork(artworkId);
      await refreshArtworks();
      setStatus('Images uploaded. Originals preserved; thumbnails generated.');
    } catch (error) {
      console.error(error);
      setStatus('Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function handleImageMetaSave(image: ArtworkImage, patch: Partial<ArtworkImage>) {
    await updateImage(image.id, {
      caption: patch.caption ?? image.caption ?? null,
      credit: patch.credit ?? image.credit ?? null,
      isDetail: patch.isDetail ?? image.isDetail,
    });
    if (selectedId) {
      await openArtwork(selectedId);
    }
  }

  async function handlePrimaryImage(imageId: string) {
    await setPrimaryImage(imageId);
    if (selectedId) {
      await openArtwork(selectedId);
      await refreshArtworks();
    }
  }

  async function handleDeleteImage(imageId: string) {
    const confirmed = window.confirm('Delete this image? The original file copy for this artwork will be removed.');
    if (!confirmed) {
      return;
    }

    await deleteImage(imageId);
    if (selectedId) {
      await openArtwork(selectedId);
      await refreshArtworks();
    }
  }

  async function handleDrop(targetImageId: string) {
    if (!draggedImageId || !detail || !selectedId || draggedImageId === targetImageId) {
      return;
    }

    const reordered = [...detail.images];
    const fromIndex = reordered.findIndex((img) => img.id === draggedImageId);
    const toIndex = reordered.findIndex((img) => img.id === targetImageId);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    await reorderImages(selectedId, reordered.map((img) => img.id));
    await openArtwork(selectedId);
    setDraggedImageId(null);
  }

  function parseNumber(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(value: number): string {
    return Number(value.toFixed(3)).toString();
  }

  function convertDimensions(nextUnit: 'in' | 'cm') {
    setDraft((prev) => {
      const currentUnit = (prev.dimensionsUnit || 'cm').toLowerCase();
      if (currentUnit === nextUnit) {
        return { ...prev, dimensionsUnit: nextUnit };
      }

      const factor = currentUnit === 'in' && nextUnit === 'cm' ? 2.54 : 1 / 2.54;
      const convertOne = (value: string) => {
        const n = parseNumber(value);
        if (n === null) {
          return value;
        }

        const converted = n * factor;
        if (nextUnit === 'cm') {
          return Math.round(converted).toString();
        }

        return formatNumber(converted);
      };

      return {
        ...prev,
        dimensionsUnit: nextUnit,
        height: convertOne(prev.height),
        width: convertOne(prev.width),
        depth: convertOne(prev.depth),
      };
    });
  }

  function convertWeight(nextUnit: 'lb' | 'kg') {
    setDraft((prev) => {
      const currentUnit = (prev.weightUnit || 'kg').toLowerCase();
      if (currentUnit === nextUnit) {
        return { ...prev, weightUnit: nextUnit };
      }

      const factor = currentUnit === 'lb' && nextUnit === 'kg' ? 0.45359237 : 1 / 0.45359237;
      const n = parseNumber(prev.weight);

      return {
        ...prev,
        weightUnit: nextUnit,
        weight: n === null ? prev.weight : formatNumber(n * factor),
      };
    });
  }

  function autoGrowTextarea(event: ChangeEvent<HTMLTextAreaElement>) {
    event.target.style.height = 'auto';
    event.target.style.height = `${event.target.scrollHeight}px`;
  }

  function setKeywords(values: string[]) {
    const deduped = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
    setDraft((prev) => ({ ...prev, tags: deduped.join(', ') }));
  }

  function toggleKeyword(value: string) {
    const exists = activeKeywords.some((keyword) => keyword.toLowerCase() === value.toLowerCase());
    if (exists) {
      setKeywords(activeKeywords.filter((keyword) => keyword.toLowerCase() !== value.toLowerCase()));
      return;
    }
    setKeywords([...activeKeywords, value]);
  }

  function toNullableInt(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const rounded = Math.round(parsed);
    return rounded > 0 ? rounded : null;
  }

  function toNullableNumber(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function formatPreviewDimensions(artwork: ArtworkSummary): string {
    const dims = [artwork.height, artwork.width, artwork.depth].filter((value) => value !== null && value !== undefined) as number[];
    if (dims.length === 0) {
      return '';
    }
    return `${dims.join(' x ')} ${(artwork.dimensionsUnit ?? '').trim()}`.trim();
  }

  function formatPreviewPrice(artwork: ArtworkSummary): string {
    if (artwork.price === null || artwork.price === undefined) {
      return '';
    }
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: artwork.price % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(artwork.price);
    return `${(artwork.currency || 'USD').trim()} ${formatted}`;
  }

  function formatDraftPrice(value: string): string {
    const normalized = value.replace(/[$,\s]/g, '').trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return value;
    }
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(parsed);
  }

  function buildPreviewLabelParts(artwork: ArtworkSummary): Array<{ field: LabelField; text: string }> {
    const partsByField: Record<Exclude<LabelField, 'page_number'>, string> = {
      title: artwork.title,
      year: artwork.year ?? '',
      medium: artwork.mediumMaterials ?? '',
      dimensions: formatPreviewDimensions(artwork),
      price: formatPreviewPrice(artwork),
      credit: artwork.primaryImageCredit ?? '',
    };

    const ordered: LabelField[] = ['title', 'year', 'medium', 'dimensions', 'price', 'credit'];
    const selected = new Set(exportRequirements.labelFields);

    return ordered
      .filter((field) => selected.has(field))
      .map((field) => {
        const raw = partsByField[field].trim();
        const text = field === 'title' || field === 'medium' || field === 'credit' ? toDisplayCase(raw) : raw;
        return { field, text };
      })
      .filter((entry) => entry.text.length > 0);
  }

  function toggleLabelField(field: LabelField) {
    setExportRequirements((prev) => {
      const exists = prev.labelFields.includes(field);
      if (exists) {
        return { ...prev, labelFields: prev.labelFields.filter((item) => item !== field) };
      }
      return { ...prev, labelFields: [...prev.labelFields, field] };
    });
  }

  function toggleExportSelection(artworkId: string) {
    setSelectedForExportIds((prev) => {
      if (prev.includes(artworkId)) {
        return prev.filter((idValue) => idValue !== artworkId);
      }
      return [...prev, artworkId];
    });
  }

  function handleExportPreviewDrop(targetArtworkId: string) {
    if (!draggedExportArtworkId || draggedExportArtworkId === targetArtworkId) {
      return;
    }

    setSelectedForExportIds((prev) => {
      const fromIndex = prev.indexOf(draggedExportArtworkId);
      const toIndex = prev.indexOf(targetArtworkId);
      if (fromIndex === -1 || toIndex === -1) {
        return prev;
      }

      const reordered = [...prev];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reordered;
    });

    setDraggedExportArtworkId(null);
  }

  async function handleParseRequirements() {
    if (!requirementsPrompt.trim()) {
      setBuilderStatus('Paste requirements text to parse.');
      return;
    }

    setParsingRequirements(true);
    setBuilderStatus('');
    try {
      const parsed = await parseRequirements(requirementsPrompt);
      setExportRequirements((prev) => ({
        ...prev,
        imageCount: parsed.imageCount,
        maxIndividualFileSizeMb: parsed.maxIndividualFileSizeMb,
        maxTotalSizeMb: parsed.maxTotalSizeMb,
        longestEdgePx: parsed.longestEdgePx,
        dpi: parsed.dpi,
      }));

      if (parsed.notes.length > 0) {
        setBuilderStatus(`Parsed with notes: ${parsed.notes.join(' ')}`);
      } else {
        setBuilderStatus('Requirements parsed. Review and edit fields below.');
      }
    } catch (error) {
      console.error(error);
      setBuilderStatus('Failed to parse requirements prompt.');
    } finally {
      setParsingRequirements(false);
    }
  }

  async function handleGenerateExport() {
    if (selectedForExportIds.length === 0) {
      setBuilderStatus('Select at least one artwork from the archive grid.');
      return;
    }

    if (!applicationTitle.trim()) {
      setBuilderStatus('Enter an application title, like Krasner Foundation.');
      return;
    }

    if (!filenamePrefix.trim()) {
      setBuilderStatus('Enter a filename prefix, like justin_zielke.');
      return;
    }

    setExporting(true);
    setBuilderStatus('');
    setLastExport(null);

    try {
      const result = await generateExport({
        applicationTitle,
        filenamePrefix,
        exportType,
        selectedArtworkIds: selectedForExportIds,
        requirements: exportRequirements,
      });

      setLastExport(result);

      if (result.warnings.length > 0) {
        setBuilderStatus(`Export generated with warnings: ${result.warnings.join(' ')}`);
      } else {
        setBuilderStatus('Export generated successfully.');
      }
    } catch (error) {
      console.error(error);
      setBuilderStatus('Failed to generate export artifact.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="h-screen flex bg-[var(--color-main-bg)] text-[var(--color-text-primary)]" style={themeVars} data-appearance-theme={appearanceTheme}>
      <aside className="sidebar-surface relative z-20 w-64 shrink-0 bg-[var(--color-sidebar-bg)] text-[var(--color-sidebar-text)] px-6 py-8 flex flex-col justify-between">
        <div className="space-y-10">
          <div className="mx-auto w-full max-w-[190px] text-center">
            <p className="type-sidebar-wordmark">A R T A L O G</p>
            <p className="type-sidebar-subtitle mt-3 text-[var(--color-sidebar-muted)]">Submission Archive</p>
          </div>

          <nav className="space-y-2">
            <button
              type="button"
              onClick={() => setViewMode('archive')}
              className={`type-sidebar-nav w-full text-left px-3 py-2.5 rounded-md transition-colors ${viewMode === 'archive' ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-text)]' : 'text-[var(--color-sidebar-muted)] hover:bg-[var(--color-sidebar-hover-bg)]'}`}
            >
              Archive
            </button>
            <button
              type="button"
              onClick={() => setViewMode('application')}
              className={`type-sidebar-nav w-full text-left px-3 py-2.5 rounded-md transition-colors ${viewMode === 'application' ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-text)]' : 'text-[var(--color-sidebar-muted)] hover:bg-[var(--color-sidebar-hover-bg)]'}`}
            >
              Applications
            </button>
          </nav>
        </div>

        <div className="pt-6 border-t border-[var(--color-sidebar-hover-bg)] relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="type-sidebar-nav w-full px-3 py-2.5 rounded-md text-left text-[var(--color-sidebar-muted)] hover:bg-[var(--color-sidebar-hover-bg)] flex items-center gap-2"
            aria-label="Open settings"
          >
            <span aria-hidden="true">⚙</span>
            Settings
          </button>

          {menuOpen ? (
            <div className="surface-panel absolute left-0 bottom-12 z-50 w-[300px] border border-[var(--color-border)] rounded-md bg-[var(--color-panel-bg)] text-[var(--color-text-primary)] overflow-hidden p-3 space-y-2">
              <p className="type-panel-heading text-[var(--color-text-muted)]">Appearance</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['gallery_white', 'Gallery White', PRESET_THEMES.gallery_white],
                  ['archive_green', 'Archive Green', PRESET_THEMES.archive_green],
                  ['charcoal', 'Charcoal', PRESET_THEMES.charcoal],
                  ['custom', 'Custom Color', customThemePalette(customThemeColor)],
                ] as const).map(([key, label, palette]) => {
                  const isActive = appearanceTheme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAppearanceTheme(key)}
                      className={`rounded-md border p-2 text-left ${isActive ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
                    >
                      <div className="h-10 rounded-sm border overflow-hidden" style={{ borderColor: palette.border }}>
                        <div className="h-2/5" style={{ background: palette.sidebarBg }} />
                        <div className="h-3/5" style={{ background: palette.mainBg }}>
                          <div className="h-full mx-2 mt-1 rounded-sm" style={{ background: palette.panelBg, border: `1px solid ${palette.border}` }} />
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="type-caption text-[var(--color-text-primary)]">{label}</span>
                        {isActive ? <span className="type-caption">✓</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              {appearanceTheme === 'custom' ? (
                <div className="pt-1 space-y-1">
                  <label className="type-caption text-[var(--color-text-muted)]">Custom Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={normalizeHex(customThemeColor)}
                      onChange={(event) => setCustomThemeColor(normalizeHex(event.target.value))}
                      className="h-8 w-12 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0"
                    />
                    <input
                      value={customThemeColor}
                      onChange={(event) => setCustomThemeColor(normalizeHex(event.target.value))}
                      className="type-body"
                      placeholder="#3B46D9"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="paper-surface paper-surface-main flex-1 min-w-0 px-8 py-8 flex flex-col min-h-0">
        <header className="pb-5 border-b border-[var(--color-border)] flex items-baseline justify-end gap-[18px]">
          <h1 className="type-page-heading text-[17px] leading-[32.4px] text-[var(--color-text-primary)]">Collection</h1>
          <p className="type-sidebar-subtitle -mr-[3px] tabular-nums text-[var(--color-text-muted)]">
            {String(artworks.length).padStart(3, '0')} {artworks.length === 1 ? 'Work' : 'Works'}
          </p>
        </header>

        <main className={viewMode === 'archive' ? 'pt-5 archive-workspace flex-1 min-h-0' : 'pt-5 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start flex-1 min-h-0'}>
        <section className="surface-panel panel-lit paper-surface paper-origin-archive border border-[var(--color-border)] rounded-xl bg-[var(--color-panel-bg)] overflow-hidden min-h-0 flex flex-col">
          <div className="px-4 py-3 flex justify-between items-center bg-[var(--color-panel-header-bg)]">
            <div className="flex items-center gap-2">
              <h2 className="type-panel-heading title-letterpress">{viewMode === 'application' ? 'Selected Works' : 'All Works'}</h2>
            </div>
            <div className="flex rounded-md border border-[var(--color-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => setArchiveView('small')}
                className={`px-2 py-1.5 ${archiveView === 'small' ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-text)]' : 'bg-transparent text-[var(--color-text-muted)]'}`}
                aria-label="Small list view"
                title="Small list view"
              >
                <span className="sr-only">Small list view</span>
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <rect x="5" y="5" width="6" height="6" rx="0.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setArchiveView('large')}
                className={`px-2 py-1.5 border-l border-[var(--color-border)] ${archiveView === 'large' ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-text)]' : 'bg-transparent text-[var(--color-text-muted)]'}`}
                aria-label="Large list view"
                title="Large list view"
              >
                <span className="sr-only">Large list view</span>
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <rect x="2" y="2" width="12" height="12" rx="0.6" />
                </svg>
              </button>
            </div>
            {viewMode === 'archive' ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                  setDraft(blankDraft);
                  setArchiveEditing(true);
                  setStatus('New artwork draft ready.');
                }}
                className="type-button px-3 py-2 bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] rounded-md hover:opacity-90"
              >
                New artwork
              </button>
            ) : null}
          </div>
          <div className="p-3 space-y-3 min-h-0 overflow-y-auto">
            {viewMode === 'application' ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setApplicationPanelTab('selection')}
                className={`type-button px-2 py-2 rounded-md border ${applicationPanelTab === 'selection' ? 'bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] border-[var(--color-primary-button-bg)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
              >
                Image Selection
              </button>
              <button
                type="button"
                onClick={() => setApplicationPanelTab('builder')}
                className={`type-button px-2 py-2 rounded-md border ${applicationPanelTab === 'builder' ? 'bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] border-[var(--color-primary-button-bg)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
              >
                Export
              </button>
            </div>
            ) : null}

            {viewMode === 'application' && applicationPanelTab === 'builder' ? (
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-panel-bg)]">
              <div className="flex items-center justify-between">
                <p className="type-panel-heading text-[var(--color-text-muted)]">Export</p>
                <span className="type-caption text-[var(--color-text-muted)]">{selectedForExportIds.length} selected</span>
              </div>

              <input
                value={applicationTitle}
                onChange={(event) => setApplicationTitle(event.target.value)}
                placeholder="Application title (e.g. Krasner Foundation)"
              />

              <input
                value={filenamePrefix}
                onChange={(event) => setFilenamePrefix(event.target.value)}
                placeholder="Filename prefix (e.g. justin_zielke)"
              />

              <textarea
                rows={3}
                value={requirementsPrompt}
                onChange={(event) => setRequirementsPrompt(event.target.value)}
                placeholder="Paste open call requirements prompt here"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleParseRequirements()}
                  disabled={parsingRequirements}
                  className="type-button px-2 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-input-bg)]"
                >
                  {parsingRequirements ? 'Parsing...' : 'Parse prompt'}
                </button>
                <select value={exportType} onChange={(event) => setExportType(event.target.value as ExportType)}>
                  <option value="portfolio_pdf">Portfolio PDF</option>
                  <option value="images_zip">Images ZIP</option>
                </select>
              </div>

              <select
                value={exportRequirements.pdfImageLayout}
                onChange={(event) =>
                  setExportRequirements((prev) => ({
                    ...prev,
                    pdfImageLayout: event.target.value as ExportRequirements['pdfImageLayout'],
                  }))
                }
              >
                <option value="centered">PDF image: centered in frame</option>
                <option value="full_image">PDF image: full image (no 8.5x11 frame)</option>
              </select>

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={exportRequirements.imageCount?.toString() ?? ''}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      imageCount: toNullableInt(event.target.value),
                    }))
                  }
                  placeholder="Image count"
                />
                <input
                  value={exportRequirements.longestEdgePx?.toString() ?? ''}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      longestEdgePx: toNullableInt(event.target.value),
                    }))
                  }
                  placeholder="Longest edge px"
                />
                <input
                  value={exportRequirements.maxIndividualFileSizeMb?.toString() ?? ''}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      maxIndividualFileSizeMb: toNullableNumber(event.target.value),
                    }))
                  }
                  placeholder="Max each MB"
                />
                <input
                  value={exportRequirements.maxTotalSizeMb?.toString() ?? ''}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      maxTotalSizeMb: toNullableNumber(event.target.value),
                    }))
                  }
                  placeholder="Max total MB"
                />
                <select
                  value={exportRequirements.labelFontSizePt.toString()}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      labelFontSizePt: Number(event.target.value),
                    }))
                  }
                >
                  <option value="8">Label font size: 8 pt</option>
                  <option value="10">Label font size: 10 pt</option>
                  <option value="12">Label font size: 12 pt</option>
                </select>
              </div>

              <label className="type-body flex items-center gap-2 text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={exportRequirements.includeLabels}
                  onChange={(event) =>
                    setExportRequirements((prev) => ({
                      ...prev,
                      includeLabels: event.target.checked,
                    }))
                  }
                />
                Include labels
              </label>

              {exportRequirements.includeLabels ? (
                <div className="space-y-1 rounded-md border border-[var(--color-border)] p-2 bg-[var(--color-panel-bg)]">
                  <p className="type-caption text-[var(--color-text-muted)]">Label fields (common order is fixed):</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['title', 'Title'],
                      ['year', 'Year'],
                      ['medium', 'Medium'],
                      ['dimensions', 'Dimensions'],
                      ['price', 'Price'],
                      ['credit', 'Photo credit'],
                      ['page_number', 'PDF page number'],
                    ] as [LabelField, string][]).map(([value, label]) => (
                      <label key={value} className="type-body flex items-center gap-2 text-[var(--color-text-muted)]">
                        <input
                          type="checkbox"
                          checked={exportRequirements.labelFields.includes(value)}
                          onChange={() => toggleLabelField(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="type-body text-[var(--color-text-muted)]">
                Inventory is always included. Exports now include a small thumbnail per artwork for quick reference.
              </p>

              <button
                type="button"
                onClick={() => void handleGenerateExport()}
                disabled={exporting}
                className="type-button w-full px-2 py-2 bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] rounded-md"
              >
                {exporting ? 'Generating...' : 'Generate export'}
              </button>

              {lastExport ? (
                <a
                  href={`${apiBase}${lastExport.downloadUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="type-button block text-center px-2 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-input-bg)]"
                >
                  Download {lastExport.fileName}
                </a>
              ) : null}

              {builderStatus ? <p className="type-caption text-graphite-500">{builderStatus}</p> : null}
            </div>
            ) : null}

            {(viewMode === 'archive' || applicationPanelTab === 'selection') ? (
            <>
            <div className="border-y border-[var(--color-border)] py-2">
              <div className="grid grid-cols-[1fr_132px] gap-2">
                <input
                  value={archiveQuery}
                  placeholder="Search Archive"
                  onChange={(event) => setArchiveQuery(event.target.value)}
                />
                <select
                  value={archiveKeywordFilter}
                  onChange={(event) => setArchiveKeywordFilter(event.target.value)}
                >
                  {archiveKeywordOptions.map((keyword) => (
                    <option key={keyword} value={keyword}>
                      {keyword === 'All' ? 'All Media' : keyword}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {viewMode === 'archive' && loading && <p className="type-body text-graphite-500">Loading...</p>}
              {viewMode === 'archive' && !loading && artworks.length === 0 && (
                <p className="type-body text-graphite-500">No artworks yet. Create your first entry.</p>
              )}
              {viewMode === 'archive' && !loading && artworks.length > 0 && filteredArtworks.length === 0 && (
                <p className="type-body text-graphite-500">No artworks match this filter.</p>
              )}
              {filteredArtworks.map((artwork) => {
                const isSmall = archiveView === 'small';
                const isSelectedForExport = selectedForExportIds.includes(artwork.id);
                return (
                  <div
                    key={artwork.id}
                    className={`surface-card surface-card-hover relative border rounded-lg overflow-hidden ${selectedId === artwork.id ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-panel-bg)_85%,var(--color-accent)_15%)]' : 'border-[var(--color-border)] bg-[var(--color-panel-bg)]'}`}
                  >
                    <button
                      type="button"
                      onClick={() => void openArtwork(artwork.id)}
                      className={`w-full text-left flex items-stretch ${isSmall ? 'gap-2 p-1.5' : 'gap-3 p-2'} ${viewMode === 'application' ? 'pr-10' : ''}`}
                    >
                      <div className={`${isSmall ? 'w-[56px] h-[56px]' : 'w-[112px] h-[112px]'} shrink-0 bg-[var(--color-panel-header-bg)]`}>
                        {artwork.primaryThumbnailUrl ? (
                          <img
                            src={`${apiBase}${artwork.primaryThumbnailUrl}`}
                            alt={artwork.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="type-caption w-full h-full flex items-center justify-center text-graphite-500">No image</div>
                        )}
                      </div>
                      <div className={`flex-1 min-w-0 ${isSmall ? 'flex flex-col justify-center' : 'py-1'}`}>
                        <p className="type-artwork-list truncate">{artwork.title}</p>
                        <p className="type-body text-graphite-500 truncate mt-1">{artwork.year || 'Year not set'}</p>
                        {!isSmall ? (
                          <>
                            <p className="type-body text-graphite-600 truncate mt-1">{artwork.mediumMaterials || 'Medium not set'}</p>
                            <p className="type-caption text-graphite-500 truncate mt-1">{artwork.collectionSeries || 'Untitled collection'}</p>
                          </>
                        ) : null}
                      </div>
                    </button>
                    {viewMode === 'application' ? (
                      <label className="absolute top-1/2 right-2 -translate-y-1/2 h-6 w-6 rounded-md bg-[var(--color-input-bg)] border border-[var(--color-border)] text-[11px] flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelectedForExport}
                          onChange={() => toggleExportSelection(artwork.id)}
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            </>
            ) : null}
          </div>
        </section>

        {viewMode === 'application' ? (
        <section className="surface-panel paper-surface paper-origin-preview border border-[var(--color-border)] rounded-xl bg-[var(--color-panel-bg)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-panel-header-bg)]">
            <h2 className="text-sm font-semibold uppercase tracking-wider">{applicationPanelTab === 'selection' ? 'Image Selection Preview' : 'Export Preview'}</h2>
            <span className="text-xs text-graphite-500">{selectedForExportArtworks.length} selected</span>
          </div>

          <div className="p-4 space-y-3 max-h-[75vh] overflow-auto">
            {applicationPanelTab === 'selection' ? (
              <>
                <p className="text-[11px] text-graphite-500">Drag thumbnails to reorder. This updates numbering and export order automatically.</p>
                {selectedForExportArtworks.length === 0 ? (
                  <p className="text-sm text-graphite-500">Select artworks in the archive panel to build your submission set.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedForExportArtworks.map((artwork, index) => (
                      <div
                        key={artwork.id}
                        draggable
                        onDragStart={() => setDraggedExportArtworkId(artwork.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => handleExportPreviewDrop(artwork.id)}
                        className="surface-card border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel-bg)] cursor-move"
                      >
                        <div className="aspect-square bg-[var(--color-panel-header-bg)]">
                          {artwork.primaryThumbnailUrl ? (
                            <img
                              src={`${apiBase}${artwork.primaryThumbnailUrl}`}
                              alt={artwork.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-graphite-500">No image</div>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-[11px] text-graphite-500">{String(index + 1).padStart(2, '0')}</p>
                          <p className="text-xs font-medium truncate">{artwork.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-[11px] text-graphite-500">
                  Live export mockup of page order and file naming for this submission.
                </p>
                {selectedForExportArtworks.length === 0 ? (
                  <p className="text-sm text-graphite-500">Select artworks first to preview the final export.</p>
                ) : (
                  <div className="space-y-4">
                    {selectedForExportArtworks.map((artwork, index) => {
                      const order = String(index + 1).padStart(2, '0');
                      const isPdfExport = exportType === 'portfolio_pdf';
                      const previewLabelParts = exportRequirements.includeLabels ? buildPreviewLabelParts(artwork) : [];
                      const previewLabelSizePt = Math.min(Math.max(exportRequirements.labelFontSizePt ?? 12, 8), 24);
                      const isFullImageLayout = exportRequirements.pdfImageLayout === 'full_image';
                      const showPreviewPageNumber =
                        isPdfExport &&
                        exportRequirements.includeLabels &&
                        exportRequirements.labelFields.includes('page_number');
                      const isLandscapeFromDimensions =
                        typeof artwork.width === 'number' &&
                        typeof artwork.height === 'number' &&
                        artwork.width > artwork.height;
                      const previewPageWidthPx = 300;
                      const previewPageWidthPt = isFullImageLayout && isLandscapeFromDimensions ? 792 : 612;
                      const previewScale = previewPageWidthPx / previewPageWidthPt;
                      const previewLabelFontPx = Math.max(previewLabelSizePt * previewScale, 2);
                      const previewLabelHeightPx = Math.max((previewLabelSizePt + 16) * previewScale, 8);
                      return (
                        <div key={artwork.id} className="surface-card rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-bg)] p-3">
                          {isFullImageLayout ? (
                            <div className="mx-auto w-full max-w-[360px] bg-transparent">
                              <div className="flex flex-col">
                                <div className="p-0 bg-[var(--color-input-bg)] flex items-center justify-center">
                                {artwork.primaryThumbnailUrl ? (
                                  <img
                                    src={`${apiBase}${artwork.primaryThumbnailUrl}`}
                                    alt={artwork.title}
                                    className="block w-full h-auto object-contain"
                                  />
                                ) : (
                                  <div className="h-24 flex items-center justify-center text-xs text-graphite-500">No image</div>
                                )}
                              </div>
                              {exportRequirements.includeLabels ? (
                                <div
                                  className="px-2 flex items-center leading-none text-[var(--color-text-muted)] whitespace-nowrap overflow-hidden bg-[var(--color-input-bg)]"
                                  style={{ minHeight: `${previewLabelHeightPx}px`, fontSize: `${previewLabelFontPx}px` }}
                                >
                                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis">
                                    {previewLabelParts.map((entry, partIndex) => (
                                      <span key={`${entry.field}-${partIndex}`} className={entry.field === 'title' ? 'font-semibold' : undefined}>
                                        {partIndex > 0 ? ' | ' : ''}
                                        {entry.text}
                                      </span>
                                    ))}
                                  </span>
                                  {showPreviewPageNumber ? <span className="ml-2 shrink-0">{index + 1}</span> : null}
                                </div>
                              ) : null}
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`mx-auto w-full max-w-[300px] ${isLandscapeFromDimensions ? 'aspect-[11/8.5]' : 'aspect-[8.5/11]'} bg-[var(--color-input-bg)] border border-[var(--color-border)] shadow-sm`}
                            >
                              <div className="h-full flex flex-col">
                                <div className="flex-1 p-3 flex items-center justify-center bg-[var(--color-input-bg)]">
                                  {artwork.primaryThumbnailUrl ? (
                                    <img
                                      src={`${apiBase}${artwork.primaryThumbnailUrl}`}
                                      alt={artwork.title}
                                      className="max-w-full max-h-full object-contain"
                                    />
                                  ) : (
                                    <div className="text-xs text-graphite-500">No image</div>
                                  )}
                                </div>
                                {exportRequirements.includeLabels ? (
                                  <div
                                    className="px-2 flex items-center leading-none text-[var(--color-text-muted)] border-t border-[var(--color-border)] whitespace-nowrap overflow-hidden"
                                    style={{ minHeight: `${previewLabelHeightPx}px`, fontSize: `${previewLabelFontPx}px` }}
                                  >
                                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis">
                                      {previewLabelParts.map((entry, partIndex) => (
                                        <span key={`${entry.field}-${partIndex}`} className={entry.field === 'title' ? 'font-semibold' : undefined}>
                                          {partIndex > 0 ? ' | ' : ''}
                                          {entry.text}
                                        </span>
                                      ))}
                                    </span>
                                    {showPreviewPageNumber ? <span className="ml-2 shrink-0">{index + 1}</span> : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          )}
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-graphite-600 dark:text-graphite-300">
                              {isPdfExport ? `PDF Page ${order}` : `Export File ${order}`}
                            </p>
                            <p className="text-[11px] text-graphite-500 truncate">
                              {`${exportFileStem}_${order}.jpg`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        ) : null}

        {viewMode === 'archive' ? (
        <section className="surface-panel panel-lit-strong paper-surface paper-origin-info border border-[var(--color-border)] rounded-xl bg-[var(--color-panel-bg)] overflow-hidden min-h-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-panel-header-bg)]">
            <div className="flex items-end justify-between gap-4">
              <h2 className="type-artwork-heading title-letterpress text-graphite-800 truncate">{draft.title || 'Select an artwork'}</h2>
              <span className="type-body-strong text-graphite-500">{draft.year || '—'}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
              <div className="flex items-center gap-4">
                {([
                  ['overview', 'Overview'],
                  ['statement', 'Statement'],
                  ['history', 'History'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveArtworkTab(value)}
                    className={`type-tab pb-1 border-b ${activeArtworkTab === value ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-muted)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {!archiveEditing ? (
                  <button
                    type="button"
                    onClick={() => setArchiveEditing(true)}
                    className="type-button px-3 py-2 border border-[var(--color-border)] bg-[var(--color-input-bg)] rounded-md"
                  >
                    Edit
                  </button>
                ) : null}
                {archiveEditing && selectedId ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteArtwork()}
                    className="type-button px-3 py-2 border border-[var(--color-border)] bg-[var(--color-input-bg)] rounded-md"
                  >
                    Delete
                  </button>
                ) : null}
                {archiveEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="type-button px-3 py-2 bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] rounded-md"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (detail) {
                          setDraft(draftFromArtwork(detail));
                        }
                        setArchiveEditing(false);
                        setStatus('');
                      }}
                      className="type-button px-3 py-2 border border-[var(--color-border)] bg-[var(--color-input-bg)] rounded-md"
                    >
                      Done
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="p-4 space-y-3 min-h-0 overflow-y-auto">
            {!archiveEditing ? (
              <>
                {activeArtworkTab === 'overview' ? (
                  <div className="artwork-overview">
                    <div className="artwork-gallery">
                      <div className="py-3 flex items-center justify-center min-h-[420px] min-w-0">
                        {previewImage ? (
                          <div className="image-window">
                            <img src={`${apiBase}${previewImage.originalUrl}`} alt={previewImage.originalFilename} className="block max-w-full max-h-[520px] object-contain" />
                          </div>
                        ) : (
                          <div className="type-body text-graphite-500">No image selected.</div>
                        )}
                      </div>

                      {(detail?.images?.length ?? 0) > 1 ? (
                        <div className="artwork-gallery-thumbs">
                          <div className="artwork-gallery-strip space-y-2">
                            {(detail?.images ?? []).map((image) => (
                              <button
                                key={image.id}
                                type="button"
                                onClick={() => setPreviewImageId(image.id)}
                                className={`block w-[76px] h-[76px] border rounded-sm overflow-hidden ${previewImage?.id === image.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
                              >
                                <img src={`${apiBase}${image.thumbnailUrl}`} alt={image.originalFilename} className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="surface-card border border-[var(--color-border)] rounded-md bg-[var(--color-panel-bg)] p-3 space-y-4">
                      <section>
                        <h3 className="type-section-label text-graphite-500">Summary</h3>
                        <div className="mt-2 divide-y divide-[var(--color-border)]">
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Medium</span><span className="type-body text-right">{draft.mediumMaterials || '—'}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Materials</span><span className="type-body text-right">{draft.materials || '—'}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Dimensions</span><span className="type-body text-right">{[draft.height, draft.width, draft.depth].filter(Boolean).join(' x ') || '—'} {draft.dimensionsUnit || ''}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Weight</span><span className="type-body text-right">{draft.weight ? `${draft.weight} ${draft.weightUnit || ''}` : '—'}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Edition</span><span className="type-body text-right">{draft.editionInfo || '—'}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Price</span><span className="type-body text-right">{draft.price ? `${draft.currency || 'USD'} ${formatDraftPrice(draft.price)}` : '—'}</span></div>
                          <div className="py-2 flex justify-between gap-3"><span className="type-body-strong text-graphite-500">Availability</span><span className="type-body text-right">{draft.availability || '—'}</span></div>
                        </div>
                      </section>

                      <section className="pt-3 border-t border-[var(--color-border)]">
                        <h3 className="type-section-label text-graphite-500">Description</h3>
                        <p className="type-body mt-2 whitespace-pre-wrap">{draft.shortDescription || '—'}</p>
                      </section>

                      <section className="pt-3 border-t border-[var(--color-border)]">
                        <h3 className="type-section-label text-graphite-500">Tags</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {activeKeywords.length > 0 ? activeKeywords.map((keyword) => (
                            <span key={keyword} className="type-caption px-2 py-1 border border-[var(--color-border)] rounded-full bg-[var(--color-input-bg)]">{keyword}</span>
                          )) : <span className="type-body text-graphite-500">—</span>}
                        </div>
                      </section>
                    </div>
                  </div>
                ) : null}

                {activeArtworkTab === 'statement' ? (
                  <div className="space-y-3 text-sm">
                    <div><p className="text-[11px] uppercase tracking-wide text-graphite-500">Statement</p><p className="whitespace-pre-wrap">{draft.artworkStatement || '—'}</p></div>
                    <div><p className="text-[11px] uppercase tracking-wide text-graphite-500">Process Notes</p><p className="whitespace-pre-wrap">{draft.processNotes || '—'}</p></div>
                  </div>
                ) : null}

                {activeArtworkTab === 'history' ? (
                  <div className="space-y-3 text-sm">
                    <div><p className="text-[11px] uppercase tracking-wide text-graphite-500">Exhibition History</p><p className="whitespace-pre-wrap">{draft.exhibitionHistory || '—'}</p></div>
                    <div><p className="text-[11px] uppercase tracking-wide text-graphite-500">Private Notes</p><p className="whitespace-pre-wrap">{draft.privateNotes || '—'}</p></div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <label className="inline-block text-xs px-3 py-2 border border-[var(--color-border)] rounded-md cursor-pointer bg-[var(--color-input-bg)] hover:opacity-90">
                  {uploading ? 'Uploading...' : 'Upload images'}
                  <input type="file" className="hidden" multiple accept="image/*" onChange={(e) => void handleImageUpload(e)} disabled={uploading} />
                </label>

                <div className="w-full max-w-[520px] overflow-hidden">
                  {activeHero ? (
                    <img src={`${apiBase}${activeHero.originalUrl}`} alt={activeHero.originalFilename} className="block w-full h-auto object-contain" />
                  ) : (
                    <div className="w-full py-8 text-sm text-graphite-500">Primary image preview</div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {detail?.images.map((image) => (
                    <div
                      key={image.id}
                      draggable
                      onDragStart={() => setDraggedImageId(image.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void handleDrop(image.id)}
                      className="surface-card border border-[var(--color-border)] rounded-lg p-2 space-y-2 bg-[var(--color-panel-bg)] min-w-0 overflow-hidden"
                    >
                      <img
                        src={`${apiBase}${image.thumbnailUrl}`}
                        alt={image.originalFilename}
                        className="w-full aspect-square object-cover rounded"
                      />
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handlePrimaryImage(image.id)}
                          className={`text-xs px-2 py-1 rounded border ${image.isPrimary ? 'bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] border-[var(--color-primary-button-bg)]' : 'border-[var(--color-border)] bg-[var(--color-input-bg)]'}`}
                        >
                          Hero
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteImage(image.id)}
                          className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-input-bg)]"
                        >
                          Delete
                        </button>
                      </div>
                      <input
                        className="w-full"
                        placeholder="Photo credit"
                        defaultValue={image.credit ?? ''}
                        onBlur={(event) => void handleImageMetaSave(image, { credit: event.target.value })}
                      />
                      <label className="flex items-center gap-2 text-xs text-graphite-600 dark:text-graphite-300">
                        <input
                          type="checkbox"
                          defaultChecked={image.isDetail}
                          onChange={(event) => void handleImageMetaSave(image, { isDetail: event.target.checked })}
                        />
                        Detail photo
                      </label>
                    </div>
                  ))}
                </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Title</label>
              <input value={draft.title} placeholder="Figure No.1 (standing)" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Year</label>
              <input value={draft.year} placeholder="2026" onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Medium</label>
              <input value={draft.mediumMaterials} placeholder="Bronze, walnut, oil" onChange={(e) => setDraft({ ...draft, mediumMaterials: e.target.value })} />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Materials</label>
              <input value={draft.materials} placeholder="Walnut, brass, cement" onChange={(e) => setDraft({ ...draft, materials: e.target.value })} />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Size</label>
              <div className="flex gap-2 flex-1 min-w-0">
                <input className="min-w-[82px] flex-1" value={draft.height} placeholder="H" onChange={(e) => setDraft({ ...draft, height: e.target.value })} />
                <input className="min-w-[82px] flex-1" value={draft.width} placeholder="W" onChange={(e) => setDraft({ ...draft, width: e.target.value })} />
                <input className="min-w-[82px] flex-1" value={draft.depth} placeholder="D" onChange={(e) => setDraft({ ...draft, depth: e.target.value })} />
                <select className="w-16 shrink-0" value={draft.dimensionsUnit || 'cm'} onChange={(e) => convertDimensions(e.target.value as 'in' | 'cm')}>
                  <option value="cm">cm</option>
                  <option value="in">in</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Weight</label>
              <div className="flex gap-2 flex-1 min-w-0">
                <input className="min-w-[120px] flex-1" value={draft.weight} placeholder="Weight" onChange={(e) => setDraft({ ...draft, weight: e.target.value })} />
                <select className="w-16 shrink-0" value={draft.weightUnit || 'kg'} onChange={(e) => convertWeight(e.target.value as 'lb' | 'kg')}>
                  <option value="kg">kg</option>
                  <option value="lb">lb</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Edition</label>
              <input value={draft.editionInfo} placeholder="Edition information" onChange={(e) => setDraft({ ...draft, editionInfo: e.target.value })} />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Price</label>
              <div className="flex gap-2 flex-1 min-w-0">
                <input
                  className="min-w-[120px] flex-1"
                  value={draft.price}
                  placeholder="1200 or $1,200"
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
                <select
                  className="w-24 shrink-0"
                  value={draft.currency || 'USD'}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500">Availability</label>
              <select
                value={draft.availability || 'Available'}
                onChange={(e) => setDraft({ ...draft, availability: e.target.value })}
              >
                <option value="Available">Available</option>
                <option value="On Exhibition">On Exhibition</option>
                <option value="Sold">Sold</option>
              </select>
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Collection</label>
              <textarea
                value={draft.collectionSeries}
                rows={1}
                className="resize-none overflow-hidden"
                placeholder="Collection or series"
                onInput={autoGrowTextarea}
                onChange={(e) => setDraft({ ...draft, collectionSeries: e.target.value })}
              />
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Keywords</label>
              <div className="flex-1 space-y-2">
                <textarea
                  value={draft.tags}
                  rows={1}
                  className="resize-none overflow-hidden"
                  placeholder="Separate by Comma"
                  onInput={autoGrowTextarea}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  {suggestedKeywords.map((keyword) => {
                    const selected = activeKeywords.some((value) => value.toLowerCase() === keyword.toLowerCase());
                    return (
                      <button
                        key={keyword}
                        type="button"
                        onClick={() => toggleKeyword(keyword)}
                        className={`px-2 py-1 text-xs border rounded-full ${selected ? 'bg-[var(--color-primary-button-bg)] text-[var(--color-primary-button-text)] border-[var(--color-primary-button-bg)]' : 'border-[var(--color-border)] bg-[var(--color-input-bg)] text-[var(--color-text-muted)]'}`}
                      >
                        {keyword}
                      </button>
                    );
                  })}
                </div>
                {activeKeywords.length > 0 ? (
                  <p className="text-xs text-graphite-500">Current: {activeKeywords.join(', ')}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Description</label>
              <div className="flex-1 space-y-1">
                <textarea
                  value={draft.shortDescription}
                  rows={2}
                  placeholder="Short artwork description"
                  onChange={(e) => setDraft({ ...draft, shortDescription: clampToWordLimit(e.target.value, BLURB_WORD_LIMIT) })}
                />
                <p className="text-[11px] text-graphite-500">{blurbWords}/{BLURB_WORD_LIMIT} words</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Statement</label>
              <div className="flex-1 space-y-1">
                <textarea
                  value={draft.artworkStatement}
                  rows={4}
                  placeholder="Artwork-specific artist statement"
                  onChange={(e) => setDraft({ ...draft, artworkStatement: clampToWordLimit(e.target.value, STATEMENT_WORD_LIMIT) })}
                />
                <p className="text-[11px] text-graphite-500">{statementWords}/{STATEMENT_WORD_LIMIT} words</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Process Notes</label>
              <textarea value={draft.processNotes} rows={4} placeholder="Process notes" onChange={(e) => setDraft({ ...draft, processNotes: e.target.value })} />
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Exhibitions</label>
              <textarea value={draft.exhibitionHistory} rows={3} placeholder="Exhibition history" onChange={(e) => setDraft({ ...draft, exhibitionHistory: e.target.value })} />
            </div>

            <div className="flex items-start gap-3">
              <label className="w-32 shrink-0 text-xs uppercase tracking-wide text-graphite-500 pt-2">Private Notes</label>
              <textarea value={draft.privateNotes} rows={3} placeholder="Additional private notes" onChange={(e) => setDraft({ ...draft, privateNotes: e.target.value })} />
            </div>
              </>
            )}
            {status ? <p className="text-xs text-graphite-500">{status}</p> : null}
          </div>
        </section>
        ) : null}
        </main>
      </div>
    </div>
  );
}

export default App;
