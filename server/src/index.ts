import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarPath: string | null;
  createdAt: string;
};

type AuthedRequest = Request & {
  user: UserRecord;
  token: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads");
const avatarDir = path.join(uploadDir, "avatars");
const attachmentDir = path.join(uploadDir, "attachments");
const dbPath = path.join(dataDir, "messenger.db");

[dataDir, uploadDir, avatarDir, attachmentDir].forEach((directory) => {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
  },
});
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON;");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT,
      avatar_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(to_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_low_id TEXT NOT NULL,
      user_high_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_low_id, user_high_id),
      FOREIGN KEY(user_low_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user_high_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT,
      avatar_path TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT,
      file_path TEXT,
      file_name TEXT,
      mime_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function publicAssetUrl(assetPath: string | null) {
  if (!assetPath) return null;
  return `http://localhost:${PORT}${assetPath}`;
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    bio: row.bio ? String(row.bio) : null,
    avatarPath: row.avatar_path ? String(row.avatar_path) : null,
    createdAt: String(row.created_at),
  };
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, digest] = storedHash.split(":");
  const supplied = scryptSync(password, salt, 64);
  const existing = Buffer.from(digest, "hex");
  return timingSafeEqual(supplied, existing);
}

function createSession(userId: string) {
  const token = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

function getUserByToken(token: string | null) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as Record<string, unknown> | undefined;
  return row ? mapUser(row) : null;
}

function getAuthToken(req: Request) {
  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.header("x-auth-token") ?? null;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getAuthToken(req);
  const user = getUserByToken(token);
  if (!token || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const authed = req as AuthedRequest;
  authed.user = user;
  authed.token = token;
  next();
}

function getConversationMembers(conversationId: string) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_path
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ?
       ORDER BY u.display_name ASC`,
    )
    .all(conversationId)
    .map((row) => {
      const typed = row as Record<string, unknown>;
      return {
        id: String(typed.id),
        username: String(typed.username),
        displayName: String(typed.display_name),
        bio: typed.bio ? String(typed.bio) : null,
        avatarUrl: publicAssetUrl(typed.avatar_path ? String(typed.avatar_path) : null),
      };
    });
}

function getConversationSummary(conversationId: string, viewerId: string) {
  const row = db
    .prepare(
      `SELECT c.*,
        (
          SELECT m.text
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_text,
        (
          SELECT m.type
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_type,
        (
          SELECT m.created_at
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_created_at
       FROM conversations c
       WHERE c.id = ?`,
    )
    .get(conversationId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const members = getConversationMembers(conversationId);
  const kind = String(row.kind);
  const otherMember = kind === "direct" ? members.find((member) => member.id !== viewerId) : null;

  return {
    id: String(row.id),
    kind,
    title: kind === "direct" ? otherMember?.displayName ?? "Direct Message" : String(row.title ?? "New Group"),
    subtitle: kind === "direct" ? `@${otherMember?.username ?? "unknown"}` : `${members.length} members`,
    avatarUrl:
      kind === "direct"
        ? otherMember?.avatarUrl ?? null
        : publicAssetUrl(row.avatar_path ? String(row.avatar_path) : null),
    memberCount: members.length,
    members,
    lastMessagePreview: row.last_text
      ? String(row.last_text)
      : row.last_type
        ? `[${String(row.last_type)}]`
        : "No messages yet",
    updatedAt: String(row.last_created_at ?? row.updated_at),
  };
}

function getConversationForUser(conversationId: string, userId: string) {
  const exists = db
    .prepare(
      `SELECT 1
       FROM conversation_members
       WHERE conversation_id = ? AND user_id = ?`,
    )
    .get(conversationId, userId);
  if (!exists) return null;
  return getConversationSummary(conversationId, userId);
}

function listConversations(userId: string) {
  const rows = db
    .prepare(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.updated_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows
    .map((row) => getConversationSummary(String(row.id), userId))
    .filter((conversation): conversation is NonNullable<ReturnType<typeof getConversationSummary>> => Boolean(conversation));
}

function getFriendships(userId: string) {
  const rows = db
    .prepare(
      `SELECT u.*
       FROM friendships f
       JOIN users u
         ON u.id = CASE
           WHEN f.user_low_id = ? THEN f.user_high_id
           ELSE f.user_low_id
         END
       WHERE f.user_low_id = ? OR f.user_high_id = ?
       ORDER BY u.display_name ASC`,
    )
    .all(userId, userId, userId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const user = mapUser(row);
    return {
      ...user,
      avatarUrl: publicAssetUrl(user.avatarPath),
    };
  });
}

function listRequests(userId: string, direction: "incoming" | "outgoing") {
  const isIncoming = direction === "incoming";
  const rows = db
    .prepare(
      `SELECT fr.id AS request_id, fr.created_at AS request_created_at, u.*
       FROM friend_requests fr
       JOIN users u ON u.id = ${isIncoming ? "fr.from_user_id" : "fr.to_user_id"}
       WHERE ${isIncoming ? "fr.to_user_id" : "fr.from_user_id"} = ?
         AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const user = mapUser(row);
    return {
      id: String(row.request_id),
      createdAt: String(row.request_created_at),
      user: {
        ...user,
        avatarUrl: publicAssetUrl(user.avatarPath),
      },
    };
  });
}

function ensureDirectConversation(userA: string, userB: string) {
  const existing = db
    .prepare(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
       JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
       WHERE c.kind = 'direct'`,
    )
    .get(userA, userB) as Record<string, unknown> | undefined;

  if (existing) {
    return String(existing.id);
  }

  const conversationId = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, kind, created_by) VALUES (?, 'direct', ?)`,
  ).run(conversationId, userA);
  db.prepare(
    `INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?), (?, ?, ?)`,
  ).run(randomUUID(), conversationId, userA, randomUUID(), conversationId, userB);
  return conversationId;
}

function getMessages(conversationId: string) {
  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.display_name, u.avatar_path
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
    )
    .all(conversationId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    text: row.text ? String(row.text) : "",
    fileUrl: row.file_path ? publicAssetUrl(String(row.file_path)) : null,
    fileName: row.file_name ? String(row.file_name) : null,
    mimeType: row.mime_type ? String(row.mime_type) : null,
    createdAt: String(row.created_at),
    sender: {
      id: String(row.sender_id),
      username: String(row.username),
      displayName: String(row.display_name),
      avatarUrl: publicAssetUrl(row.avatar_path ? String(row.avatar_path) : null),
    },
  }));
}

