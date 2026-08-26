const cloudinary = require('../config/cloudinary');
const { db } = require('../config/firebase');
const { Readable } = require('stream');
const documentReader = require('./documentReaderService');

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' }, // auto = image/video/raw detected automatically
      (error, result) => (error ? reject(error) : resolve(result))
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

async function uploadFile(userId, file) {
  // Upload the raw bytes to Cloudinary as before (unchanged behaviour).
  const result = await uploadBufferToCloudinary(file.buffer, `bob/${userId}`);

  if (!result || !result.secure_url) {
    throw new Error('Upload succeeded but storage returned no file URL');
  }

  // NEW: actually read the file's content for text-bearing formats
  // (PDF, DOCX, txt/md/csv/json/...). Without this, Bob only ever knew a
  // file's name/size — never what was written inside it — and would
  // hallucinate an answer instead of using the real content.
  const extraction = await documentReader.extractText(file.buffer, file.originalname);

  const record = {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type, // image | video | raw
    originalName: file.originalname,
    // BUGFIX: mimeType was never stored for uploads (only for generated files),
    // so the `MIME_MAP[ext] || file.mimeType || octet-stream` fallback chain in
    // routes/files.js always skipped the middle term. Any allowed extension not
    // in MIME_MAP was served as application/octet-stream, which makes the
    // browser download it instead of rendering it inline on /view.
    mimeType: file.mimetype || null,
    sizeBytes: file.size,
    createdAt: Date.now(),
    // Populated only when extraction succeeded; undefined/empty otherwise.
    extractedText: extraction.supported ? extraction.text : '',
    textExtracted: extraction.supported,
    extractionError: extraction.supported ? null : extraction.error,
  };

  const ref = db.collection('users').doc(userId).collection('files').doc();
  await ref.set(record);

  return { id: ref.id, ...record };
}

// How many chars of extractedText the LIST endpoint returns per file.
// The full text (up to 60k chars) stays in Firestore and is what getFile()
// returns for the LLM — but GET /api/files returns EVERY file at once, so
// shipping 60k chars x N files was an unbounded multi-megabyte JSON payload.
// The frontend only uses this for a 120-char card snippet and client-side
// search, so a 4k slice is plenty.
const LIST_SNIPPET_CHARS = 4000;
// Hard cap on how many file records one list call returns.
const LIST_MAX_FILES = 300;

async function listFiles(userId) {
  const snap = await db.collection('users').doc(userId).collection('files')
    .orderBy('createdAt', 'desc')
    .limit(LIST_MAX_FILES)
    .get();

  return snap.docs.map(d => {
    const data = d.data();
    const full = typeof data.extractedText === 'string' ? data.extractedText : '';
    return {
      id: d.id,
      ...data,
      extractedText: full.slice(0, LIST_SNIPPET_CHARS),
      // Lets the UI say "showing first 4k of N chars" instead of pretending
      // the truncated slice is the whole document.
      extractedTextLength: full.length,
      extractedTextTruncated: full.length > LIST_SNIPPET_CHARS,
    };
  });
}

async function getFile(userId, fileId) {
  const doc = await db.collection('users').doc(userId).collection('files').doc(fileId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function deleteFile(userId, fileId) {
  const ref = db.collection('users').doc(userId).collection('files').doc(fileId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const record = snap.data();

  // BUGFIX: this used to swallow every Cloudinary failure with a bare
  // .catch(console.error) and then delete the Firestore doc + return true
  // regardless. The blob survived in Cloudinary on a permanent PUBLIC url while
  // its only DB pointer was destroyed, so it could never be found or retried.
  // Worse, a wrong resource_type makes destroy() return { result: 'not found' }
  // WITHOUT throwing, so even the console.error never fired.
  //
  // Now: we try the recorded resource_type, then fall back through the other
  // two (Cloudinary requires an exact match), and only delete the Firestore
  // pointer once the asset is actually gone. If it isn't, the pointer stays so
  // the user can retry.
  let assetRemoved = true;
  let assetError = null;

  if (record.publicId) {
    const recorded = record.resourceType || 'raw';
    const candidates = [recorded, ...['image', 'video', 'raw'].filter(t => t !== recorded)];
    assetRemoved = false;

    for (const resourceType of candidates) {
      try {
        const out = await cloudinary.uploader.destroy(record.publicId, { resource_type: resourceType });
        // destroy() resolves with { result: 'ok' | 'not found' } — 'not found'
        // means wrong resource_type (or already gone), so keep trying.
        if (out && out.result === 'ok') {
          assetRemoved = true;
          assetError = null;
          break;
        }
        assetError = `Cloudinary returned "${out && out.result}" for resource_type "${resourceType}"`;
      } catch (err) {
        assetError = err.message;
      }
    }

    if (!assetRemoved) {
      console.error(`[fileService] Cloudinary destroy failed for ${record.publicId}: ${assetError}`);
      const e = new Error(`Stored file could not be removed from storage (${assetError}). Nothing was deleted — please retry.`);
      e.code = 'ASSET_DELETE_FAILED';
      throw e;
    }
  }

  await ref.delete();
  return true;
}

// Stores a Buffer produced by documentGenerator.js (real .xlsx/.docx/.pdf/.pptx
// bytes) exactly like a user-uploaded file — same Cloudinary pipeline, same
// Firestore users/{userId}/files collection, so listFiles/deleteFile work on
// generated files for free.
//
// NOTE: an earlier comment here claimed resource_type was "forced to 'raw'".
// That was never true — this shares uploadBufferToCloudinary, which sends
// resource_type: 'auto'. Cloudinary classifies Office/PDF bytes as 'raw' on its
// own, and whatever it decides is what we persist below, which is what
// deleteFile needs to pass back to destroy().
async function saveGeneratedFile(userId, buffer, filename, mimeType) {
  const result = await uploadBufferToCloudinary(buffer, `bob/${userId}/generated`);

  // Guard against a malformed Cloudinary response producing a record whose url
  // is undefined. Firestore would reject the undefined anyway, but with a
  // confusing "Cannot use 'undefined' as a Firestore value" 500 rather than a
  // message that says what actually went wrong.
  if (!result || !result.secure_url) {
    throw new Error('Upload succeeded but storage returned no file URL');
  }

  const record = {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type || 'raw',
    originalName: filename,
    mimeType,
    sizeBytes: buffer.length,
    generated: true,
    createdAt: Date.now(),
  };

  const ref = db.collection('users').doc(userId).collection('files').doc();
  await ref.set(record);

  return { id: ref.id, ...record };
}

module.exports = { uploadFile, listFiles, getFile, deleteFile, saveGeneratedFile };

