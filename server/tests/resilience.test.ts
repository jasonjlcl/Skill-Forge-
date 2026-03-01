import {
  CircuitBreaker,
  CircuitOpenError,
  isTransientUpstreamError,
  withRetry,
} from '../src/services/resilience.js';

const transientTimeoutError = (): Error =>
  Object.assign(new Error('upstream request timed out'), {
    code: 'ETIMEDOUT',
  });

describe('resilience helpers', () => {
  it('retries transient errors and succeeds before max attempts', async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw transientTimeoutError();
        }
        return 'ok';
      },
      {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
        isRetryable: isTransientUpstreamError,
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('validation failed');
        },
        {
          maxAttempts: 5,
          baseDelayMs: 0,
          maxDelayMs: 0,
          jitterRatio: 0,
          isRetryable: isTransientUpstreamError,
        },
      ),
    ).rejects.toThrow('validation failed');

    expect(attempts).toBe(1);
  });

  it('opens the circuit after threshold failures and allows recovery after cooldown', async () => {
    const breaker = new CircuitBreaker({
      name: 'test-upstream',
      failureThreshold: 2,
      openMs: 20,
      shouldRecordFailure: isTransientUpstreamError,
    });

    let executions = 0;
    const failingOperation = async (): Promise<string> => {
      executions += 1;
      throw transientTimeoutError();
    };

    await expect(breaker.execute(failingOperation)).rejects.toThrow('timed out');
    await expect(breaker.execute(failingOperation)).rejects.toThrow('timed out');
    await expect(breaker.execute(async () => 'unexpected')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(executions).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const recovered = await breaker.execute(async () => 'recovered');
    expect(recovered).toBe('recovered');
    expect(breaker.isOpen()).toBe(false);
  });
});
