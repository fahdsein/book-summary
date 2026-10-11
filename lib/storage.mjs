import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let client;
const ALLOWED_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

function configured() {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET && (process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID));
}

function storage() {
  if (!configured()) {
    const error = new Error("S3 Object Storage is not configured");
    error.code = "S3_NOT_CONFIGURED";
    throw error;
  }
  client ||= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || ""
    }
  });
  return client;
}

export function validateCoverType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(normalized)) {
    const error = new Error("Cover must be a JPEG, PNG, or WebP image");
    error.status = 415;
    throw error;
  }
  return { contentType: normalized, extension: ALLOWED_TYPES.get(normalized) };
}

export async function uploadCover(bookId, buffer, contentType) {
  const type = validateCoverType(contentType);
  const key = `book-cover-${bookId}-${randomUUID()}.${type.extension}`;
  await storage().send(new PutObjectCommand({ Bucket:process.env.S3_BUCKET,Key:key,Body:buffer,ContentType:type.contentType,CacheControl:"public, max-age=31536000, immutable",Metadata:{ bookId } }));
  return { key, contentType:type.contentType };
}

export async function readCover(key) {
  return storage().send(new GetObjectCommand({ Bucket:process.env.S3_BUCKET,Key:key }));
}

export async function deleteCover(key) {
  if (!key || !configured()) return;
  await storage().send(new DeleteObjectCommand({ Bucket:process.env.S3_BUCKET,Key:key }));
}

export async function storageReady() {
  if (!configured()) return { ready:false, mode:"not_configured" };
  await storage().send(new HeadBucketCommand({ Bucket:process.env.S3_BUCKET }));
  return { ready:true, mode:"s3" };
}
