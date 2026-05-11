const cloudinary = require("cloudinary").v2;

const mobileImageUploadOptions = {
  resource_type: "image",
  transformation: [
    {
      width: 1400,
      height: 1400,
      crop: "limit",
      quality: "auto:good",
    },
  ],
};

const uploadImage = (filePathOrUrl, options = {}) =>
  cloudinary.uploader.upload(filePathOrUrl, {
    ...mobileImageUploadOptions,
    ...options,
  });

module.exports = {
  uploadImage,
};
