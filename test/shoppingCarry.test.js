const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const { randomUUID } = require("node:crypto");
const { shoppingState } = require("../utils/shoppingState");

describe("shopping state quantities", () => {
  const row = { quantity: 3, purchased_quantity: 1, status: "PENDING", check_take: false };
  it("keeps bought units when the remaining units become missing", () => {
    assert.deepEqual(shoppingState(row, { status: "NOT_FOUND" }), { quantity: 3, purchased_quantity: 1, status: "NOT_FOUND", check_take: false });
  });
  it("finishes a partial purchase with its exact amount", () => {
    assert.equal(shoppingState(row, { purchased_quantity: 1, status: "NOT_FOUND" }).purchased_quantity, 1);
    assert.equal(shoppingState(row, { purchased_quantity: 3 }).status, "FOUND");
  });
  it("normalizes old basket marks to bought quantities", () => {
    assert.equal(shoppingState(row, { check_take: true }).purchased_quantity, 3);
    assert.equal(shoppingState(row, { check_take: false }).purchased_quantity, 0);
  });
  it("new units added after buying remain pending", () => {
    const bought = { quantity: 3, purchased_quantity: 3, status: "FOUND", check_take: true };
    assert.deepEqual(shoppingState(bought, { quantity: 5 }), { quantity: 5, purchased_quantity: 3, status: "PENDING", check_take: false });
  });
  it("preserves status-only undo compatibility for older clients", () => {
    const bought = { quantity: 3, purchased_quantity: 3, status: "FOUND", check_take: true };
    assert.equal(shoppingState(bought, { status: "PENDING" }).purchased_quantity, 0);
    assert.equal(shoppingState(bought, { status: "NOT_FOUND" }).purchased_quantity, 0);
    assert.equal(shoppingState({ ...row, status: "NOT_FOUND" }, { status: "NOT_FOUND" }).purchased_quantity, 1);
  });
  it("rejects quantities that would erase bought units", () => {
    assert.throws(() => shoppingState(row, { quantity: 0 }));
    assert.throws(() => shoppingState({ ...row, purchased_quantity: 2 }, { quantity: 1 }));
    assert.throws(() => shoppingState(row, { purchased_quantity: 4 }));
  });
  it("rejects non-integers, null, booleans and database overflows", () => {
    for (const quantity of [null, "", true, [], {}, 1.5, 2147483648]) assert.throws(() => shoppingState(row, { quantity }));
    assert.throws(() => shoppingState(row, { status: "PARTIAL" }));
  });
});

const testUrl = process.env.NOTAPP_TEST_DATABASE_URL;
if (testUrl) {
  const address = new URL(testUrl);
  if (!["127.0.0.1", "localhost"].includes(address.hostname) || !/^\/[a-zA-Z0-9_]+_qa$/.test(address.pathname)) throw new Error("Integration tests require an explicit local *_qa database");
}

