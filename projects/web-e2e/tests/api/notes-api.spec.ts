import { test as base, expect } from '@playwright/test';
import { registerUser, loginUser, deleteAccount, type RegisteredUser } from '../support/notes-api';

type NotesApiFixtures = {
  authedUser: RegisteredUser & { token: string };
};

const test = base.extend<NotesApiFixtures>({
  authedUser: async ({ request }, use) => {
    const user = await registerUser(request);
    const login = await loginUser(request, user.email, user.password);
    await use({ ...user, token: login.token });
    // Fresh token: the test may have logged the original one out.
    const relogin = await loginUser(request, user.email, user.password);
    await deleteAccount(request, relogin.token);
  },
});

test.describe('Notes API', { tag: '@api' }, () => {
  test('health-check reports the service is running', { tag: '@smoke' }, async ({ request }) => {
    const response = await request.get('/notes/api/health-check');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, status: 200, message: 'Notes API is Running' });
  });

  test('authorizes with a login token and invalidates it on logout', async ({ authedUser, request }) => {
    const headers = { 'x-auth-token': authedUser.token };

    await test.step('a valid token authorizes profile access', async () => {
      const profile = await request.get('/notes/api/users/profile', { headers });
      expect(profile.status()).toBe(200);
      expect((await profile.json()).data).toMatchObject({ email: authedUser.email, name: authedUser.name });
    });

    await test.step('logging out invalidates the token', async () => {
      const logout = await request.delete('/notes/api/users/logout', { headers });
      expect(logout.status()).toBe(200);

      const profileAfterLogout = await request.get('/notes/api/users/profile', { headers });
      expect(profileAfterLogout.status()).toBe(401);
    });
  });

  test('rejects registering the same email twice with 409', async ({ authedUser, request }) => {
    const duplicate = await request.post('/notes/api/users/register', {
      form: { name: authedUser.name, email: authedUser.email, password: authedUser.password },
    });
    expect(duplicate.status()).toBe(409);
    const body = await duplicate.json();
    expect(body.message).toBe('An account already exists with the same email address');
  });

  test('rejects profile access with no token or an invalid token', async ({ request }) => {
    const noToken = await request.get('/notes/api/users/profile');
    expect(noToken.status()).toBe(401);
    expect((await noToken.json()).message).toBe('No authentication token specified in x-auth-token header');

    const badToken = await request.get('/notes/api/users/profile', {
      headers: { 'x-auth-token': 'not-a-real-token' },
    });
    expect(badToken.status()).toBe(401);
    expect((await badToken.json()).message).toBe(
      'Access token is not valid or has expired, you will need to login',
    );
  });

  test('creates, reads, updates and deletes a note', async ({ authedUser, request }) => {
    const headers = { 'x-auth-token': authedUser.token };

    const noteId = await test.step('create a note', async () => {
      const created = await request.post('/notes/api/notes', {
        headers,
        form: { title: 'Showcase note', description: 'Created by the showcase suite', category: 'Work' },
      });
      expect(created.status()).toBe(200);
      const createdBody = await created.json();
      expect(createdBody.data).toMatchObject({
        title: 'Showcase note',
        description: 'Created by the showcase suite',
        category: 'Work',
        completed: false,
      });
      return createdBody.data.id as string;
    });

    await test.step('read the note back', async () => {
      const fetched = await request.get(`/notes/api/notes/${noteId}`, { headers });
      expect(fetched.status()).toBe(200);
      expect((await fetched.json()).data).toMatchObject({ id: noteId, title: 'Showcase note' });
    });

    await test.step('update the note to completed', async () => {
      const patched = await request.patch(`/notes/api/notes/${noteId}`, {
        headers,
        form: { completed: true },
      });
      expect(patched.status()).toBe(200);
      expect((await patched.json()).data).toMatchObject({ completed: true });
    });

    await test.step('delete the note and confirm it is gone', async () => {
      const deleted = await request.delete(`/notes/api/notes/${noteId}`, { headers });
      expect(deleted.status()).toBe(200);

      const afterDelete = await request.get(`/notes/api/notes/${noteId}`, { headers });
      expect(afterDelete.status()).toBe(404);
    });
  });

  test('rejects a note with a category outside the enumerated set', async ({ authedUser, request }) => {
    const response = await request.post('/notes/api/notes', {
      headers: { 'x-auth-token': authedUser.token },
      form: { title: 'Invalid category note', description: 'Should fail validation', category: 'Invalid' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toBe('Category must be one of the categories: Home, Work, Personal');
  });
});
