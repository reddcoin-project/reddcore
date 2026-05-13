import { ObjectId } from 'bson';

export const enum Direction {
  ascending = 1,
  descending = -1
}

export type StreamingFindOptions<T> = Partial<{
  paging: keyof T | '_id';
  since: T[keyof T] | ObjectId;
  sort: any;
  direction: Direction;
  limit: number;
  /**
   * Offset-paginate by `skip(N)` on the sorted cursor. Mutually exclusive
   * with `since`; if both are set the caller probably has a bug. Cost is
   * O(N) keys walked on the index, fine for normal page-jumps but a poor
   * choice for very deep pagination on unbounded collections.
   */
  skip: number;
}>;
