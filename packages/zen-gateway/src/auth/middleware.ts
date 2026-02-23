import { verify, sign } from 'jsonwebtoken';
import { compare, hash } from 'bcryptjs';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export async function requireAuth(c: any): Promise<AuthUser | undefined> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return undefined;

  const token = authHeader.slice(7);
  try {
    const payload = verify(token, c.env.JWT_SECRET) as AuthUser & { exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }
    return { id: payload.id, email: payload.email, role: payload.role };
  } catch {
    return undefined;
  }
}

export async function requireAdmin(c: any): Promise<AuthUser | undefined> {
  const user = await requireAuth(c);
  if (!user || user.role !== 'admin') return undefined;
  return user;
}

export async function isFirstUser(env: any): Promise<boolean> {
  const result = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  return result.count === 0;
}

export function createToken(user: AuthUser, env: { JWT_SECRET: string }): string {
  return sign(
    { ...user, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
    env.JWT_SECRET
  );
}

export async function verifyAndGetUser(c: any): Promise<AuthUser | null> {
  const user = await requireAuth(c);
  if (!user) return null;
  return user;
}