describe("real shopping carry API with PostgreSQL", { skip: !testUrl }, () => {
  let prisma, server, base, homeId, otherHomeId, owner, member, stranger;
  const events = [];
  const secret = "notapp-local-qa-only-" + randomUUID();
  const jwt = require("jsonwebtoken");
  const token = id => jwt.sign({ id }, secret);
  const request = async (path, method = "GET", body, id = owner) => {
    const response = await fetch(base + path, { method, headers: { Authorization: "Bearer " + token(id), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const fixture = async () => {
    const suffix = randomUUID();
    const items = await Promise.all(["Leche", "Pan", "Plátanos"].map(name => prisma.item.create({ data: { home_id: homeId, name: name + suffix, categories: ["OTROS"], supermarket: "CUALQUIERA", is_recurring: name === "Leche", image: "qa-photo", price: "1.20" } })));
    const source = await prisma.list.create({ data: { title: "Resuelta " + suffix, home_id: homeId, itemsList: { create: [
      { item_id: items[0].id, quantity: 3, purchased_quantity: 1, status: "NOT_FOUND" },
      { item_id: items[1].id, quantity: 1, status: "NOT_FOUND" },
      { item_id: items[2].id, quantity: 1, purchased_quantity: 1, status: "FOUND", check_take: true },
    ] } }, include: { itemsList: { orderBy: { id: "asc" } } } });
    const target = await prisma.list.create({ data: { title: "Activa " + suffix, home_id: homeId, itemsList: { create: [
      { item_id: items[0].id, quantity: 4, purchased_quantity: 1, status: "PENDING" },
      { item_id: items[1].id, quantity: 3, purchased_quantity: 1, status: "NOT_FOUND" },
      { item_id: items[2].id, quantity: 1, status: "PENDING" },
    ] } }, include: { itemsList: true } });
    return { source, target, items };
  };
  before(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET = secret;
    prisma = require("../prisma/prisma");
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.set("io", { to: room => ({ emit: (name, payload) => events.push({ room, name, payload }) }) });
    app.use("/list", require("../router/list"));
    app.use("/item", require("../router/item"));
    server = await new Promise(resolve => { const running = app.listen(0, "127.0.0.1", () => resolve(running)); });
    base = "http://127.0.0.1:" + server.address().port;
    const suffix = randomUUID();
    [owner, member, stranger] = await Promise.all(["owner", "member", "stranger"].map(async name => (await prisma.user.create({ data: { email: name + suffix + "@example.invalid", password: "test-only", name } })).id));
    homeId = (await prisma.home.create({ data: { name: "QA home", members: { create: [{ user_id: owner, role: "OWNER" }, { user_id: member, role: "MEMBER" }] } } })).id;
    otherHomeId = (await prisma.home.create({ data: { name: "Other QA home", members: { create: [{ user_id: owner, role: "OWNER" }, { user_id: stranger, role: "MEMBER" }] } } })).id;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if (prisma) await prisma.$disconnect(); });
  it("offers only active destinations from the same home", async () => {
    const { source, target, items } = await fixture();
    const empty = await prisma.list.create({ data: { title: "Empty", home_id: homeId } });
    const bought = await prisma.list.create({ data: { title: "Bought", home_id: homeId, itemsList: { create: { item_id: items[0].id, quantity: 1, purchased_quantity: 1, status: "FOUND", check_take: true } } } });
    const missing = await prisma.list.create({ data: { title: "Missing", home_id: homeId, itemsList: { create: { item_id: items[0].id, status: "NOT_FOUND" } } } });
    const archived = await prisma.list.create({ data: { title: "Archived", home_id: homeId, listCheck: true, itemsList: { create: { item_id: items[0].id } } } });
    const other = await prisma.list.create({ data: { title: "Other", home_id: otherHomeId, itemsList: { create: { item_id: items[0].id } } } });
    const result = await request("/list/carry-missing/" + source.id);
    assert.equal(result.status, 200);
    const ids = result.body.targets.map(list => list.id);
    assert.ok(ids.includes(target.id));
    for (const excluded of [source.id, empty.id, bought.id, missing.id, archived.id, other.id]) assert.ok(!ids.includes(excluded));
  });
  it("carries just the missing units while retaining source, photos and tags", async () => {
    const { source, items } = await fixture();
    const response = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Next", clientMutationId: "qa-mutation" });
    assert.equal(response.status, 200);
    assert.equal(response.body.clientMutationId, "qa-mutation");
    assert.equal(response.body.list.itemsList.length, 2);
    const milk = response.body.list.itemsList.find(row => row.item_id === items[0].id);
    assert.equal(milk.quantity, 2); assert.equal(milk.purchased_quantity, 0); assert.equal(milk.status, "PENDING");
    assert.equal(milk.item.image, "qa-photo"); assert.equal(milk.item.is_recurring, true); assert.deepEqual(milk.item.categories, ["OTROS"]);
    assert.deepEqual(await prisma.itemList.findMany({ where: { list_id: source.id }, orderBy: { id: "asc" } }), source.itemsList);
    assert.ok(events.some(event => event.room === "list:" + source.id && event.name === "list:changed"));
  });
  it("merges into pending quantities without resetting bought units or resolved rows", async () => {
    const { source, target, items } = await fixture();
    const resolved = target.itemsList.find(row => row.item_id === items[1].id);
    const result = await request("/list/carry-missing/" + source.id, "POST", { mode: "existing", target_list_id: target.id });
    assert.equal(result.status, 200);
    const milk = result.body.list.itemsList.find(row => row.item_id === items[0].id);
    assert.equal(milk.quantity, 6); assert.equal(milk.purchased_quantity, 1); assert.equal(milk.status, "PENDING");
    assert.deepEqual(await prisma.itemList.findUnique({ where: { id: resolved.id } }), resolved);
    const bread = result.body.list.itemsList.filter(row => row.item_id === items[1].id);
    assert.equal(bread.length, 2); assert.equal(bread.find(row => row.status === "PENDING").quantity, 1);
    const sourceGet = (await request("/list/home/" + homeId)).body.lists.find(list => list.id === source.id);
    assert.equal(sourceGet.has_not_found_copy, true);
    assert.equal(sourceGet.not_found_copy_list_id, target.id);
  });
  it("keeps duplicate and concurrent submissions idempotent", async () => {
    const { source } = await fixture();
    const results = await Promise.all([1, 2].map(() => request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Concurrent" })));
    for (const result of results) assert.equal(result.status, 200);
    assert.equal(results[0].body.list.id, results[1].body.list.id);
    const repeat = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Repeated" });
    assert.equal(repeat.body.reused, true); assert.equal(repeat.body.list.id, results[0].body.list.id);
    assert.equal(await prisma.shoppingCarry.count({ where: { source_list_id: source.id } }), 1);
    assert.equal(await prisma.list.count({ where: { copied_from_not_found_list_id: source.id } }), 1);
  });
  it("blocks unfinished sources, foreign homes and invalid destinations", async () => {
    const { source, target } = await fixture();
    assert.equal((await request("/list/carry-missing/" + target.id, "POST", { mode: "new", title: "Too soon" })).status, 409);
    const foreign = await prisma.list.create({ data: { title: "Wrong home", home_id: otherHomeId } });
    for (const id of [source.id, foreign.id, "missing-id"]) assert.equal((await request("/list/carry-missing/" + source.id, "POST", { mode: "existing", target_list_id: id })).status, 409);
    assert.equal((await request("/list/carry-missing/" + source.id, "POST", { mode: "existing" })).status, 400);
  });
  it("enforces membership for reads, writes and undo", async () => {
    const { source } = await fixture();
    assert.equal((await request("/list/carry-missing/" + source.id, "GET", undefined, stranger)).status, 403);
    assert.equal((await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Denied" }, stranger)).status, 403);
    const carried = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "By member" }, member);
    assert.equal(carried.status, 200);
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: carried.body.carry.id }, owner)).status, 403);
  });
  it("undo subtracts only its delta and keeps subsequent edits and new list", async () => {
    const { source, target, items } = await fixture();
    const result = await request("/list/carry-missing/" + source.id, "POST", { mode: "existing", target_list_id: target.id });
    const milk = target.itemsList.find(row => row.item_id === items[0].id);
    await prisma.itemList.update({ where: { id: milk.id }, data: { quantity: { increment: 4 }, purchased_quantity: 2 } });
    await prisma.list.update({ where: { id: target.id }, data: { title: "Renamed after carry" } });
    const undone = await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: result.body.carry.id });
    assert.equal(undone.status, 200);
    assert.equal((await prisma.itemList.findUnique({ where: { id: milk.id } })).quantity, 8);
    assert.equal((await prisma.itemList.findUnique({ where: { id: milk.id } })).purchased_quantity, 2);
    assert.equal((await prisma.list.findUnique({ where: { id: target.id } })).title, "Renamed after carry");
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: result.body.carry.id })).body.reused, true);
    assert.equal((await request("/list/home/" + homeId)).body.lists.find(list => list.id === source.id).has_not_found_copy, false);
    const next = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "New preserved" });
    assert.equal(next.status, 200);
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: next.body.carry.id })).status, 200);
    assert.ok(await prisma.list.findUnique({ where: { id: next.body.list.id } }));
  });
  it("undo refuses to erase later purchases and rolls back all deltas", async () => {
    const { source } = await fixture();
    const result = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Already bought" });
    const row = result.body.list.itemsList[0];
    await prisma.itemList.update({ where: { id: row.id }, data: { purchased_quantity: row.quantity, status: "FOUND", check_take: true } });
    const beforeRows = await prisma.itemList.findMany({ where: { list_id: result.body.list.id }, orderBy: { id: "asc" } });
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: result.body.carry.id })).status, 409);
    assert.deepEqual(await prisma.itemList.findMany({ where: { list_id: result.body.list.id }, orderBy: { id: "asc" } }), beforeRows);
    assert.equal((await prisma.shoppingCarry.findUnique({ where: { id: result.body.carry.id } })).undone_at, null);
  });
  it("retains partial purchases through the existing update endpoint", async () => {
    const { source } = await fixture();
    const row = source.itemsList.find(row => row.purchased_quantity === 1 && row.status === "NOT_FOUND");
    const update = await request("/list/update-itemlist/" + row.id, "POST", { status: "NOT_FOUND" });
    assert.equal(update.status, 200); assert.equal(update.body.itemList.purchased_quantity, 1);
    assert.equal((await request("/list/update-itemlist/" + row.id, "POST", { purchased_quantity: 4 })).status, 400);
    assert.equal((await prisma.itemList.findUnique({ where: { id: row.id } })).purchased_quantity, 1);
  });
  it("adding a resolved product creates a pending row and preserves the resolved row", async () => {
    const { target, items } = await fixture();
    const old = target.itemsList.find(row => row.item_id === items[1].id);
    const add = await request("/list/add-item/" + target.id, "POST", { id_item: items[1].id, quantity: 2 });
    assert.equal(add.status, 200); assert.notEqual(add.body.itemList.id, old.id); assert.equal(add.body.itemList.status, "PENDING");
    assert.deepEqual(await prisma.itemList.findUnique({ where: { id: old.id } }), old);
  });
  it("keeps the legacy creation endpoint usable and idempotent", async () => {
    const { source } = await fixture();
    const first = await request("/list/create-from-not-found/" + source.id, "POST", { title: "Legacy API" });
    const second = await request("/list/create-from-not-found/" + source.id, "POST", { title: "Legacy API again" });
    assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(second.body.reused, true); assert.equal(first.body.list.id, second.body.list.id);
  });
  it("concurrent adds and retries keep one pending row, including add-to-import retries", async () => {
    const { source, items } = await fixture();
    const list = await prisma.list.create({ data: { title: "New additions", home_id: homeId } });
    const clientMutationId = randomUUID();
    const first = await Promise.all([1, 2].map(() => request("/list/add-item/" + list.id, "POST", { id_item: items[0].id, quantity: 2, clientMutationId })));
    first.forEach(result => assert.equal(result.status, 200));
    assert.equal(first[0].body.itemList.id, first[1].body.itemList.id);
    const row = first[0].body.itemList;
    await request("/list/update-itemlist/" + row.id, "POST", { purchased_quantity: 2, status: "FOUND", clientMutationId: randomUUID() });
    const retry = await request("/list/add-item/" + list.id, "POST", { id_item: items[0].id, quantity: 2, clientMutationId });
    assert.equal(retry.status, 200); assert.equal(retry.body.itemList.status, "FOUND");
    const importRetry = await request("/list/update-itemlist/" + row.id, "POST", { quantity_delta: 2, clientMutationId });
    assert.equal(importRetry.status, 200); assert.equal(importRetry.body.itemList.quantity, 2);
    assert.equal(await prisma.itemList.count({ where: { list_id: list.id } }), 1);
    const nextAdd = await request("/list/add-item/" + list.id, "POST", { id_item: items[0].id, quantity: 1, clientMutationId: randomUUID() });
    assert.notEqual(nextAdd.body.itemList.id, row.id);
    assert.equal((await prisma.itemList.findUnique({ where: { id: row.id } })).status, "FOUND");
  });
  it("atomic imported increments keep all concurrent units and deduplicate uncertain retries", async () => {
    const { target, items } = await fixture();
    const row = target.itemsList.find(row => row.item_id === items[0].id);
    const clientMutationId = randomUUID();
    const results = await Promise.all([1, 2].map(() => request("/list/update-itemlist/" + row.id, "POST", { quantity_delta: 2, clientMutationId })));
    results.forEach(result => assert.equal(result.status, 200));
    assert.equal((await prisma.itemList.findUnique({ where: { id: row.id } })).quantity, 6);
    const different = await Promise.all([1, 2].map(() => request("/list/update-itemlist/" + row.id, "POST", { quantity_delta: 3, clientMutationId: randomUUID() })));
    different.forEach(result => assert.equal(result.status, 200));
    const current = await prisma.itemList.findUnique({ where: { id: row.id } });
    assert.equal(current.quantity, 12); assert.equal(current.purchased_quantity, 1); assert.equal(current.status, "PENDING");
  });
  it("a delayed old undo cannot undo a new carry operation", async () => {
    const { source } = await fixture();
    const first = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "First" });
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: first.body.carry.id })).status, 200);
    const second = await request("/list/carry-missing/" + source.id, "POST", { mode: "new", title: "Second" });
    assert.notEqual(second.body.carry.id, first.body.carry.id);
    assert.equal((await request("/list/carry-missing/" + source.id + "/undo", "POST", { carry_id: first.body.carry.id })).status, 404);
    assert.equal((await prisma.shoppingCarry.findUnique({ where: { source_list_id: source.id } })).undone_at, null);
    assert.equal(await prisma.itemList.count({ where: { list_id: second.body.list.id } }), 2);
  });
  it("bulk missing-product import retains history and records retries across import modes", async () => {
    const { source, items } = await fixture();
    const clientMutationId = randomUUID();
    const payload = { hogar_id: homeId, list_id: source.id, include_images: false, items: [{ name: items[0].name, quantity: 2, clientMutationId }] };
    const first = await request("/item/create-missing-list-products", "POST", payload);
    assert.equal(first.status, 200);
    const pending = await prisma.itemList.findFirst({ where: { list_id: source.id, item_id: items[0].id, status: "PENDING" } });
    assert.equal(pending.quantity, 2);
    assert.equal((await request("/item/create-missing-list-products", "POST", payload)).status, 200);
    assert.equal((await request("/list/update-itemlist/" + pending.id, "POST", { quantity_delta: 2, clientMutationId })).body.itemList.quantity, 2);
    assert.deepEqual(await prisma.itemList.findMany({ where: { id: { in: source.itemsList.map(row => row.id) } }, orderBy: { id: "asc" } }), source.itemsList);
  });
  it("simultaneous missing-product imports create one catalog item and one pending row", async () => {
    const list = await prisma.list.create({ data: { title: "Imported new", home_id: homeId } });
    const name = "New QA product " + randomUUID();
    const payload = { hogar_id: homeId, list_id: list.id, include_images: false, items: [{ name, quantity: 2, clientMutationId: randomUUID() }] };
    const results = await Promise.all([1, 2].map(() => request("/item/create-missing-list-products", "POST", payload)));
    results.forEach(result => assert.equal(result.status, 200));
    assert.equal(await prisma.item.count({ where: { home_id: homeId, name } }), 1);
    const rows = await prisma.itemList.findMany({ where: { list_id: list.id } });
    assert.equal(rows.length, 1); assert.equal(rows[0].quantity, 2);
  });

});
