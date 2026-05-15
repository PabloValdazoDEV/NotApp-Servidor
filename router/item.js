const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const authMiddleware = require("../middleware/auth.middleware");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("cloudinary").v2;
const { uploadImage } = require("../config/cloudinaryUpload");
const axios = require("axios");
const dns = require("dns").promises;
const net = require("net");

const MAX_EXTERNAL_IMAGE_BYTES = 5 * 1024 * 1024;
const EXTERNAL_IMAGE_TIMEOUT_MS = 7000;
const IMAGE_SEARCH_LIMIT = 8;
const IMAGE_SEARCH_VALIDATION_LIMIT = 18;
const SUPPORTED_EXTERNAL_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const BLOCKED_IMAGE_HOST_PARTS = ["escroq.com", "bolder.run"];
const BLOCKED_IMAGE_PATH_PARTS = ["buy-domain", "domain-for-sale"];

class ExternalImageError extends Error {}

const supermarkets = [
  "CUALQUIERA",
  "MERCADONA",
  "AHORRAMAS",
  "CARREFOUR",
  "LIDL",
  "ALDI",
  "DIA",
  "ALCAMPO",
  "EROSKI",
  "CONSUM",
  "OTROS",
];

const normalizeSupermarket = (supermarket) => {
  if (typeof supermarket !== "string") return "CUALQUIERA";
  const normalizedSupermarket = supermarket.trim().toUpperCase();
  return supermarkets.includes(normalizedSupermarket)
    ? normalizedSupermarket
    : "CUALQUIERA";
};

const getPaginationParams = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.max(Number(query.pageSize || query.limit) || 10, 1);
  return {
    page,
    pageSize,
    skip: pageSize * (page - 1),
  };
};

const buildPagination = (page, pageSize, total) => {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

const isTrue = (value) => value === true || value === "true";

const cleanSearchText = (value, maxWords = 10) => {
  if (typeof value !== "string") return "";

  const blockedTerms = new Set([
    "puta",
    "puto",
    "mierda",
    "joder",
    "fuck",
    "shit",
    "porn",
    "porno",
  ]);

  return value
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !blockedTerms.has(word.toLowerCase()))
    .slice(0, maxWords)
    .join(" ");
};

