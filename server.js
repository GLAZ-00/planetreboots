"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = path.join(__dirname, "data.json");
const STOP_WORDS = [
  "дурак",
  "дурака",
  "идиот",
  "тупой",
  "тупая",
  "дебил",
  "мразь",
  "убей",
  "ненавижу",
  "отстой"
];

const app = express();
const server = http.createServer(app);
const peerServer = ExpressPeerServer(server, { path: "/", proxied: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use("/peerjs", peerServer);

function emptyDb() {
  return { posts: [], groups: [], messages: [], ideas: [], gifts: [], presence: {} };
}

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Object.assign(emptyDb(), parsed);
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
  const lower = text.toLowerCase();
  return STOP_WORDS.some((word) => lower.includes(word));
}

function average(reviews) {
  if (!reviews.length) return 0;
  const sum = reviews.reduce((total, review) => total + review.score, 0);
  return sum / reviews.length;
}

function publicState() {
  const now = Date.now();
  const people = Object.keys(db.presence)
    .map((id) => db.presence[id])
    .filter((person) => now - person.seen < 40000);
  const raised = db.gifts.reduce((total, gift) => total + gift.amount, 0);
  return {
    posts: db.posts,
    groups: db.groups,
    messages: db.messages,
    ideas: db.ideas,
    gifts: db.gifts,
    people: people,
    fund: raised
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/state", (req, res) => {
  res.json(publicState());
});

app.post("/api/presence", (req, res) => {
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

app.post("/api/posts", (req, res) => {
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  const sphere = clean(req.body.sphere, 40);
  const authorName = clean(req.body.authorName, 80);
  if (!title || !body || !authorName) {
    res.status(400).json({ error: "Нужны заголовок, текст и имя." });
    return;
  }
  if (!["nature", "politics", "economy"].includes(sphere)) {
    res.status(400).json({ error: "Неизвестная сфера." });
    return;
  }
  db.posts.unshift({
    id: uid(),
    title: title,
    body: body,
    sphere: sphere,
    authorName: authorName,
    at: Date.now()
  });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/groups", (req, res) => {
  const name = clean(req.body.name, 80);
  const authorName = clean(req.body.authorName, 80);
  if (!name || !authorName) {
    res.status(400).json({ error: "Нужно название группы." });
    return;
  }
  db.groups.unshift({
    id: uid(),
    name: name,
    closed: Boolean(req.body.closed),
    authorName: authorName,
    at: Date.now()
  });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/messages", (req, res) => {
  const fromId = clean(req.body.fromId, 80);
  const fromName = clean(req.body.fromName, 80);
  const toId = clean(req.body.toId, 80);
  const text = clean(req.body.text, 1000);
  if (!fromId || !fromName || !toId || !text) {
    res.status(400).json({ error: "Сообщение неполное." });
    return;
  }
  if (hasAbuse(text)) {
    res.status(400).json({ error: "Сообщение не отправлено: в нём оскорбление." });
    return;
  }
  db.messages.push({ id: uid(), fromId: fromId, fromName: fromName, toId: toId, text: text, at: Date.now() });
  saveDb();
  res.json({ ok: true });
});

app.post("/api/gifts", (req, res) => {
  const authorName = clean(req.body.authorName, 80);
  const note = clean(req.body.note, 160);
  const amount = Number(req.body.amount);
  if (!authorName || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    res.status(400).json({ error: "Сумма должна быть больше нуля." });
    return;
  }
  db.gifts.unshift({ id: uid(), authorName: authorName, note: note, amount: Math.round(amount * 100) / 100, at: Date.now() });
  saveDb();
  res.json({ ok: true, fund: db.gifts.reduce((total, gift) => total + gift.amount, 0) });
});

app.post("/api/ideas", (req, res) => {
  const authorId = clean(req.body.authorId, 80);
  const authorName = clean(req.body.authorName, 80);
  const title = clean(req.body.title, 160);
  const body = clean(req.body.body, 4000);
  if (!authorId || !authorName || !title || !body) {
    res.status(400).json({ error: "Идея неполная." });
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

app.post("/api/ideas/:id/review", (req, res) => {
  const idea = db.ideas.find((item) => item.id === req.params.id);
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
  if (idea.reviews.some((review) => review.authorId === authorId)) {
    res.status(400).json({ error: "Вы уже оставили рецензию на эту версию." });
    return;
  }
  idea.reviews.push({ authorId: authorId, authorName: authorName, score: score, text: text, at: Date.now() });
  const avg = average(idea.reviews);
  if (idea.reviews.length >= 1 && avg < 3) {
    idea.level = "lab";
  } else if (idea.reviews.length >= 2 && avg >= 6) {
    idea.level = 2;
  }
  saveDb();
  res.json({ ok: true, level: idea.level });
});

app.post("/api/ideas/:id/revise", (req, res) => {
  const idea = db.ideas.find((item) => item.id === req.params.id);
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

app.post("/api/ideas/:id/rescue", (req, res) => {
  const idea = db.ideas.find((item) => item.id === req.params.id);
  const profession = clean(req.body.profession, 80);
  if (!idea || idea.level !== "lab") {
    res.status(404).json({ error: "Идея не в лаборатории." });
    return;
  }
  if (!profession) {
    res.status(400).json({ error: "Чтобы перепроверить идею, укажите профессию в профиле. Документы здесь не проверяются." });
    return;
  }
  idea.history.push({ version: idea.version, title: idea.title, body: idea.body, reviews: idea.reviews, at: Date.now() });
  idea.level = 2;
  idea.rescued = true;
  idea.reviews = [];
  saveDb();
  res.json({ ok: true });
});

app.post("/api/ideas/:id/steps", (req, res) => {
  const idea = db.ideas.find((item) => item.id === req.params.id);
  const steps = Array.isArray(req.body.steps) ? req.body.steps.map((step) => clean(step, 400)).filter(Boolean) : [];
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

server.listen(PORT, () => {
  console.log("Planet Reboot listening on " + PORT);
});
