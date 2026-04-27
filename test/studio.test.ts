import { StudioAPIError, StudioClient } from '../src/studio';

describe('StudioClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns health payload', async () => {
    const client = new StudioClient({ baseUrl: 'http://studio.example' });
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalled();
  });

  test('requires api key for ingestion', async () => {
    const client = new StudioClient({ baseUrl: 'http://studio.example' });

    await expect(client.ingestEvents([{ type: 'retrieval' }])).rejects.toThrow(
      'Studio API key is required for event ingestion',
    );
  });

  test('parses successful event ingestion response', async () => {
    const client = new StudioClient({ baseUrl: 'http://studio.example', apiKey: 'secret' });
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: true,
          ingested: 1,
          eventIds: ['evt_1'],
        }),
    } as Response);

    await expect(client.ingestEvents([{ type: 'retrieval' }])).resolves.toEqual({
      ok: true,
      ingested: 1,
      eventIds: ['evt_1'],
    });
  });

  test('surfaces HTTP errors with status code', async () => {
    const client = new StudioClient({ baseUrl: 'http://studio.example', apiKey: 'secret' });
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'bad api key' }),
    } as Response);

    await expect(client.ingestEvents([{ type: 'retrieval' }])).rejects.toMatchObject({
      name: 'StudioAPIError',
      statusCode: 401,
      message: 'bad api key',
    } satisfies Partial<StudioAPIError>);
  });
});
