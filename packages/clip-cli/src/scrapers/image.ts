import path from "node:path";

export async function inspectImage(filePath: string) {
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(filePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not determine image dimensions for ${filePath}`);
  }

  return {
    width: metadata.width,
    height: metadata.height,
    filename: path.basename(filePath),
    stem: path.basename(filePath, path.extname(filePath)),
  };
}
