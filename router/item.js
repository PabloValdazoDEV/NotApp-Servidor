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
const { parseExplicitBoolean } = require("../utils/boolean");

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

const normalizeImageUrlForComparison = (rawUrl) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";

  try {
    const parsedUrl = new URL(rawUrl.trim());
    parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
    parsedUrl.hash = "";
    parsedUrl.searchParams.sort();

    if (parsedUrl.pathname.length > 1 && parsedUrl.pathname.endsWith("/")) {
      parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
    }

    return parsedUrl.toString();
  } catch {
    return rawUrl.trim();
  }
};

const parsePositiveInteger = (value, fallback, { min = 1, max = 50 } = {}) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) return fallback;

  return Math.min(Math.max(Math.floor(parsedValue), min), max);
};

const parseNonNegativeSearchInteger = (value, fallback = 0) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) return fallback;

  return Math.floor(parsedValue);
};

const parseSearchBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
};

const splitImageUrlList = (value) => {
  if (Array.isArray(value)) return value.flatMap(splitImageUrlList);
  if (typeof value !== "string") return [];

  const trimmedValue = value.trim();
  if (!trimmedValue) return [];

  if (trimmedValue.startsWith("[")) {
    try {
      const parsedValue = JSON.parse(trimmedValue);
      return Array.isArray(parsedValue)
        ? parsedValue.flatMap(splitImageUrlList)
        : [];
    } catch {
      return [trimmedValue];
    }
  }

  return trimmedValue.split(",");
};

const parseExcludedImageUrls = (query) => {
  const rawValues = [
    query.excludedImageUrls,
    query["excludedImageUrls[]"],
    query.excludedImageUrlsJson,
    query.excludedImageUrlsCsv,
  ];

  return new Set(
    rawValues
      .flatMap(splitImageUrlList)
      .map((value) => normalizeImageUrlForComparison(String(value)))
      .filter(Boolean)
  );
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

const filterAccessibleImages = async (
  images,
  {
    excludedImageUrls = new Set(),
    limit = IMAGE_SEARCH_LIMIT,
    avoidDuplicates = true,
  } = {}
) => {
  const candidates = normalizeImageResults(images, {
    excludedImageUrls,
    avoidDuplicates,
    limit: Math.max(IMAGE_SEARCH_VALIDATION_LIMIT, limit * 3),
  });
  const accessibleImages = [];

  for (const image of candidates) {
    if (await isRemoteImageAccessible(image.url)) {
      accessibleImages.push(image);
    } else if (
      image.thumbnailUrl !== image.url &&
      (await isRemoteImageAccessible(image.thumbnailUrl))
    ) {
      const normalizedThumbnailUrl = normalizeImageUrlForComparison(
        image.thumbnailUrl
      );

      if (!excludedImageUrls.has(normalizedThumbnailUrl)) {
        accessibleImages.push({
          ...image,
          url: image.thumbnailUrl,
        });
      }
    }

    if (accessibleImages.length >= limit) break;
  }

  return accessibleImages;
};

const normalizeImageResults = (
  results,
  {
    excludedImageUrls = new Set(),
    limit = IMAGE_SEARCH_LIMIT,
    avoidDuplicates = true,
  } = {}
) => {
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
      const normalizedUrl = normalizeImageUrlForComparison(image.url);
      const normalizedThumbnailUrl = normalizeImageUrlForComparison(
        image.thumbnailUrl
      );

      if (
        excludedImageUrls.has(normalizedUrl) ||
        excludedImageUrls.has(normalizedThumbnailUrl)
      ) {
        return false;
      }

      if (avoidDuplicates) {
        if (seenUrls.has(normalizedUrl)) return false;
        seenUrls.add(normalizedUrl);
      }

      return true;
    })
    .slice(0, limit);
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

const parseStarterImportItems = (rawItems) => {
  if (!Array.isArray(rawItems)) return [];

  const seenNames = new Set();

  return rawItems
    .slice(0, 60)
    .map((item) => {
      const name = String(item?.name || "").trim();
      if (!name) return null;

      const normalizedName = name.toLowerCase();
      if (seenNames.has(normalizedName)) return null;
      seenNames.add(normalizedName);

      return {
        name,
        price: item.price ? String(item.price).trim() : "",
        description: item.description ? String(item.description).trim() : "",
        categories: normalizeCategories(item.categories) || [],
        supermarket: normalizeSupermarket(item.supermarket),
        is_recurring: Boolean(item.is_recurring),
      };
    })
    .filter(Boolean);
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

const searchGoogleImages = async (
  query,
  { page = 1, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
  const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      key: process.env.GOOGLE_SEARCH_API_KEY,
      cx: process.env.GOOGLE_SEARCH_CX,
      q: query,
      searchType: "image",
      safe: "active",
      num: limit,
      start: Math.min((page - 1) * limit + 1, 91),
    },
  });
  const rawResults = response.data.items || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.link,
      thumbnailUrl: image.image?.thumbnailLink || image.link,
      title: image.title,
    })),
    { limit }
  );

  return { provider: "google-custom-search", rawCount: rawResults.length, images };
};

