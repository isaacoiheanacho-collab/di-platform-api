const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// 1. Configure Cloudinary with your .env credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Define where and how to store the images
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'di_platform_uploads', // This creates a folder in your Cloudinary account
        allowed_formats: ['jpg', 'jpeg', 'png'],
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }] // Resize for efficiency
    },
});

// 3. Initialize Multer
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Limit files to 5MB
});

module.exports = upload;