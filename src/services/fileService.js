const cloudinary = require('../config/cloudinary');
const { db } = require('../config/firebase');
const { Readable } = require('stream');

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
  const result = await uploadBufferToCloudinary(file.buffer, `bob/${userId}`);

  const record = {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type, // image | video | raw
    originalName: file.originalname,
    sizeBytes: file.size,
    createdAt: Date.now(),
  };

  const ref = db.collection('users').doc(userId).collection('files').doc();
  await ref.set(record);

  return { id: ref.id, ...record };
}

async function listFiles(userId) {
  const snap = await db.collection('users').doc(userId).collection('files').orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

module.exports = { uploadFile, listFiles, deleteFile };
