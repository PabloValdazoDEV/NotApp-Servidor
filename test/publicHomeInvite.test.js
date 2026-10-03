const assert = require("node:assert/strict");
const { after, before, describe, it, mock } = require("node:test");
const { randomUUID } = require("node:crypto");

const testUrl = process.env.NOTAPP_TEST_DATABASE_URL;
if (testUrl) {
  const address = new URL(testUrl);
  if (!["127.0.0.1", "localhost"].includes(address.hostname) || !/^\/[a-zA-Z0-9_]+_qa$/.test(address.pathname)) {
    throw new Error("Invitation tests require an explicit local *_qa database");
  }
}

describe("public and email invitations with verified registration", { skip: !testUrl }, () => {
  let prisma, server, base, jwt, owner, mails;
  const secret = "notapp-invitation-qa-" + randomUUID();
  const password = "NotappTest1!";
  const email = () => randomUUID() + "@example.invalid";
  const signedIn = (user) => jwt.sign({ id: user.id, email: user.email }, secret);
  const publicToken = (homeId) => jwt.sign({ home_id: homeId, purpose: "public-home-invite" }, secret, { expiresIn: "1h" });
  const request = async (path, body, user) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(user ? { Authorization: "Bearer " + signedIn(user) } : {}) },
      body: JSON.stringify(body || {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const createUser = () => prisma.user.create({ data: { email: email(), name: "Invitation QA", password: "test-only" } });
  const homeWithMembers = async (count, premium = false) => {
    const homeOwner = premium
      ? await prisma.user.create({ data: { email: email(), password: "test-only", plan: "PREMIUM", premium_home_slots: 2, premium_expires_at: new Date(Date.now() + 86400000) } })
      : owner;
    const home = await prisma.home.create({ data: {
      name: "Invitation QA " + randomUUID(),
      ...(premium ? { premium_assigned_by_user_id: homeOwner.id, premium_assigned_at: new Date() } : {}),
      members: { create: { user_id: homeOwner.id, role: "OWNER" } },
    } });
    for (let i = 1; i < count; i++) {
      const user = await createUser();
      await prisma.member.create({ data: { home_id: home.id, user_id: user.id, role: "MEMBER" } });
    }
    return home;
  };
  const codeFor = (address) => {
    const mail = mails.findLast((mail) => mail.to === address);
    const match = mail?.html.match(/codigo de verificacion es (\d{6})/);
    assert.ok(match, "the verification email includes its six-digit code");
    return match[1];
  };

  before(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET = secret;
    process.env.GOOGLE_WEB_CLIENT_ID = "invitation-qa-client";
    process.env.RATE_LIMIT_ENABLED = "false";
    process.env.URL_REGISTER = "/configured-register";
    process.env.URL = "https://notapp.example.invalid/";
    prisma = require("../prisma/prisma");
    jwt = require("jsonwebtoken");
    mails = [];
    mock.method(require("../config/nodemailer"), "sendMail", async (mail) => {
      mails.push(mail);
      return { accepted: [mail.to] };
    });
    mock.method(require("google-auth-library").OAuth2Client.prototype, "verifyIdToken", async ({ idToken }) => {
      const profile = JSON.parse(idToken);
      return { getPayload: () => ({ ...profile, email_verified: true }) };
    });
    const app = require("express")();
    app.use(require("express").json());
    app.use("/member", require("../router/member"));
    app.use("/", require("../router/auth"));
    server = await new Promise((resolve) => {
      const running = app.listen(0, "127.0.0.1", () => resolve(running));
    });
    base = "http://127.0.0.1:" + server.address().port;
    owner = await prisma.user.create({ data: { email: email(), name: "Invitation owner QA", password: "test-only", plan: "APP_OWNER" } });
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma) await prisma.$disconnect();
    mock.restoreAll();
  });

  it("keeps a public token until email verification and supports both register paths", async () => {
    const home = await homeWithMembers(1);
    for (const registerPath of ["/register", "/configured-register"]) {
      const address = email();
      const inviteToken = publicToken(home.id);
      const start = await request(registerPath, { name: "Invitation QA", email: address, password, inviteToken });
      assert.equal(start.status, 200);
      assert.equal(await prisma.user.count({ where: { email: address } }), 0);
      assert.equal((await prisma.pendingRegistration.findUnique({ where: { email: address } })).invite_token, inviteToken);
      const wrong = await request("/auth/register/verify", { email: address, code: "invalid" });
      assert.equal(wrong.status, 400);
      const finish = await request("/auth/register/verify", { email: address, code: codeFor(address) });
      assert.equal(finish.status, 200);
      assert.equal(finish.body.joinedHomeId, home.id);
      const userId = jwt.verify(finish.body.token, secret).id;
      assert.equal(await prisma.member.count({ where: { user_id: userId, home_id: home.id } }), 1);
      assert.equal(await prisma.pendingRegistration.count({ where: { email: address } }), 0);
    }
  });

  it("links an email invitation without automatically accepting it", async () => {
    const home = await homeWithMembers(1);
    const address = email();
    const inviteToken = jwt.sign({ id_hogar: home.id, email: address }, secret, { expiresIn: "1h" });
    const invitation = await prisma.invitation.create({ data: { home_id: home.id, email: address } });
    await prisma.oneTimeToken.create({ data: { token: inviteToken, purpose: "inivit-home", expiresAt: new Date(Date.now() + 3600000) } });
    assert.equal((await request("/member/register-special", { name: "Email invitation QA", email: address, password, token: inviteToken })).status, 200);
    const finish = await request("/auth/register/verify", { email: address, code: codeFor(address) });
    assert.equal(finish.status, 200);
    const userId = jwt.verify(finish.body.token, secret).id;
    assert.equal((await prisma.invitation.findUnique({ where: { id: invitation.id } })).user_id, userId);
    assert.equal((await prisma.oneTimeToken.findUnique({ where: { token: inviteToken } })).used, true);
    assert.equal(await prisma.member.count({ where: { user_id: userId, home_id: home.id } }), 0);
  });

  it("rolls back an account when the public home becomes full before verification", async () => {
    const home = await homeWithMembers(4);
    const address = email();
    assert.equal((await request("/register", { name: "Full home QA", email: address, password, inviteToken: publicToken(home.id) })).status, 200);
    const finish = await request("/auth/register/verify", { email: address, code: codeFor(address) });
    assert.equal(finish.status, 400);
    assert.equal(await prisma.user.count({ where: { email: address } }), 0);
    assert.equal(await prisma.pendingRegistration.count({ where: { email: address } }), 1);
    assert.equal(await prisma.member.count({ where: { home_id: home.id } }), 4);
  });

  it("joins with Google and avoids duplicate members when repeated", async () => {
    const home = await homeWithMembers(1);
    const address = email();
    const idToken = JSON.stringify({ sub: randomUUID(), email: address, name: "Google invitation QA" });
    const first = await request("/auth/google", { idToken, inviteToken: publicToken(home.id) });
    assert.equal(first.status, 200);
    assert.equal(first.body.joinedHomeId, home.id);
    const second = await request("/auth/google", { idToken, inviteToken: publicToken(home.id) });
    assert.equal(second.status, 200);
    const userId = jwt.verify(first.body.token, secret).id;
    assert.equal(jwt.verify(second.body.token, secret).id, userId);
    assert.equal(await prisma.member.count({ where: { home_id: home.id, user_id: userId } }), 1);
  });

  it("does not assign an email invitation to a different Google address", async () => {
    const home = await homeWithMembers(1);
    const address = email();
    const otherAddress = email();
    const inviteToken = jwt.sign({ id_hogar: home.id, email: address }, secret, { expiresIn: "1h" });
    const invitation = await prisma.invitation.create({ data: { home_id: home.id, email: address } });
    await prisma.oneTimeToken.create({ data: { token: inviteToken, purpose: "inivit-home", expiresAt: new Date(Date.now() + 3600000) } });
    const result = await request("/auth/google", { idToken: JSON.stringify({ sub: randomUUID(), email: otherAddress }), inviteToken });
    assert.equal(result.status, 400);
    assert.equal(await prisma.user.count({ where: { email: otherAddress } }), 0);
    assert.equal((await prisma.invitation.findUnique({ where: { id: invitation.id } })).user_id, null);
    assert.equal((await prisma.oneTimeToken.findUnique({ where: { token: inviteToken } })).used, false);
  });

  it("respects Free and Premium limits under concurrent public joins", async () => {
    for (const premium of [false, true]) {
      const maximum = premium ? 8 : 4;
      const home = await homeWithMembers(maximum - 1, premium);
      const users = await Promise.all([createUser(), createUser()]);
      const token = publicToken(home.id);
      const results = await Promise.all(users.map((user) => request("/member/public-invite/" + token + "/join", {}, user)));
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      assert.equal(await prisma.member.count({ where: { home_id: home.id } }), maximum);
    }
  });
});