const buildProductImageQuery = ({ name, description, supermarket }) => {
  const cleanName = cleanSearchText(name, 8);
  const cleanDescription = cleanSearchText(description, 8);
  const cleanSupermarket =
    normalizeSupermarket(supermarket) !== "CUALQUIERA"
      ? cleanSearchText(supermarket, 2)
      : "";

  return [cleanName, cleanDescription, cleanSupermarket, "producto supermercado"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const isHttpUrl = (rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;

  try {
    const parsedUrl = new URL(rawUrl.trim());
    return ["http:", "https:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
};

const getParsedUrl = (rawUrl) => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};

const isBlockedSearchImageUrl = (rawUrl) => {
  const parsedUrl = getParsedUrl(rawUrl);
  if (!parsedUrl) return true;

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();

  return (
    BLOCKED_IMAGE_HOST_PARTS.some((hostPart) => hostname.includes(hostPart)) ||
    BLOCKED_IMAGE_PATH_PARTS.some((pathPart) => pathname.includes(pathPart))
  );
};

const getExternalImageHeaders = (imageUrl) => {
  const parsedUrl = getParsedUrl(imageUrl);

  return {
    Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    ...(parsedUrl ? { Referer: parsedUrl.origin } : {}),
  };
};

const isRemoteImageAccessible = async (imageUrl) => {
  if (!isHttpUrl(imageUrl) || isBlockedSearchImageUrl(imageUrl)) return false;

  try {
    const response = await axios.head(imageUrl, {
      timeout: 4000,
      maxRedirects: 0,
      headers: getExternalImageHeaders(imageUrl),
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const contentType = String(response.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    return SUPPORTED_EXTERNAL_IMAGE_TYPES.has(contentType);
  } catch {
    return false;
  }
};

const filterAccessibleImages = async (images) => {
  const candidates = normalizeImageResults(images).slice(
    0,
    IMAGE_SEARCH_VALIDATION_LIMIT
  );
  const accessibleImages = [];

  for (const image of candidates) {
    if (await isRemoteImageAccessible(image.url)) {
      accessibleImages.push(image);
    } else if (
      image.thumbnailUrl !== image.url &&
      (await isRemoteImageAccessible(image.thumbnailUrl))
    ) {
      accessibleImages.push({
        ...image,
        url: image.thumbnailUrl,
      });
    }

    if (accessibleImages.length >= IMAGE_SEARCH_LIMIT) break;
  }

  return accessibleImages;
};

const normalizeImageResults = (results) => {
  const seenUrls = new Set();

  return results
    .map(({ url, thumbnailUrl, title }) => ({
      url: typeof url === "string" ? url.trim() : "",
      thumbnailUrl:
        typeof thumbnailUrl === "string" && thumbnailUrl.trim()
          ? thumbnailUrl.trim()
          : typeof url === "string"
          ? url.trim()
          : "",
      title: typeof title === "string" ? title.trim() : "",
    }))
    .filter((image) => isHttpUrl(image.url) && isHttpUrl(image.thumbnailUrl))
    .filter(
      (image) =>
        !isBlockedSearchImageUrl(image.url) &&
        !isBlockedSearchImageUrl(image.thumbnailUrl)
    )
    .filter((image) => {
      if (seenUrls.has(image.url)) return false;
      seenUrls.add(image.url);
      return true;
    })
    .slice(0, IMAGE_SEARCH_LIMIT);
};

const logImageSearch = ({ query, provider, received, images }) => {
  console.log("[item/image-search] query:", query);
  console.log("[item/image-search] provider:", provider);
  console.log("[item/image-search] results received:", received);
  console.log("[item/image-search] first normalized:", images[0] || null);
};

const normalizeCategories = (categories) => {
  if (categories === undefined) return undefined;

  let values = categories;

  if (typeof categories === "string") {
    try {
      const parsedCategories = JSON.parse(categories);
      values = Array.isArray(parsedCategories)
        ? parsedCategories
        : categories.split(",");
    } catch {
      values = categories.split(",");
    }
  }

  if (!Array.isArray(values)) return undefined;

  return values
    .map((category) => String(category).trim())
    .filter((category) => category && category !== "0");
};

const duplicateCloudinaryImage = async (publicId) => {
  if (!publicId) return null;
  const imageUrl = cloudinary.url(publicId, { secure: true });
  const result = await uploadImage(imageUrl);
  return result.public_id;
};

const hasHomeAccess = async (userId, homeId, roles) => {
  if (!userId || !homeId) return false;
  const member = await prisma.member.findFirst({
    where: {
      user_id: userId,
      home_id: homeId,
      ...(roles ? { role: { in: roles } } : {}),
    },
  });

  return Boolean(member);
};

const isPrivateIp = (address) => {
  const ipVersion = net.isIP(address);

  if (ipVersion === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();

    if (normalized.startsWith("::ffff:")) {
      return isPrivateIp(normalized.replace("::ffff:", ""));
    }

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80")
    );
  }

  return true;
};

const validateExternalImageUrl = async (rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new ExternalImageError("URL de imagen inválida");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new ExternalImageError("URL de imagen inválida");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new ExternalImageError("URL de imagen inválida");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new ExternalImageError("URL de imagen inválida");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ExternalImageError("URL de imagen inválida");
  }

  const resolvedAddresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) => isPrivateIp(address))
  ) {
    throw new ExternalImageError("URL de imagen inválida");
  }

  return parsedUrl.toString();
};

const uploadExternalImage = async (rawUrl) => {
  try {
    const imageUrl = await validateExternalImageUrl(rawUrl);
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
      maxContentLength: MAX_EXTERNAL_IMAGE_BYTES,
      maxBodyLength: MAX_EXTERNAL_IMAGE_BYTES,
      maxRedirects: 0,
      headers: getExternalImageHeaders(imageUrl),
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const contentLength = Number(response.headers["content-length"]);
    const contentType = String(response.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (
      (contentLength && contentLength > MAX_EXTERNAL_IMAGE_BYTES) ||
      !SUPPORTED_EXTERNAL_IMAGE_TYPES.has(contentType)
    ) {
      throw new ExternalImageError("La URL no contiene una imagen válida");
    }

    const base64Image = Buffer.from(response.data).toString("base64");
    return uploadImage(`data:${contentType};base64,${base64Image}`);
  } catch (error) {
    if (error instanceof ExternalImageError) throw error;
    throw new ExternalImageError("No se pudo procesar la imagen externa");
  }
};

const searchGoogleImages = async (query) => {
  const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      key: process.env.GOOGLE_SEARCH_API_KEY,
      cx: process.env.GOOGLE_SEARCH_CX,
      q: query,
      searchType: "image",
      safe: "active",
      num: IMAGE_SEARCH_LIMIT,
    },
  });
  const rawResults = response.data.items || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.link,
      thumbnailUrl: image.image?.thumbnailLink || image.link,
      title: image.title,
    }))
  );

  return { provider: "google-custom-search", rawCount: rawResults.length, images };
};

