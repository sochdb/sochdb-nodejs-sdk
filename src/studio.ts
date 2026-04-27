/**
 * Lightweight helpers for talking to the hosted Studio backend over HTTP.
 */

export interface StudioClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface StudioEvent {
  [key: string]: unknown;
}

export interface StudioHealthResponse {
  [key: string]: unknown;
}

export interface StudioIngestResult {
  ok: boolean;
  ingested: number;
  eventIds: string[];
}

export class StudioAPIError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'StudioAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, StudioAPIError.prototype);
  }
}

export class StudioClient {
  readonly baseUrl: string;
  readonly apiKey?: string;

  constructor(options: StudioClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  async health(): Promise<StudioHealthResponse> {
    return this.requestJson<StudioHealthResponse>('GET', '/health');
  }

  async ingestEvents(
    events: StudioEvent[],
    options: { source?: string; apiKey?: string } = {},
  ): Promise<StudioIngestResult> {
    const apiKey = options.apiKey || this.apiKey;
    if (!apiKey) {
      throw new Error('Studio API key is required for event ingestion');
    }

    return this.requestJson<StudioIngestResult>('POST', '/api/studio/ingest/events', {
      body: {
        source: options.source || 'nodejs-sdk',
        events,
      },
      apiKey,
    });
  }

  private async requestJson<T>(
    method: string,
    path: string,
    options: { body?: Record<string, unknown>; apiKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    let body: string | undefined;
    if (options.body) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
    });

    const text = await response.text();
    const data = text ? this.safeParseJson(text) : {};

    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : response.statusText) || 'Studio request failed';
      throw new StudioAPIError(message, response.status);
    }

    return data as T;
  }

  private safeParseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new StudioAPIError('Studio backend returned invalid JSON');
    }
  }
}
