import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DB_PATH, db } from './db.js';
import { HttpError, STATUS, getWorkOrder, listProofs } from './workorders.js';

/** Proof-of-completion files (PDF or photo) the admin attaches to a finished work order. */

export const UPLOAD_DIR = resolve(dirname(DB_PATH), 'uploads');
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const MAX_PROOFS_PER_WO = 10;

/** Accepted types, recognised by their first bytes so a renamed file cannot pass as a PDF or image. */
const TYPES = [
  { mime: 'application/pdf', ext: 'pdf', match: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', match: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** Keeps the original name readable but safe to store and send back in a header. */
function cleanName(raw, ext) {
  let name = '';
  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    name = String(raw ?? '');
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120);
  if (!name) name = `proof.${ext}`;
  return name;
}

export function addProof(woUuid, { body, fileName }, user) {
  const wo = getWorkOrder(woUuid);
  if (wo.status !== STATUS.FINISH) throw new HttpError(409, 'Proof can only be uploaded when all steps of the work order are finished');
  if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(422, 'Choose a PDF or image file to upload');
  if (body.length > MAX_PROOF_BYTES) throw new HttpError(413, 'File is too large (max 10 MB)');
  const type = TYPES.find((t) => t.match(body));
  if (!type) throw new HttpError(415, 'Only PDF, JPG, PNG or WebP files can be uploaded');
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM wo_proofs WHERE wo_uuid = ?').get(woUuid);
  if (n >= MAX_PROOFS_PER_WO) throw new HttpError(409, `A work order can have at most ${MAX_PROOFS_PER_WO} proof files`);

  const storedName = `${randomUUID()}.${type.ext}`;
  const dir = join(UPLOAD_DIR, woUuid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, storedName), body);
  try {
    db.prepare(
      'INSERT INTO wo_proofs (wo_uuid, file_name, stored_name, mime_type, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(woUuid, cleanName(fileName, type.ext), storedName, type.mime, body.length, user.id, new Date().toISOString());
  } catch (err) {
    rmSync(join(dir, storedName), { force: true });
    throw err;
  }
  return listProofs(woUuid);
}

/** The stored row plus the file path, for downloads. */
export function getProofFile(woUuid, proofId) {
  const row = db.prepare('SELECT * FROM wo_proofs WHERE id = ? AND wo_uuid = ?').get(proofId, woUuid);
  if (!row) throw new HttpError(404, 'Proof file not found');
  return { ...row, path: join(UPLOAD_DIR, woUuid, row.stored_name) };
}

export function deleteProof(woUuid, proofId) {
  const file = getProofFile(woUuid, proofId);
  db.prepare('DELETE FROM wo_proofs WHERE id = ?').run(file.id);
  rmSync(file.path, { force: true });
  return listProofs(woUuid);
}
