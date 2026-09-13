import { syncEventStatus } from '../src/db/eventStatus';

// Mock DB client
const mockClient = {
  query: jest.fn()
};

describe('syncEventStatus (Aggregate Fan-Out Event Status Derivation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should transition event to COMPLETED when all child deliveries are SUCCESS', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ status: 'SUCCESS', count: 3 }]
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const status = await syncEventStatus('event-uuid-001', mockClient as any);

    expect(status).toBe('COMPLETED');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE events SET status = $1'),
      ['COMPLETED', 'event-uuid-001']
    );
  });

  it('should transition event to FAILED when all child deliveries are DEAD_LETTER', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ status: 'DEAD_LETTER', count: 2 }]
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const status = await syncEventStatus('event-uuid-002', mockClient as any);

    expect(status).toBe('FAILED');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE events SET status = $1'),
      ['FAILED', 'event-uuid-002']
    );
  });

  it('should transition event to PROCESSING if any child delivery is still RETRYING', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { status: 'SUCCESS', count: 1 },
          { status: 'RETRYING', count: 1 },
          { status: 'DEAD_LETTER', count: 1 }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const status = await syncEventStatus('event-uuid-003', mockClient as any);

    expect(status).toBe('PROCESSING');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE events SET status = $1'),
      ['PROCESSING', 'event-uuid-003']
    );
  });

  it('should transition event to PARTIAL_SUCCESS when some deliveries succeed and others exhaust to DEAD_LETTER', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { status: 'SUCCESS', count: 2 },
          { status: 'DEAD_LETTER', count: 1 }
        ]
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const status = await syncEventStatus('event-uuid-004', mockClient as any);

    expect(status).toBe('PARTIAL_SUCCESS');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE events SET status = $1'),
      ['PARTIAL_SUCCESS', 'event-uuid-004']
    );
  });

  it('should return null when event has no child deliveries', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const status = await syncEventStatus('event-uuid-empty', mockClient as any);

    expect(status).toBeNull();
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });
});
