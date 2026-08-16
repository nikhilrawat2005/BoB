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

async function listFiles(userId) {
  const snap = await db.collection('users').doc(userId).collection('files').orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  // Remove the actual asset from Cloudinary, then the Firestore record.
  if (record.publicId) {
    await cloudinary.uploader.destroy(record.publicId, {
      resource_type: record.resourceType || 'raw',
    }).catch(err => console.error('[fileService] Cloudinary destroy failed:', err.message));
  }
  await ref.delete();
  return true;
}

// Stores a Buffer produced by documentGenerator.js (real .xlsx/.docx/.pdf/.pptx
// bytes) exactly like a user-uploaded file — same Cloudinary pipeline, same
// Firestore users/{userId}/files collection, so listFiles/deleteFile work on
// generated files for free. resource_type is forced to 'raw' because these
// are binary Office/PDF documents, not images Cloudinary should transform.
async function saveGeneratedFile(userId, buffer, filename, mimeType) {
  const result = await uploadBufferToCloudinary(buffer, `bob/${userId}/generated`);

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