function buildBootstrap(userId: string) {
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
  const user = mapUser(userRow);

  return {
    currentUser: {
      ...user,
      avatarUrl: publicAssetUrl(user.avatarPath),
    },
    friends: getFriendships(userId),
    incomingRequests: listRequests(userId, "incoming"),
    outgoingRequests: listRequests(userId, "outgoing"),
    conversations: listConversations(userId),
  };
}

function touchConversation(conversationId: string) {
  db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversationId);
}

function getParamId(req: Request) {
  return Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, attachmentDir);
  },
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${randomUUID()}-${file.originalname}`);
  },
});

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, avatarDir);
  },
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${randomUUID()}-${file.originalname}`);
  },
});

const uploadAttachment = multer({ storage });
const uploadAvatar = multer({ storage: avatarStorage });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(uploadDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  const displayName = String(req.body.displayName ?? "").trim();
  const username = String(req.body.username ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");

  if (!displayName || !username || !password) {
    res.status(400).json({ error: "Display name, username, and password are required." });
    return;
  }

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: "Username must be 3-24 chars: lowercase letters, digits, underscore." });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    res.status(409).json({ error: "This username is already taken." });
    return;
  }

  const userId = randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, username, displayName, hashPassword(password));

  const token = createSession(userId);
  res.json({
    token,
    bootstrap: buildBootstrap(userId),
  });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as Record<string, unknown> | undefined;

  if (!row || !verifyPassword(password, String(row.password_hash))) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const token = createSession(String(row.id));
  res.json({
    token,
    bootstrap: buildBootstrap(String(row.id)),
  });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  res.json(buildBootstrap(authed.user.id));
});

app.patch("/api/me", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const displayName = String(req.body.displayName ?? authed.user.displayName).trim();
  const bio = String(req.body.bio ?? "").trim();

  db.prepare("UPDATE users SET display_name = ?, bio = ? WHERE id = ?").run(displayName, bio, authed.user.id);
  res.json(buildBootstrap(authed.user.id));
});