const searchBingImages = async (query) => {
  const response = await axios.get(
    "https://api.bing.microsoft.com/v7.0/images/search",
    {
      timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.BING_IMAGE_SEARCH_API_KEY,
      },
      params: {
        q: query,
        count: IMAGE_SEARCH_LIMIT,
        safeSearch: "Moderate",
      },
    }
  );
  const rawResults = response.data.value || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.contentUrl,
      thumbnailUrl: image.thumbnailUrl,
      title: image.name,
    }))
  );

  return { provider: "bing-image-search", rawCount: rawResults.length, images };
};

const searchSerpApiImages = async (query) => {
  const response = await axios.get("https://serpapi.com/search.json", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      api_key: process.env.SERPAPI_API_KEY,
      engine: "google_images",
      q: query,
      safe: "active",
      num: IMAGE_SEARCH_LIMIT,
    },
  });
  const rawResults = response.data.images_results || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.original || image.link || image.thumbnail,
      thumbnailUrl: image.thumbnail || image.original || image.link,
      title: image.title,
    }))
  );

  return { provider: "serpapi-google-images", rawCount: rawResults.length, images };
};

const searchPexelsImages = async (query) => {
  const response = await axios.get("https://api.pexels.com/v1/search", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    headers: {
      Authorization: process.env.PEXELS_API_KEY,
    },
    params: {
      query,
      per_page: IMAGE_SEARCH_LIMIT,
      locale: "es-ES",
    },
  });
  const rawResults = response.data.photos || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.src?.large2x || image.src?.large || image.src?.original,
      thumbnailUrl: image.src?.medium || image.src?.small,
      title: image.alt || image.photographer,
    }))
  );

  return { provider: "pexels", rawCount: rawResults.length, images };
};

const searchUnsplashImages = async (query) => {
  const response = await axios.get("https://api.unsplash.com/search/photos", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    headers: {
      Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
    },
    params: {
      query,
      per_page: IMAGE_SEARCH_LIMIT,
      content_filter: "high",
      lang: "es",
    },
  });
  const rawResults = response.data.results || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.urls?.regular || image.urls?.full,
      thumbnailUrl: image.urls?.thumb || image.urls?.small,
      title: image.alt_description || image.description,
    }))
  );

  return { provider: "unsplash", rawCount: rawResults.length, images };
};

