"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = path.join(__dirname, "data.json");
const STOP_WORDS = ["дурак", "дурака", "идиот", "тупой", "тупая", "дебил", "мразь", "убей", "ненавижу", "отстой"];

const app = express();
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, { path: "/", proxied: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/peerjs", peerServer);

function emptyDb() {
  return { posts: [], groups: [], messages: [], ideas: [], gifts: [], presence: {} };
}

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const db = emptyDb();
    ["posts", "groups", "messages", "ideas", "gifts"].forEach(function (key) {
      if (Array.isArray(parsed[key])) db[key] = parsed[key];
    });
    if (parsed.presence && typeof parsed.presence === "object") db.presence = parsed.presence;
    return db;
  } catch (error) {
    return emptyDb();
  }
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db));
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function hasAbuse(text) {
  const lower = String(text || "").toLowerCase();
  return STOP_WORDS.some(function (word) { return lower.indexOf(word) >= 0; });
}

function average(reviews) {
  if (!reviews.length) return 0;
  return reviews.reduce(function (total, review) { return total + review.score; }, 0) / reviews.length;
}

function publicState() {
  const now = Date.now();
  const people = Object.keys(db.presence).map(function (id) {
    return db.presence[id];
  }).filter(function (person) {
    return person && now - person.seen < 40000;
  });
  const fund = db.gifts.reduce(function (total, gift) {
    return total + Number(gift.amount || 0);
  }, 0);
  return {
    posts: db.posts,
    groups: db.groups,
    messages: db.messages,
    ideas: db.ideas,
    gifts: db.gifts,
    people: people,
    fund: fund
  };
}

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/state", function (req, res) {
  res.json(publicState());
});

app.post("/api/presence", function (req, res) {
  const id = clean(req.body.id, 80);
  const name = clean(req.body.name, 80);
  const profession = clean(req.body.profession, 80);
  const peerId = clean(req.body.peerId, 80);
  if (!id || !name || !peerId) {
    res.status(400).json({ error: "Не хватает имени или соединения." });
    return;
  }
  db.presence[id] = { id: id, name: name, profession: profession, peerId: peerId, seen: Date.now() };
  saveDb();
  res.json({ ok: true });
});

app.post("/api/posts", function (req, res) {
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  const sphere = clean(req.body.sphere, 40);
  const authorName = clean(req.body.authorName, 80);
  if (!title || !body || !authorName) {
    res.status(400).json({ error: "Нужны заголовок, текст и имя." });
    return;
  }
  if (["nature", "politics", "economy"].indexOf(sphere) < 0) {
    res.status(400).json({ error: "Неизвестная сфера." });
    return;
  }
  if (hasAbuse(title + " " + body)) {
    res.status(400).json({ error: "Текст не принят: в нём оскорбление." });
    return;
  }
  db.posts.unshift({ id: uid(), title: title, body: body, sphere: sphere, authorName: authorName, at: Date.now() });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/groups", function (req, res) {
  const name = clean(req.body.name, 80);
  const authorName = clean(req.body.authorName, 80);
  const authorId = clean(req.body.authorId, 80);
  if (!name || !authorName) {
    res.status(400).json({ error: "Нужно название группы." });
    return;
  }
  db.groups.unshift({
    id: uid(),
    name: name,
    closed: Boolean(req.body.closed),
    authorName: authorName,
    authorId: authorId,
    at: Date.now()
  });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/messages", function (req, res) {
  const fromId = clean(req.body.fromId, 80);
  const fromName = clean(req.body.fromName, 80);
  const toId = clean(req.body.toId, 80);
  const toName = clean(req.body.toName, 80);
  const kind = req.body.kind === "group" ? "group" : "dm";
  const text = clean(req.body.text, 4000);
  if (!fromId || !fromName || !toId || !text) {
    res.status(400).json({ error: "Сообщение неполное." });
    return;
  }
  if (hasAbuse(text)) {
    res.status(400).json({ error: "Сообщение не отправлено: в нём оскорбление." });
    return;
  }
  if (kind === "group" && !db.groups.some(function (group) { return group.id === toId; })) {
    res.status(404).json({ error: "Такой группы нет." });
    return;
  }
  db.messages.push({
    id: uid(),
    kind: kind,
    fromId: fromId,
    fromName: fromName,
    toId: toId,
    toName: toName,
    text: text,
    at: Date.now()
  });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/gifts", function (req, res) {
  const authorName = clean(req.body.authorName, 80);
  const note = clean(req.body.note, 160);
  const amount = Number(req.body.amount);
  if (!authorName || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    res.status(400).json({ error: "Сумма должна быть больше нуля." });
    return;
  }
  db.gifts.unshift({ id: uid(), authorName: authorName, note: note, amount: Math.round(amount * 100) / 100, at: Date.now() });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/ideas", function (req, res) {
  const authorId = clean(req.body.authorId, 80);
  const authorName = clean(req.body.authorName, 80);
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  if (!authorId || !authorName || !title || !body) {
    res.status(400).json({ error: "Идея неполная." });
    return;
  }
  if (hasAbuse(title + " " + body)) {
    res.status(400).json({ error: "Идея не принята: в ней оскорбление." });
    return;
  }
  const now = Date.now();
  db.ideas.unshift({
    id: uid(),
    authorId: authorId,
    authorName: authorName,
    title: title,
    body: body,
    level: 1,
    version: 1,
    badge: false,
    history: [{ version: 1, title: title, body: body, at: now }],
    reviews: [],
    steps: [],
    at: now
  });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/ideas/:id/review", function (req, res) {
  const idea = db.ideas.find(function (item) { return item.id === req.params.id; });
  if (!idea || idea.level !== 1) {
    res.status(404).json({ error: "Эту идею сейчас нельзя оценивать." });
    return;
  }
  const authorId = clean(req.body.authorId, 80);
  const authorName = clean(req.body.authorName, 80);
  const text = clean(req.body.text, 150);
  const score = Number(req.body.score);
  if (!authorId || !authorName) {
    res.status(400).json({ error: "Сначала откройте профиль." });
    return;
  }
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    res.status(400).json({ error: "Оценка от 1 до 10." });
    return;
  }
  if (text.length < 50 || text.length > 150) {
    res.status(400).json({ error: "Рецензия должна быть от 50 до 150 символов." });
    return;
  }
  if (hasAbuse(text)) {
    res.status(400).json({ error: "Рецензия не принята: в ней оскорбление или пустая агрессия. Напишите по делу." });
    return;
  }
  if (idea.reviews.some(function (review) { return review.authorId === authorId; })) {
    res.status(400).json({ error: "Вы уже оставили рецензию на эту версию." });
    return;
  }
  idea.reviews.push({ authorId: authorId, authorName: authorName, score: score, text: text, at: Date.now() });
  const avg = average(idea.reviews);
  if (avg < 3) idea.level = "lab";
  else if (idea.reviews.length >= 2 && avg >= 6) idea.level = 2;
  saveDb();
  res.json({ ok: true, level: idea.level });
});