const searchBingImages = async (
  query,
  { offset = 0, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
  const response = await axios.get(
    "https://api.bing.microsoft.com/v7.0/images/search",
    {
      timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.BING_IMAGE_SEARCH_API_KEY,
      },
      params: {
        q: query,
        count: limit,
        offset,
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
    })),
    { limit }
  );

  return { provider: "bing-image-search", rawCount: rawResults.length, images };
};

const searchSerpApiImages = async (
  query,
  { page = 1, offset = 0, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
  const response = await axios.get("https://serpapi.com/search.json", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    params: {
      api_key: process.env.SERPAPI_API_KEY,
      engine: "google_images",
      q: query,
      safe: "active",
      num: limit,
      ijn: page - 1,
      start: offset,
    },
  });
  const rawResults = response.data.images_results || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.original || image.link || image.thumbnail,
      thumbnailUrl: image.thumbnail || image.original || image.link,
      title: image.title,
    })),
    { limit }
  );

  return { provider: "serpapi-google-images", rawCount: rawResults.length, images };
};

const searchPexelsImages = async (
  query,
  { page = 1, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
  const response = await axios.get("https://api.pexels.com/v1/search", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    headers: {
      Authorization: process.env.PEXELS_API_KEY,
    },
    params: {
      query,
      per_page: limit,
      page,
      locale: "es-ES",
    },
  });
  const rawResults = response.data.photos || [];
  const images = normalizeImageResults(
    rawResults.map((image) => ({
      url: image.src?.large2x || image.src?.large || image.src?.original,
      thumbnailUrl: image.src?.medium || image.src?.small,
      title: image.alt || image.photographer,
    })),
    { limit }
  );

  return { provider: "pexels", rawCount: rawResults.length, images };
};

const searchUnsplashImages = async (
  query,
  { page = 1, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
  const response = await axios.get("https://api.unsplash.com/search/photos", {
    timeout: EXTERNAL_IMAGE_TIMEOUT_MS,
    headers: {
      Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
    },
    params: {
      query,
      per_page: limit,
      page,
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
    })),
    { limit }
  );

  return { provider: "unsplash", rawCount: rawResults.length, images };
};

const searchDuckDuckGoImages = async (
  query,
  { offset = 0, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
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
      s: offset,
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
    })),
    { limit }
  );

  return { provider: "duckduckgo-images", rawCount: rawResults.length, images };
};

const searchOpenProductsImages = async (
  query,
  { page = 1, limit = IMAGE_SEARCH_LIMIT } = {}
) => {
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
            page,
            page_size: limit,
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
            })),
            { limit }
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

      if (images.length >= limit) break;
    }

    if (images.length >= limit) break;
  }

  if (successfulRequests === 0 && lastError) {
    throw lastError;
  }

  return {
    provider: "open-products",
    rawCount,
    images: normalizeImageResults(images, { limit }),
  };
};