const searchDuckDuckGoImages = async (query) => {
  const searchPage = await axios.get("https://duckduckgo.com/", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      q: query,
      iax: "images",
      ia: "images",
    },
    headers: {
      "User-Agent": "Mozilla/5.0 NotApp/1.0 image-search",
    },
  });
  const tokenMatch = String(searchPage.data).match(
    /vqd=["']?([^"'\s&]+)["']?/
  );

  if (!tokenMatch?.[1]) {
    return { provider: "duckduckgo-images", rawCount: 0, images: [] };
  }

  const response = await axios.get("https://duckduckgo.com/i.js", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      l: "es-es",
      o: "json",
      q: query,
      vqd: tokenMatch[1],
      f: ",,,",
      p: "1",
    },
    headers: {
      "User-Agent": "Mozilla/5.0 NotApp/1.0 image-search",
      Referer: "https://duckduckgo.com/",
    },
  });
  const rawResults = response.data.results || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.image,
      thumbnailUrl: image.thumbnail || image.image,
      title: image.title,
    }))
  );

  return { provider: "duckduckgo-images", rawCount: rawResults.length, images };
};

const searchOpenProductsImages = async (query) => {
  const endpoints = [
    {
      provider: "open-food-facts",
      url: "https://world.openfoodfacts.org/cgi/search.pl",
    },
    {
      provider: "open-beauty-facts",
      url: "https://world.openbeautyfacts.org/cgi/search.pl",
    },
  ];
  const images = [];
  let rawCount = 0;
  const productQuery = query.replace(/\bproducto supermercado\b/gi, "").trim();
  const queries = [...new Set([query, productQuery].filter(Boolean))];
  let successfulRequests = 0;
  let lastError = null;

  for (const searchTerms of queries) {
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint.url, {
          timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
          params: {
            search_terms: searchTerms,
            search_simple: 1,
            action: "process",
            json: 1,
            page_size: IMAGE_SEARCH_LIMIT,
          },
          headers: {
            "User-Agent": "NotApp/1.0 image-search",
          },
        });
        successfulRequests += 1;
        const rawResults = response.data.products || [];
        rawCount += rawResults.length;
        images.push(
          ...normalizeImageResults(
            rawResults.map((product) => ({
              url:
                product.image_front_url ||
                product.image_url ||
                product.selected_images?.front?.display?.es ||
                product.selected_images?.front?.display?.en,
              thumbnailUrl:
                product.image_front_small_url ||
                product.image_small_url ||
                product.image_front_thumb_url ||
                product.image_thumb_url,
              title:
                product.product_name || product.generic_name || product.brands,
            }))
          )
        );
      } catch (error) {
        lastError = error;
        console.error(
          "[item/image-search] open-products endpoint failed:",
          endpoint.provider
        );
        console.error(error.message);
      }

      if (images.length >= IMAGE_SEARCH_LIMIT) break;
    }

    if (images.length >= IMAGE_SEARCH_LIMIT) break;
  }

  if (successfulRequests === 0 && lastError) {
    throw lastError;
  }

  return {
    provider: "open-products",
    rawCount,
    images: normalizeImageResults(images),
  };
};

const searchProductImages = async ({ name, description, supermarket }) => {
  const query = buildProductImageQuery({ name, description, supermarket });

  if (!query) {
    logImageSearch({ query, provider: "none", received: 0, images: [] });
    return [];
  }

  const providers = [];

  if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
    providers.push(searchGoogleImages);
  }
  if (process.env.BING_IMAGE_SEARCH_API_KEY) {
    providers.push(searchBingImages);
  }
  if (process.env.SERPAPI_API_KEY) {
    providers.push(searchSerpApiImages);
  }
  if (process.env.PEXELS_API_KEY) {
    providers.push(searchPexelsImages);
  }
  if (process.env.UNSPLASH_ACCESS_KEY) {
    providers.push(searchUnsplashImages);
  }

  providers.push(searchDuckDuckGoImages);
  providers.push(searchOpenProductsImages);

  let lastError = null;
  let hadSuccessfulProvider = false;
  let images = [];

  for (const provider of providers) {
    try {
      const result = await provider(query);
      const accessibleImages = await filterAccessibleImages(result.images);
      hadSuccessfulProvider = true;
      images = normalizeImageResults([...images, ...accessibleImages]);
      logImageSearch({
        query,
        provider: result.provider,
        received: result.rawCount,
        images: accessibleImages,
      });

      if (images.length >= 4) {
        return images;
      }
    } catch (error) {
      lastError = error;
      console.error("[item/image-search] provider failed:", provider.name);
      console.error(error.message);
    }
  }

  if (!hadSuccessfulProvider && lastError) {
    throw lastError;
  }

  return images;
};

