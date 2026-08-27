/**
 * Section 63 calls for tests of simulated Google Sheets/Drive API failure
 * paths — this app talks to two external services on every request that
 * touches real data, so what happens when Google is down, rate-limiting
 * us, or misconfigured needs to be verified, not assumed. Companion to
 * googleSheetsService.cache.test.js (which covers caching/batching, not
 * failure handling).
 */

describe('googleSheetsService — failure paths', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('a transient 503 is retried and eventually succeeds', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
    }));
    const get = jest
      .fn()
      .mockRejectedValueOnce({ code: 503 })
      .mockResolvedValueOnce({ data: { values: [['k1', 'v1', '', '']] } });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        sheets: jest.fn(() => ({ spreadsheets: { values: { get, batchGet: jest.fn(), append: jest.fn(), update: jest.fn() } } })),
      },
    }));
    process.env.SHEETS_READ_CACHE_TTL_MS = '4000';
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    const result = await sheetsService.getAll('Settings');
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.rows).toEqual([{ key: 'k1', value: 'v1', updated_at: '', updated_by: '' }]);
  });

  test('a permanent 401 is not retried and surfaces as GOOGLE_AUTH_FAILED', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
    }));
    const get = jest.fn().mockRejectedValue({ code: 401 });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        sheets: jest.fn(() => ({ spreadsheets: { values: { get, batchGet: jest.fn(), append: jest.fn(), update: jest.fn() } } })),
      },
    }));
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    await expect(sheetsService.getAll('Settings')).rejects.toMatchObject({ code: 'GOOGLE_AUTH_FAILED', statusCode: 502 });
    expect(get).toHaveBeenCalledTimes(1); // no retry on a non-retryable status
  });

  test('a persistent rate limit (429) exhausts retries and surfaces as GOOGLE_RATE_LIMIT', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
    }));
    const get = jest.fn().mockRejectedValue({ code: 429 });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        sheets: jest.fn(() => ({ spreadsheets: { values: { get, batchGet: jest.fn(), append: jest.fn(), update: jest.fn() } } })),
      },
    }));
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    await expect(sheetsService.getAll('Settings')).rejects.toMatchObject({ code: 'GOOGLE_RATE_LIMIT', statusCode: 429 });
    expect(get).toHaveBeenCalledTimes(3); // default retry attempts exhausted
  }, 10000);

  test('a DNS/network failure surfaces as GOOGLE_NETWORK_ERROR', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
    }));
    const get = jest.fn().mockRejectedValue({ code: 'ENOTFOUND' });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        sheets: jest.fn(() => ({ spreadsheets: { values: { get, batchGet: jest.fn(), append: jest.fn(), update: jest.fn() } } })),
      },
    }));
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    await expect(sheetsService.getAll('Settings')).rejects.toMatchObject({ code: 'GOOGLE_NETWORK_ERROR', statusCode: 502 });
  });

  test('an unconfigured Google account fails fast with GOOGLE_NOT_CONFIGURED instead of attempting a call', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: false,
      google: {},
    }));
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    await expect(sheetsService.getAll('Settings')).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED', statusCode: 503 });
  });

  test('a write failure (append) is wrapped, not thrown raw, and the read cache is left untouched', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', spreadsheetId: 'sheet-1' },
    }));
    const append = jest.fn().mockRejectedValue({ code: 500 });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        sheets: jest.fn(() => ({ spreadsheets: { values: { get: jest.fn(), batchGet: jest.fn(), append, update: jest.fn() } } })),
      },
    }));
    // eslint-disable-next-line global-require
    const sheetsService = require('../src/services/googleSheetsService');
    await expect(sheetsService.append('Settings', { key: 'k', value: 'v' })).rejects.toMatchObject({ code: 'GOOGLE_SHEETS_ERROR' });
  }, 10000);
});

describe('googleDriveService — failure paths', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('an unconfigured Drive account fails fast with GOOGLE_NOT_CONFIGURED', async () => {
    jest.doMock('../src/config/env', () => ({ googleConfigured: false, google: {} }));
    // eslint-disable-next-line global-require
    const driveService = require('../src/services/googleDriveService');
    await expect(driveService.uploadBuffer({ pathSegments: ['Receipts'], fileName: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') }))
      .rejects.toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED', statusCode: 503 });
  });

  test('an upload failure is wrapped as GOOGLE_DRIVE_ERROR, not thrown raw', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', driveRootFolderId: 'root-1' },
    }));
    const list = jest.fn().mockResolvedValue({ data: { files: [] } });
    const create = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'folder-1' } }) // folder creation for ensurePath
      .mockRejectedValueOnce({ code: 500 }); // the actual file upload
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        drive: jest.fn(() => ({ files: { list, create } })),
      },
    }));
    // eslint-disable-next-line global-require
    const driveService = require('../src/services/googleDriveService');
    await expect(
      driveService.uploadBuffer({ pathSegments: ['Receipts'], fileName: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') })
    ).rejects.toMatchObject({ code: 'GOOGLE_DRIVE_ERROR', statusCode: 502 });
  });

  test('a download failure (missing file) surfaces as GOOGLE_DRIVE_MISSING_FOLDER-style 404 mapping', async () => {
    jest.doMock('../src/config/env', () => ({
      googleConfigured: true,
      google: { clientEmail: 'x', privateKey: 'x', driveRootFolderId: 'root-1' },
    }));
    const get = jest.fn().mockRejectedValue({ code: 404 });
    jest.doMock('googleapis', () => ({
      google: {
        auth: { JWT: jest.fn().mockImplementation(() => ({})) },
        drive: jest.fn(() => ({ files: { get } })),
      },
    }));
    // eslint-disable-next-line global-require
    const driveService = require('../src/services/googleDriveService');
    await expect(driveService.getFileBuffer('missing-file-id')).rejects.toMatchObject({ statusCode: 502 });
  });
});
