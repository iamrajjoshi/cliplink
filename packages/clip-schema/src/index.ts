import { z } from "zod";

const tagsSchema = z.array(z.string().trim().min(1)).default([]);

export const clipKindSchema = z.enum(["link", "tweet", "image", "video", "note"]);

export const baseClipFields = {
  clippedAt: z.coerce.date(),
  tags: tagsSchema,
};

const slugField = {
  slug: z.string().trim().min(1),
};

export const tweetAuthorSchema = z.object({
  name: z.string().trim().min(1),
  handle: z.string().trim().min(1),
  avatar: z.string().trim().min(1).optional(),
});

export const tweetMediaSchema = z.object({
  src: z.string().trim().min(1),
  alt: z.string().trim().min(1).optional(),
});

export const linkClipDataSchema = z.object({
  kind: z.literal("link"),
  ...baseClipFields,
  url: z.string().url(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  siteName: z.string().trim().min(1).optional(),
  favicon: z.string().trim().min(1).optional(),
  ogImage: z.string().trim().min(1).optional(),
});

export const tweetClipDataSchema = z.object({
  kind: z.literal("tweet"),
  ...baseClipFields,
  platform: z.literal("x"),
  url: z.string().url(),
  author: tweetAuthorSchema,
  text: z.string().trim().min(1),
  postedAt: z.coerce.date(),
  media: z.array(tweetMediaSchema).optional(),
});

export const imageClipDataSchema = z.object({
  kind: z.literal("image"),
  ...baseClipFields,
  src: z.string().trim().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().trim().min(1).optional(),
  sourceUrl: z.string().url().optional(),
});

export const videoClipDataSchema = z.object({
  kind: z.literal("video"),
  ...baseClipFields,
  url: z.string().url(),
  provider: z.enum(["youtube", "vimeo", "other"]),
  title: z.string().trim().min(1),
  channel: z.string().trim().min(1).optional(),
  thumbnail: z.string().trim().min(1).optional(),
});

export const noteClipDataSchema = z.object({
  kind: z.literal("note"),
  ...baseClipFields,
});

export const clipDataSchema = z.discriminatedUnion("kind", [
  linkClipDataSchema,
  tweetClipDataSchema,
  imageClipDataSchema,
  videoClipDataSchema,
  noteClipDataSchema,
]);

export const clipFrontmatterSchema = z.discriminatedUnion("kind", [
  linkClipDataSchema.extend(slugField),
  tweetClipDataSchema.extend(slugField),
  imageClipDataSchema.extend(slugField),
  videoClipDataSchema.extend(slugField),
  noteClipDataSchema.extend(slugField),
]);

export type ClipFrontmatter = z.infer<typeof clipFrontmatterSchema>;
export type ClipKind = z.infer<typeof clipKindSchema>;