router.post(
  "/create-item",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const {
      hogar_id,
      name,
      price,
      description,
      categories,
      supermarket,
      imageUrl,
    } = req.body;
    try {
      if (!hogar_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const hogar = await prisma.home.findUnique({ where: { id: hogar_id } });

      if (!hogar) {
        return res.status(400).json({ message: "El hogar no existe" });
      }

      if (!(await hasHomeAccess(req.user?.id, hogar_id))) {
        return res.status(403).json({
          message: "No tienes permisos para crear productos en este hogar",
        });
      }

      const image = [];

      if (req.file?.path) {
        const result = await uploadImage(req.file.path);
        image.push(result);
      } else if (imageUrl) {
        const result = await uploadExternalImage(imageUrl);
        image.push(result);
      }
      const cleanedName = name?.trim();
      const normalizedCategories = normalizeCategories(categories);

      const data = await prisma.item.create({
        data: {
          home_id: hogar_id,
          name: cleanedName,
          image: image[0]?.public_id ? image[0]?.public_id : null,
          description,
          price,
          categories: normalizedCategories || [],
          supermarket: normalizeSupermarket(supermarket),
        },
      });
      res.json({ message: "Item creado correctamente", item: data });
    } catch (error) {
      console.error(error);
      if (error instanceof ExternalImageError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get("/image-search", authMiddleware, async (req, res) => {
  const { name, description, supermarket } = req.query;

  try {
    const images = await searchProductImages({
      name,
      description,
      supermarket,
    });

    return res.json({
      success: true,
      images,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "No se han podido buscar imágenes",
    });
  }
});

router.post("/import-from-home", authMiddleware, async (req, res) => {
  const { source_home_id, target_home_id, item_ids } = req.body;
  const userId = req.user?.id;

  try {
    if (
      !userId ||
      !source_home_id ||
      !target_home_id ||
      source_home_id === target_home_id ||
      !Array.isArray(item_ids) ||
      item_ids.length === 0
    ) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const itemIds = [
      ...new Set(
        item_ids
          .filter((itemId) => typeof itemId === "string" && itemId.trim())
          .map((itemId) => itemId.trim())
      ),
    ];

    if (itemIds.length === 0) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const homes = await prisma.home.findMany({
      where: {
        id: {
          in: [source_home_id, target_home_id],
        },
      },
      select: {
        id: true,
      },
    });

    if (homes.length !== 2) {
      return res.status(404).json({ message: "Hogar no encontrado" });
    }

    const [sourceMember, targetMember] = await Promise.all([
      prisma.member.findFirst({
        where: {
          user_id: userId,
          home_id: source_home_id,
        },
      }),
      prisma.member.findFirst({
        where: {
          user_id: userId,
          home_id: target_home_id,
          role: {
            in: ["ADMIN", "OWNER"],
          },
        },
      }),
    ]);

    if (!sourceMember || !targetMember) {
      return res.status(403).json({
        message: "No tienes permisos para importar productos entre estos hogares",
      });
    }

    const sourceItems = await prisma.item.findMany({
      where: {
        id: {
          in: itemIds,
        },
        home_id: source_home_id,
      },
      select: {
        id: true,
        name: true,
        price: true,
        description: true,
        categories: true,
        supermarket: true,
        image: true,
      },
    });

    if (sourceItems.length !== itemIds.length) {
      return res.status(404).json({
        message: "No se encontraron todos los productos en el hogar origen",
      });
    }

    const duplicatedItems = await Promise.all(
      sourceItems.map(async (item) => ({
        name: item.name,
        home_id: target_home_id,
        price: item.price,
        description: item.description,
        categories: item.categories,
        supermarket: item.supermarket,
        image: await duplicateCloudinaryImage(item.image),
      }))
    );

    const items = await prisma.$transaction(
      duplicatedItems.map((item) =>
        prisma.item.create({
          data: item,
        })
      )
    );

    return res.json({
      message: "Productos importados correctamente",
      count: items.length,
      items,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:item_id",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    const {
      name,
      price,
      description,
      categories,
      imageDelete,
      supermarket,
      imageUrl,
    } = req.body;
    const categoriesFilter = normalizeCategories(categories);
    const { item_id } = req.params;
    try {
      if (!item_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }
      const item = await prisma.item.findUnique({ where: { id: item_id } });

      if (!item) {
        return res.status(400).json({ message: "El producto no existe" });
      }

      if (!(await hasHomeAccess(req.user?.id, item.home_id))) {
        return res
          .status(403)
          .json({ message: "No tienes permisos para editar este producto" });
      }

      const image = [];

      if (req.file?.path) {
        const result = await uploadImage(req.file.path);
        if (item.image) {
          await cloudinary.uploader.destroy(item.image);
        }
        image.push(result);
      } else if (imageUrl) {
        const result = await uploadExternalImage(imageUrl);
        if (item.image) {
          await cloudinary.uploader.destroy(item.image);
        }
        image.push(result);
      } else if (isTrue(imageDelete)) {
        if (item.image) {
          await cloudinary.uploader.destroy(item.image);
        }
      } else if (item.image) {
        image.push({ public_id: item.image });
      }

      const cleanedName = name?.trim();

      const data = await prisma.item.update({
        where: { id: item_id },
        data: {
          name: cleanedName,
          image: image[0]?.public_id || null,
          description,
          price,
          categories: categoriesFilter,
          ...(supermarket !== undefined
            ? { supermarket: normalizeSupermarket(supermarket) }
            : {}),
        },
      });
      res.json({ message: "Item actualizado correctamente", item: data });
    } catch (error) {
      console.error(error);
      if (error instanceof ExternalImageError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete("/:item_id", authMiddleware, async (req, res) => {
  const { item_id } = req.params;
  try {
    if (!item_id) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const item = await prisma.item.findUnique({ where: { id: item_id } });

    if (!item) {
      return res.status(400).json({ message: "El producto no existe" });
    }

    if (!(await hasHomeAccess(req.user?.id, item.home_id))) {
      return res
        .status(403)
        .json({ message: "No tienes permisos para borrar este producto" });
    }

    if (item.image) {
      await cloudinary.uploader.destroy(item.image);
    }
    await prisma.item.delete({ where: { id: item_id } });
    res.json({ message: "Item borrado correctamentename" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/params/:id_home", authMiddleware, async (req, res) => {
  const { element, page, name, category, supermarket } = req.query;
  const { id_home } = req.params;
  const { page: pageNumber, pageSize, skip } = getPaginationParams(req.query);
  const supermarketFilter = supermarket
    ? normalizeSupermarket(supermarket)
    : null;
  try {
    if (!id_home) {
      return res.status(400).json({ message: "Faltan datos" });
    }
    const home = await prisma.home.findUnique({ where: { id: id_home } });

    if (!home) {
      return res.status(400).json({ message: "No existe ese hogar" });
    }

    if (!(await hasHomeAccess(req.user?.id, id_home))) {
      return res
        .status(403)
        .json({ message: "No tienes permisos para consultar este hogar" });
    }

    const where = {
      home_id: id_home,
      AND: [
        name
          ? {
              name: {
                contains: name,
                mode: "insensitive",
              },
            }
          : {},
        category
          ? {
              categories: {
                has: category,
              },
            }
          : {},
        supermarketFilter && supermarketFilter !== "CUALQUIERA"
          ? {
              supermarket: supermarketFilter,
            }
          : {},
      ],
    };

    const total = await prisma.item.count({ where });

    const items = await prisma.item.findMany({
      where,
      orderBy: {
        name: "asc",
      },
      skip,
      take: pageSize,
    });

    return res.json({
      items,
      pagination: buildPagination(pageNumber, pageSize, total),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
