// Minimal type declarations for `exif-parser` (no bundled types).
// Covers only the surface used in server/app.ts: create(buffer).parse().tags
declare module "exif-parser" {
  interface ExifParseResult {
    tags: Record<string, number | string | undefined>;
    imageSize?: { width: number; height: number };
    thumbnailOffset?: number;
    thumbnailLength?: number;
    thumbnailType?: number;
    app1Offset?: number;
  }

  interface ExifParser {
    parse(): ExifParseResult;
    enableSimpleValues(enable?: boolean): ExifParser;
    enableImageSize(enable?: boolean): ExifParser;
    enableReturnTags(enable?: boolean): ExifParser;
    enableBinaryFields(enable?: boolean): ExifParser;
    enableTagNames(enable?: boolean): ExifParser;
  }

  const exifParser: {
    create(buffer: Buffer | Uint8Array | ArrayBuffer): ExifParser;
  };

  export default exifParser;
}
