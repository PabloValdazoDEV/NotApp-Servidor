const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { parseExplicitBoolean } = require("../utils/boolean");
const {
  USER_PLAN,
  getEffectiveUserPlan,
  getPremiumHomeSlots,
} = require("../utils/plans");
const { getAllowedGoogleClientIds, normalizeEmail } = require("../utils/googleAuth");
const {
  getCodeExpiryMinutes,
  validateRegistrationData,
} = require("../utils/registration");
const { createRateLimiter } = require("../middleware/rateLimit");

describe("parseExplicitBoolean", () => {
  it("uses the default when the value is not provided", () => {
    assert.deepEqual(parseExplicitBoolean(undefined, false), {
      valid: true,
      value: false,
      provided: false,
    });
  });

  it("accepts boolean, numeric and string representations", () => {
    assert.equal(parseExplicitBoolean(true, false).value, true);
    assert.equal(parseExplicitBoolean(0, true).value, false);
    assert.equal(parseExplicitBoolean(" TRUE ", false).value, true);
    assert.equal(parseExplicitBoolean("0", true).value, false);
  });

  it("rejects unsupported values while preserving the default", () => {
    assert.deepEqual(parseExplicitBoolean("maybe", true), {
      valid: false,
      value: true,
      provided: true,
    });
  });
});

describe("effective user plans", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");

  it("keeps free users free and recognises active premium users", () => {
    assert.equal(getEffectiveUserPlan(null, now), USER_PLAN.FREE);
    assert.equal(getEffectiveUserPlan({ plan: USER_PLAN.FREE }, now), USER_PLAN.FREE);
    assert.equal(
      getEffectiveUserPlan(
        { plan: USER_PLAN.PREMIUM, premium_expires_at: "2030-02-01T00:00:00.000Z" },
        now
      ),
      USER_PLAN.PREMIUM
    );
  });

  it("expires premium users and preserves the app owner plan", () => {
    assert.equal(
      getEffectiveUserPlan(
        { plan: USER_PLAN.PREMIUM, premium_expires_at: "2029-12-31T23:59:59.000Z" },
        now
      ),
      USER_PLAN.FREE
    );
    assert.equal(getEffectiveUserPlan({ plan: USER_PLAN.APP_OWNER }, now), USER_PLAN.APP_OWNER);
  });

  it("calculates premium home slots", () => {
    assert.equal(getPremiumHomeSlots({ plan: USER_PLAN.FREE }), 0);
    assert.equal(
      getPremiumHomeSlots({
        plan: USER_PLAN.PREMIUM,
        premium_expires_at: "2030-02-01T00:00:00.000Z",
        premium_home_slots: 4,
      }),
      4
    );
    assert.equal(getPremiumHomeSlots({ plan: USER_PLAN.APP_OWNER }), Infinity);
  });
});

describe("Google authentication configuration", () => {
  it("normalizes emails and ignores empty client IDs", () => {
    const previousWebClientId = process.env.GOOGLE_WEB_CLIENT_ID;
    const previousServerClientId = process.env.GOOGLE_SERVER_CLIENT_ID;
    const previousClientIds = process.env.GOOGLE_CLIENT_IDS;

    process.env.GOOGLE_WEB_CLIENT_ID = " web-client ";
    process.env.GOOGLE_SERVER_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_IDS = "mobile-client, web-client";

    assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
    assert.deepEqual(getAllowedGoogleClientIds(), ["web-client", "mobile-client"]);

    if (previousWebClientId === undefined) delete process.env.GOOGLE_WEB_CLIENT_ID;
    else process.env.GOOGLE_WEB_CLIENT_ID = previousWebClientId;
    if (previousServerClientId === undefined) delete process.env.GOOGLE_SERVER_CLIENT_ID;
    else process.env.GOOGLE_SERVER_CLIENT_ID = previousServerClientId;
    if (previousClientIds === undefined) delete process.env.GOOGLE_CLIENT_IDS;
    else process.env.GOOGLE_CLIENT_IDS = previousClientIds;
  });
});

describe("email registration", () => {
  it("validates a single password and supports a 15 to 30 minute code", () => {
    const previousExpiry = process.env.REGISTRATION_CODE_EXPIRES_MINUTES;

    assert.equal(
      validateRegistrationData({
        name: "Ana",
        email: "ana@example.com",
        password: "Password1!",
      }),
      null
    );
    assert.equal(
      validateRegistrationData({
        name: "Ana",
        email: "ana@example.com",
        password: "weak",
      }),
      "La contraseña debe tener al menos 7 caracteres, una mayúscula, un número y un carácter especial"
    );

    process.env.REGISTRATION_CODE_EXPIRES_MINUTES = "30";
    assert.equal(getCodeExpiryMinutes(), 30);

    if (previousExpiry === undefined) delete process.env.REGISTRATION_CODE_EXPIRES_MINUTES;
    else process.env.REGISTRATION_CODE_EXPIRES_MINUTES = previousExpiry;
  });
});

describe("rate limiting", () => {
  it("blocks requests after the configured maximum and reports retry information", () => {
    const limiter = createRateLimiter({
      name: "test-rate-limit",
      windowMs: 60_000,
      max: 2,
    });
    const request = { ip: "203.0.113.10" };
    const responses = [];
    let nextCalls = 0;

    const callLimiter = () => {
      const response = {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };

      limiter(request, response, () => {
        nextCalls += 1;
      });
      responses.push(response);
    };

    callLimiter();
    callLimiter();
    callLimiter();

    assert.equal(nextCalls, 2);
    assert.equal(responses[2].statusCode, 429);
    assert.equal(responses[2].headers["Retry-After"] > 0, true);
    assert.equal(responses[2].body.retry_after_seconds > 0, true);
  });
});
