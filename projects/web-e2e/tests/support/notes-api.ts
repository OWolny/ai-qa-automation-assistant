import type { APIRequestContext } from '@playwright/test';

const NOTES_API = '/notes/api';

export interface NotesApiEnvelope<T> {
  success: boolean;
  status: number;
  message: string;
  data?: T;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginResult {
  id: string;
  name: string;
  email: string;
  token: string;
}

export interface Note {
  id: string;
  title: string;
  description: string;
  category: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
  user_id: string;
}

function uniqueEmail(): string {
  return `pw-showcase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function registerUser(
  request: APIRequestContext,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<RegisteredUser> {
  const name = overrides.name ?? 'PW Showcase';
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'SuperSecret123!';

  const response = await request.post(`${NOTES_API}/users/register`, {
    form: { name, email, password },
  });
  const body = (await response.json()) as NotesApiEnvelope<{ id: string; name: string; email: string }>;
  if (!response.ok() || !body.data) {
    throw new Error(`Failed to register user ${email}: ${response.status()} ${body.message}`);
  }
  return { id: body.data.id, name: body.data.name, email: body.data.email, password };
}

export async function loginUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<LoginResult> {
  const response = await request.post(`${NOTES_API}/users/login`, {
    form: { email, password },
  });
  const body = (await response.json()) as NotesApiEnvelope<LoginResult>;
  if (!response.ok() || !body.data) {
    throw new Error(`Failed to log in as ${email}: ${response.status()} ${body.message}`);
  }
  return body.data;
}

export async function createNote(
  request: APIRequestContext,
  token: string,
  note: { title: string; description: string; category: string },
): Promise<Note> {
  const response = await request.post(`${NOTES_API}/notes`, {
    headers: { 'x-auth-token': token },
    form: note,
  });
  const body = (await response.json()) as NotesApiEnvelope<Note>;
  if (!response.ok() || !body.data) {
    throw new Error(`Failed to create note "${note.title}": ${response.status()} ${body.message}`);
  }
  return body.data;
}

export async function deleteAccount(request: APIRequestContext, token: string): Promise<void> {
  const response = await request.delete(`${NOTES_API}/users/delete-account`, {
    headers: { 'x-auth-token': token },
  });
  if (!response.ok()) {
    throw new Error(`Failed to delete account: ${response.status()}`);
  }
}
