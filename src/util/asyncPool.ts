export async function asyncPool<TItem, TResult>(params: {
  items: TItem[];
  concurrency: number;
  mapper: (item: TItem, index: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const concurrency = Math.max(1, Math.floor(params.concurrency));
  const results: TResult[] = new Array(params.items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, params.items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= params.items.length) break;
      results[index] = await params.mapper(params.items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

