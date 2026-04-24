/**
 * A single user's rating of a catalog book. The server stores stars
 * as 1-5 integers; we type it as number for the client.
 */
export interface BookRating {
  userId: string;
  catalogBookId: string;
  stars: number;
  createdAt: string;
  updatedAt: string;
}