app.post("/api/ideas/:id/revise", function (req, res) {
  const idea = db.ideas.find(function (item) { return item.id === req.params.id; });
  const authorId = clean(req.body.authorId, 80);
  if (!idea || idea.authorId !== authorId || idea.level !== "lab") {
    res.status(404).json({ error: "Эту идею нельзя вернуть." });
    return;
  }
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  if (!title || !body) {
    res.status(400).json({ error: "Нужны заголовок и текст." });
    return;
  }
  idea.history.push({ version: idea.version, title: idea.title, body: idea.body, reviews: idea.reviews, at: Date.now() });
  idea.version += 1;
  idea.title = title;
  idea.body = body;
  idea.level = 1;
  idea.badge = true;
  idea.reviews = [];
  saveDb();
  res.json({ ok: true });
});

app.post("/api/ideas/:id/rescue", function (req, res) {
  const idea = db.ideas.find(function (item) { return item.id === req.params.id; });
  const profession = clean(req.body.profession, 80);
  if (!idea || idea.level !== "lab") {
    res.status(404).json({ error: "Идея не в лаборатории." });
    return;
  }
  if (!profession) {
    res.status(400).json({ error: "Чтобы перепроверить идею, укажите профессию в профиле." });
    return;
  }
  idea.history.push({ version: idea.version, title: idea.title, body: idea.body, reviews: idea.reviews, at: Date.now() });
  idea.level = 2;
  idea.rescued = true;
  idea.reviews = [];
  saveDb();
  res.json({ ok: true });
});

app.post("/api/ideas/:id/steps", function (req, res) {
  const idea = db.ideas.find(function (item) { return item.id === req.params.id; });
  const steps = Array.isArray(req.body.steps) ? req.body.steps.map(function (step) { return clean(step, 400); }).filter(Boolean) : [];
  if (!idea || idea.level !== 2) {
    res.status(404).json({ error: "Алгоритм фиксируется только у идеи второго уровня." });
    return;
  }
  if (steps.length < 2) {
    res.status(400).json({ error: "Нужны хотя бы два шага." });
    return;
  }
  idea.steps = steps;
  idea.level = 3;
  saveDb();
  res.json({ ok: true });
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("Planet Reboot listening on " + PORT);
});
