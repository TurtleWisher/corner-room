/* Sending one file through a resumable upload intent (AUDIO_PHASE_1_DESIGN section 6), shared by
 * the upload card and the profile picture picker. */

import {
  completeUpload,
  createUploadIntent,
  putUploadPart,
  type UploadCompleteRecord,
  type UploadIntentRecord,
  type UploadPurpose,
  type UploadTargetType,
} from "@/features/uploads/api";
import { bytesReceived, partsToSend, planParts } from "@/lib/upload-view";

/** Blob.arrayBuffer() where available; FileReader on older browsers (Safari before 14). */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Send one file through an upload intent: open (or resume) it, send the missing parts, complete.
 * Returns null when `isCancelled` stopped it. Errors are thrown as they come from the API.
 */
export async function sendUpload({
  file,
  purpose,
  targetType,
  targetId,
  onOpened,
  onProgress,
  onFinishing,
  isCancelled = () => false,
}: {
  file: File;
  purpose: UploadPurpose;
  targetType: UploadTargetType;
  targetId: string;
  onOpened?: (intent: UploadIntentRecord) => void;
  onProgress?: (sent: number, total: number) => void;
  onFinishing?: () => void;
  isCancelled?: () => boolean;
}): Promise<UploadCompleteRecord | null> {
  const intent = await createUploadIntent({ purpose, target_type: targetType, target_id: targetId, filename: file.name, byte_size: file.size });
  onOpened?.(intent);
  const plan = planParts(file.size, intent.part_size);
  let sent = bytesReceived(plan, intent.parts_received);
  onProgress?.(sent, file.size);
  for (const part of partsToSend(plan, intent.parts_received)) {
    if (isCancelled()) return null;
    const data = await readSlice(file.slice(part.start, part.end));
    await putUploadPart(intent.id, part.number, data, await sha256Hex(data));
    sent += part.end - part.start;
    onProgress?.(sent, file.size);
  }
  onFinishing?.();
  return completeUpload(intent.id);
}