app.post("/api/me/avatar", requireAuth, uploadAvatar.single("avatar"), (req, res) => {
  const authed = req as AuthedRequest;
  if (!req.file) {
    res.status(400).json({ error: "Avatar file is required." });
    return;
  }

  const avatarPath = `/uploads/avatars/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(avatarPath, authed.user.id);
  res.json(buildBootstrap(authed.user.id));
});

app.post("/api/friends/request", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const username = String(req.body.username ?? "").trim().toLowerCase();
  const target = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as Record<string, unknown> | undefined;

  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  if (String(target.id) === authed.user.id) {
    res.status(400).json({ error: "You cannot add yourself." });
    return;
  }

  const [low, high] = [authed.user.id, String(target.id)].sort();
  const friendship = db
    .prepare("SELECT id FROM friendships WHERE user_low_id = ? AND user_high_id = ?")
    .get(low, high);
  if (friendship) {
    res.status(409).json({ error: "You are already friends." });
    return;
  }

  const existing = db
    .prepare(
      `SELECT id FROM friend_requests
       WHERE status = 'pending'
         AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
    )
    .get(authed.user.id, String(target.id), String(target.id), authed.user.id);
  if (existing) {
    res.status(409).json({ error: "A request already exists between you two." });
    return;
  }

  db.prepare(
    `INSERT INTO friend_requests (id, from_user_id, to_user_id)
     VALUES (?, ?, ?)`,
  ).run(randomUUID(), authed.user.id, String(target.id));

  io.to(`user:${String(target.id)}`).emit("friends:updated");
  io.to(`user:${authed.user.id}`).emit("friends:updated");
  res.json(buildBootstrap(authed.user.id));
});

app.post("/api/friends/requests/:id/accept", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const requestId = getParamId(req);
  const requestRow = db
    .prepare(
      `SELECT * FROM friend_requests
       WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
    )
    .get(requestId, authed.user.id) as Record<string, unknown> | undefined;

  if (!requestRow) {
    res.status(404).json({ error: "Request not found." });
    return;
  }

  db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);
  const fromUserId = String(requestRow.from_user_id);
  const [low, high] = [fromUserId, authed.user.id].sort();
  db.prepare(
    `INSERT OR IGNORE INTO friendships (id, user_low_id, user_high_id)
     VALUES (?, ?, ?)`,
  ).run(randomUUID(), low, high);

  const conversationId = ensureDirectConversation(fromUserId, authed.user.id);
  io.to(`conversation:${conversationId}`).emit("conversation:updated");
  io.to(`user:${fromUserId}`).emit("friends:updated");
  io.to(`user:${authed.user.id}`).emit("friends:updated");
  res.json(buildBootstrap(authed.user.id));
});

app.post("/api/friends/requests/:id/reject", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const requestId = getParamId(req);
  db.prepare(
    `UPDATE friend_requests
     SET status = 'rejected'
     WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
  ).run(requestId, authed.user.id);
  res.json(buildBootstrap(authed.user.id));
});

app.post("/api/conversations/group", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const title = String(req.body.title ?? "").trim();
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(String) : [];
  const allMemberIds = Array.from(new Set([authed.user.id, ...memberIds]));

  if (!title) {
    res.status(400).json({ error: "Group name is required." });
    return;
  }

  const conversationId = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, kind, title, created_by)
     VALUES (?, 'group', ?, ?)`,
  ).run(conversationId, title, authed.user.id);

  const insertMember = db.prepare(
    `INSERT INTO conversation_members (id, conversation_id, user_id)
     VALUES (?, ?, ?)`,
  );

  for (const memberId of allMemberIds) {
    insertMember.run(randomUUID(), conversationId, memberId);
  }

  const summary = getConversationSummary(conversationId, authed.user.id);
  allMemberIds.forEach((memberId) => {
    io.to(`user:${memberId}`).emit("conversations:updated");
  });
  res.json(summary);
});

app.patch("/api/conversations/:id", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const conversationId = getParamId(req);
  const summary = getConversationForUser(conversationId, authed.user.id);
  if (!summary) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  const title = String(req.body.title ?? "").trim();
  db.prepare(
    `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(title, conversationId);
  io.to(`conversation:${conversationId}`).emit("conversation:updated");
  res.json(getConversationSummary(conversationId, authed.user.id));
});

