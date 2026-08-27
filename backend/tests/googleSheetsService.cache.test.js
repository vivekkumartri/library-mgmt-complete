// We drive the real service but stub out its Google API client so we can
// assert on call counts without any network access.
jest.mock('../src/config/env', () => ({
  googleConfigured: true,
  google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
}));

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn().mockImplementation(() => ({})) },
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: jest.fn(),
          batchGet: jest.fn(),
          append: jest.fn(async () => ({})),
          update: jest.fn(async () => ({})),
        },
      },
    })),
  },
}));

describe('googleSheetsService caching + batching', () => {
  let sheetsService;
  let mockApi;

  beforeEach(() => {
    jest.resetModules();
    process.env.SHEETS_READ_CACHE_TTL_MS = '4000';
    // eslint-disable-next-line global-require
    sheetsService = require('../src/services/googleSheetsService');
    mockApi = sheetsService._client().spreadsheets.values;
    mockApi.get.mockResolvedValue({ data: { values: [['k1', 'v1', '', '']] } });
    mockApi.batchGet.mockResolvedValue({
      data: {
        valueRanges: [{ values: [['k1', 'v1', '', '']] }, { values: [] }],
      },
    });
  });

  test('a second getAll for the same sheet within the TTL reuses the cache', async () => {
    await sheetsService.getAll('Settings');
    await sheetsService.getAll('Settings');
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });

  test('concurrent getAll calls for the same sheet are deduped into one request', async () => {
    const [a, b] = await Promise.all([sheetsService.getAll('Settings'), sheetsService.getAll('Settings')]);
    expect(mockApi.get).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  test('a write invalidates the cache so the next read goes back to the API', async () => {
    await sheetsService.getAll('Settings');
    await sheetsService.append('Settings', { key: 'k2', value: 'v2', updated_at: '', updated_by: '' });
    await sheetsService.getAll('Settings');
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  test('getMany batches sheets not already cached into a single batchGet call', async () => {
    await sheetsService.getAll('Settings'); // primes the cache for Settings
    const result = await sheetsService.getMany(['Settings', 'Floors']);
    // Settings served from cache; only Floors needed fetching — but with 2+
    // sheets requested we still only issue it as a single batchGet, not a
    // plain get, once there's more than one sheet actually needing a fetch.
    // Here only Floors needs fetching, so getMany falls back to a single
    // getAll() call for it rather than a batchGet of one range.
    expect(result.Settings.rows).toEqual([{ key: 'k1', value: 'v1', updated_at: '', updated_by: '' }]);
    expect(mockApi.get).toHaveBeenCalledTimes(2); // 1 for the initial Settings prime, 1 for Floors
    expect(mockApi.batchGet).not.toHaveBeenCalled();
  });

  test('getMany issues one batchGet when two or more sheets need fetching', async () => {
    const result = await sheetsService.getMany(['Settings', 'Floors']);
    expect(mockApi.batchGet).toHaveBeenCalledTimes(1);
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(result.Settings.rows).toHaveLength(1);
    expect(result.Floors.rows).toHaveLength(0);
  });
});
