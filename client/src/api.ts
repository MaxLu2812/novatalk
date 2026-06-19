import type { Bootstrap, Conversation, Message } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export async function register(payload: {
  displayName: string;
  username: string;
  password: string;
}) {
  return request<{ token: string; bootstrap: Bootstrap }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function login(payload: { username: string; password: string }) {
  return request<{ token: string; bootstrap: Bootstrap }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchBootstrap(token: string) {
  return request<Bootstrap>("/api/bootstrap", {}, token);
}

export async function saveProfile(
  token: string,
  payload: { displayName: string; bio: string },
) {
  return request<Bootstrap>(
    "/api/me",
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function uploadMyAvatar(token: string, file: File) {
  const form = new FormData();
  form.append("avatar", file);
  return request<Bootstrap>("/api/me/avatar", { method: "POST", body: form }, token);
}

export async function sendFriendRequest(token: string, username: string) {
  return request<Bootstrap>(
    "/api/friends/request",
    {
      method: "POST",
      body: JSON.stringify({ username }),
    },
    token,
  );
}

export async function acceptRequest(token: string, requestId: string) {
  return request<Bootstrap>(`/api/friends/requests/${requestId}/accept`, { method: "POST" }, token);
}

export async function rejectRequest(token: string, requestId: string) {
  return request<Bootstrap>(`/api/friends/requests/${requestId}/reject`, { method: "POST" }, token);
}

export async function createGroup(token: string, payload: { title: string; memberIds: string[] }) {
  return request<Conversation>(
    "/api/conversations/group",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function uploadConversationAvatar(token: string, conversationId: string, file: File) {
  const form = new FormData();
  form.append("avatar", file);
  return request<Conversation>(
    `/api/conversations/${conversationId}/avatar`,
    { method: "POST", body: form },
    token,
  );
}

export async function fetchMessages(token: string, conversationId: string) {
  return request<Message[]>(`/api/conversations/${conversationId}/messages`, {}, token);
}

export async function sendMessage(
  token: string,
  conversationId: string,
  payload: { text?: string; type?: string; file?: File | Blob; fileName?: string },
) {
  const form = new FormData();
  if (payload.text) form.append("text", payload.text);
  if (payload.type) form.append("type", payload.type);
  if (payload.file) {
    form.append("file", payload.file, payload.fileName ?? (payload.file instanceof File ? payload.file.name : "voice.webm"));
  }
  return request<Message>(`/api/conversations/${conversationId}/messages`, { method: "POST", body: form }, token);
}