app.post("/api/conversations/:id/avatar", requireAuth, uploadAvatar.single("avatar"), (req, res) => {
  const authed = req as AuthedRequest;
  const conversationId = getParamId(req);
  const summary = getConversationForUser(conversationId, authed.user.id);
  if (!summary) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "Avatar file is required." });
    return;
  }

  const avatarPath = `/uploads/avatars/${req.file.filename}`;
  db.prepare(
    `UPDATE conversations SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(avatarPath, conversationId);
  io.to(`conversation:${conversationId}`).emit("conversation:updated");
  res.json(getConversationSummary(conversationId, authed.user.id));
});

app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const conversationId = getParamId(req);
  const summary = getConversationForUser(conversationId, authed.user.id);
  if (!summary) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  res.json(getMessages(conversationId));
});

app.post("/api/conversations/:id/messages", requireAuth, uploadAttachment.single("file"), (req, res) => {
  const authed = req as AuthedRequest;
  const conversationId = getParamId(req);
  const summary = getConversationForUser(conversationId, authed.user.id);
  if (!summary) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  const text = String(req.body.text ?? "").trim();
  const inferredType = String(req.body.type ?? (req.file ? "file" : "text"));
  if (!text && !req.file) {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }

  const type =
    req.file && req.file.mimetype.startsWith("image/")
      ? inferredType === "voice"
        ? "voice"
        : "image"
      : inferredType;
  const messageId = randomUUID();
  const filePath = req.file ? `/uploads/attachments/${req.file.filename}` : null;

  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, sender_id, type, text, file_path, file_name, mime_type
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    conversationId,
    authed.user.id,
    type,
    text || null,
    filePath,
    req.file?.originalname ?? null,
    req.file?.mimetype ?? null,
  );
  touchConversation(conversationId);

  const message = getMessages(conversationId).find((entry) => entry.id === messageId);
  io.to(`conversation:${conversationId}`).emit("message:new", {
    conversationId,
    message,
  });
  io.to(`conversation:${conversationId}`).emit("conversation:updated");
  res.json(message);
});

io.use((socket, next) => {
  const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : null;
  const user = getUserByToken(token);
  if (!token || !user) {
    next(new Error("Unauthorized"));
    return;
  }

  socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.data.user as UserRecord;
  socket.join(`user:${user.id}`);
  listConversations(user.id).forEach((conversation) => {
    socket.join(`conversation:${conversation.id}`);
  });

  socket.on("conversations:sync", ({ conversationIds }) => {
    if (!Array.isArray(conversationIds)) return;
    conversationIds.forEach((conversationId) => {
      if (typeof conversationId === "string") {
        socket.join(`conversation:${conversationId}`);
      }
    });
  });

  socket.on("call:invite", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("call:invite", {
      conversationId,
      fromUserId: user.id,
      fromName: user.displayName,
    });
  });

  socket.on("call:invite-response", ({ conversationId, toUserId, accepted }) => {
    socket.to(`user:${toUserId}`).emit("call:invite-response", {
      conversationId,
      fromUserId: user.id,
      accepted,
    });
    if (accepted) {
      socket.to(`conversation:${conversationId}`).emit("call:participant-joined", {
        conversationId,
        userId: user.id,
        displayName: user.displayName,
      });
    }
  });

  socket.on("call:signal", ({ conversationId, toUserId, signal }) => {
    socket.to(`user:${toUserId}`).emit("call:signal", {
      conversationId,
      fromUserId: user.id,
      signal,
    });
  });

  socket.on("call:state", ({ conversationId, muted, cameraOff }) => {
    socket.to(`conversation:${conversationId}`).emit("call:state", {
      conversationId,
      fromUserId: user.id,
      muted,
      cameraOff,
    });
  });

  socket.on("call:end", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("call:end", {
      conversationId,
      fromUserId: user.id,
    });
  });

  socket.on("call:leave", ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit("call:leave", {
      conversationId,
      userId: user.id,
    });
  });
});

const PORT = Number(process.env.PORT ?? 3001);

initSchema();

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
