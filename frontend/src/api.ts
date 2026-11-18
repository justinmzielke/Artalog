import type {
  Artwork,
  ArtworkImage,
  ArtworkPayload,
  ArtworkSummary,
  ExportGenerationResult,
  ExportRequirements,
  ExportType,
  ParsedRequirements,
} from './types';

// Dev: backend runs separately on :4000. Packaged: the backend serves the UI, so use same-origin.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiBase = API_BASE;

export interface AppSettings {
  theme?: 'gallery_white' | 'archive_green' | 'charcoal' | 'custom';
  customColor?: string;
}

export function getSettings() {
  return request<AppSettings>('/api/settings');
}

export function saveSettings(settings: AppSettings) {
  return request<AppSettings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function listArtworks() {
  return request<ArtworkSummary[]>('/api/artworks');
}

export function getArtwork(id: string) {
  return request<Artwork>(`/api/artworks/${id}`);
}

export function createArtwork(payload: ArtworkPayload) {
  return request<Artwork>('/api/artworks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateArtwork(id: string, payload: ArtworkPayload) {
  return request<Artwork>(`/api/artworks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteArtwork(id: string) {
  return request<void>(`/api/artworks/${id}`, { method: 'DELETE' });
}

export async function uploadArtworkImages(artworkId: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append('images', file));

  const response = await fetch(`${API_BASE}/api/artworks/${artworkId}/images`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as ArtworkImage[];
}

export function updateImage(id: string, payload: { caption: string | null; credit: string | null; isDetail: boolean }) {
  return request<ArtworkImage>(`/api/images/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setPrimaryImage(id: string) {
  return request<ArtworkImage[]>(`/api/images/${id}/primary`, {
    method: 'PATCH',
  });
}

export function reorderImages(artworkId: string, imageIds: string[]) {
  return request<ArtworkImage[]>(`/api/artworks/${artworkId}/images/order`, {
    method: 'PUT',
    body: JSON.stringify({ imageIds }),
  });
}

export function deleteImage(id: string) {
  return request<void>(`/api/images/${id}`, { method: 'DELETE' });
}

export function parseRequirements(text: string) {
  return request<ParsedRequirements>('/api/requirements/parse', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function generateExport(payload: {
  applicationTitle: string;
  filenamePrefix: string;
  exportType: ExportType;
  selectedArtworkIds: string[];
  requirements: ExportRequirements;
}) {
  return request<ExportGenerationResult>('/api/exports/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
