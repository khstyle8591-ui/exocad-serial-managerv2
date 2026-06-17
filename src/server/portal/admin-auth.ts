import basicAuth from 'express-basic-auth';
import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';

const isProduction = process.env.NODE_ENV === 'production';
const authDisabled = process.env.AUTH_DISABLED === 'true' && !isProduction;

export const portalAdminAuth: RequestHandler = authDisabled
  ? (_req, _res, next) => next()
  : basicAuth({
      challenge: true,
      authorizer(username: string, password: string) {
        const expectedUser = process.env.API_USER || '';
        const expectedHash = process.env.API_PASSWORD_HASH || '';
        if (!expectedUser || !expectedHash) return false;
        return (
          basicAuth.safeCompare(username, expectedUser) &&
          bcrypt.compareSync(password, expectedHash)
        );
      },
      unauthorizedResponse: () => ({ error: 'Authentication required' }),
    });
