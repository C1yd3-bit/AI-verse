import { z } from "zod";

export const MAX_ARTWORK_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_ARTWORK_OUTPUT_BYTES = 256 * 1024;
export const MAX_ARTWORK_DATA_LENGTH = 349550;
export const artworkVersionId = z.uuid();
export const artworkImage = z
  .string()
  .max(MAX_ARTWORK_DATA_LENGTH)
  .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);
export const artworkResponse = z
  .object({
    accountId: z.uuid(),
    versionId: z.uuid(),
    image: artworkImage.nullable(),
  })
  .strict();
