type BindingPath = string[];

type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export async function waitForWailsBinding<T = unknown>(
  _path: BindingPath,
  _options: WaitOptions = {},
): Promise<T> {
  return undefined as T;
}

export async function callWhenReady<T>(
  path: BindingPath,
  action: () => Promise<T>,
  options?: WaitOptions,
): Promise<T> {
  await waitForWailsBinding(path, options);
  return action();
}

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  backoffMs = 200,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        const delay = backoffMs * (i + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error('callWithRetry exhausted attempts');
}
