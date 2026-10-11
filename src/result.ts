/**
 * A page of results. It *is* an array (index it, spread it, `for...of` it),
 * and also knows how to fetch the next page.
 *
 * ```ts
 * let page = await client.getDialogs({ limit: 50 });
 * while (page.length) { …; page = await page.next(); }
 * ```
 */
export class Result<T> extends Array<T> {
  /** Total count reported by Telegram, when it provides one. */
  total?: number;
  private fetchNext?: () => Promise<Result<T>>;

  // Array methods like .map()/.filter() should produce plain arrays.
  static get [Symbol.species]() {
    return Array;
  }

  static from_<T>(items: T[], fetchNext?: () => Promise<Result<T>>, total?: number): Result<T> {
    const r = new Result<T>();
    r.push(...items);
    r.fetchNext = fetchNext;
    r.total = total;
    return r;
  }

  get hasNext(): boolean {
    return !!this.fetchNext;
  }

  /** Fetch the next page; returns an empty Result when there is none. */
  async next(): Promise<Result<T>> {
    return this.fetchNext ? this.fetchNext() : Result.from_<T>([]);
  }
}