const searchProductImages = async ({
  name,
  description,
  supermarket,
  excludedImageUrls = new Set(),
  page,
  offset,
  limit,
  searchAttempt,
  avoidDuplicates = true,
  provider: requestedProvider,
}) => {
  const query = buildProductImageQuery({ name, description, supermarket });

  if (!query) {
    return [];
  }

  const excludedCount = excludedImageUrls.size;
  const searchLimit = parsePositiveInteger(limit, IMAGE_SEARCH_LIMIT, {
    min: 1,
    max: 20,
  });
  const attempt = parseNonNegativeSearchInteger(searchAttempt);
  const basePage = parsePositiveInteger(
    page,
    Math.floor(excludedCount / searchLimit) + 1,
    { min: 1, max: 100 }
  );
  const baseOffset =
    offset === undefined
      ? (basePage - 1) * searchLimit
      : parseNonNegativeSearchInteger(offset);
  const searchPage = Math.max(basePage + attempt, 1);
  const searchOffset = baseOffset + attempt * searchLimit;
  const providers = [];

  if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
    providers.push({ name: "google-custom-search", search: searchGoogleImages });
  }
  if (process.env.BING_IMAGE_SEARCH_API_KEY) {
    providers.push({ name: "bing-image-search", search: searchBingImages });
  }
  if (process.env.SERPAPI_API_KEY) {
    providers.push({ name: "serpapi-google-images", search: searchSerpApiImages });
  }
  if (process.env.PEXELS_API_KEY) {
    providers.push({ name: "pexels", search: searchPexelsImages });
  }
  if (process.env.UNSPLASH_ACCESS_KEY) {
    providers.push({ name: "unsplash", search: searchUnsplashImages });
  }

  providers.push({ name: "duckduckgo-images", search: searchDuckDuckGoImages });
  providers.push({ name: "open-products", search: searchOpenProductsImages });

  const providerFilter =
    typeof requestedProvider === "string" ? requestedProvider.trim() : "";
  let activeProviders = providerFilter
    ? providers.filter((provider) => provider.name === providerFilter)
    : providers;

  if (activeProviders.length === 0) {
    activeProviders = providers;
  }

  if (!providerFilter && activeProviders.length > 1) {
    const providerOffset = (searchPage + attempt - 1) % activeProviders.length;
    activeProviders = [
      ...activeProviders.slice(providerOffset),
      ...activeProviders.slice(0, providerOffset),
    ];
  }

  let lastError = null;
  let hadSuccessfulProvider = false;
  let images = [];

  for (const provider of activeProviders) {
    try {
      const result = await provider.search(query, {
        page: searchPage,
        offset: searchOffset,
        limit: searchLimit,
      });
      const accessibleImages = await filterAccessibleImages(result.images, {
        excludedImageUrls,
        limit: searchLimit,
        avoidDuplicates,
      });
      hadSuccessfulProvider = true;
      images = normalizeImageResults([...images, ...accessibleImages], {
        excludedImageUrls,
        limit: searchLimit,
        avoidDuplicates,
      });
      if (images.length >= searchLimit) {
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
      is_recurring,
    } = req.body;
    try {
      if (!hogar_id || !name) {
        return res.status(400).json({ message: "Faltan datos" });
      }

      const recurringValue = parseExplicitBoolean(is_recurring, false);
      if (!recurringValue.valid) {
        return res.status(400).json({
          message: "is_recurring debe ser un valor booleano valido",
        });
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
          is_recurring: recurringValue.value,
        },
      });
      res.json({
        success: true,
        message: "Item creado correctamente",
        item: data,
      });
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
  const {
    name,
    description,
    supermarket,
    page,
    offset,
    limit,
    searchAttempt,
    avoidDuplicates,
    provider,
  } = req.query;
  const excludedImageUrls = parseExcludedImageUrls(req.query);

  try {
    const images = await searchProductImages({
      name,
      description,
      supermarket,
      excludedImageUrls,
      page,
      offset,
      limit,
      searchAttempt,
      avoidDuplicates: parseSearchBoolean(avoidDuplicates, true),
      provider,
    });

    return res.json({
      success: true,
      images,
      results: images,
      items: images,
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
        is_recurring: true,
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
        is_recurring: item.is_recurring,
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

router.post("/import-starter-products", authMiddleware, async (req, res) => {
  const { target_home_id, items } = req.body;
  const userId = req.user?.id;

  try {
    if (!userId || !target_home_id || !Array.isArray(items)) {
      return res.status(400).json({ message: "Faltan datos" });
    }

    const targetMember = await prisma.member.findFirst({
      where: {
        user_id: userId,
        home_id: target_home_id,
        role: {
          in: ["ADMIN", "OWNER"],
        },
      },
    });

    if (!targetMember) {
      return res.status(403).json({
        message: "No tienes permisos para importar productos en este hogar",
      });
    }

    const parsedItems = parseStarterImportItems(items);

    if (parsedItems.length === 0) {
      return res.status(400).json({ message: "Selecciona al menos un producto" });
    }

    const existingItems = await prisma.item.findMany({
      where: {
        home_id: target_home_id,
      },
      select: {
        name: true,
      },
    });
    const existingNames = new Set(
      existingItems.map((item) => item.name.trim().toLowerCase())
    );
    const itemsToCreate = parsedItems
      .filter((item) => !existingNames.has(item.name.toLowerCase()))
      .map((item) => ({
        ...item,
        home_id: target_home_id,
      }));

    if (itemsToCreate.length === 0) {
      return res.json({
        success: true,
        message: "Todos esos productos ya estaban en el hogar",
        count: 0,
        items: [],
      });
    }

    const createdItems = await prisma.$transaction(
      itemsToCreate.map((item) =>
        prisma.item.create({
          data: item,
        })
      )
    );

    return res.json({
      success: true,
      message: "Productos básicos importados correctamente",
      count: createdItems.length,
      skipped_count: parsedItems.length - createdItems.length,
      items: createdItems,
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
      is_recurring,
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

      const recurringValue = parseExplicitBoolean(
        is_recurring,
        item.is_recurring
      );
      if (!recurringValue.valid) {
        return res.status(400).json({
          message: "is_recurring debe ser un valor booleano valido",
        });
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
          ...(recurringValue.provided
            ? { is_recurring: recurringValue.value }
            : {}),
        },
      });
      res.json({
        success: true,
        message: "Item actualizado correctamente",
        item: data,
      });
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
                contains: name.trim(),
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
