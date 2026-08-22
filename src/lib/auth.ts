import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import prisma from '@/lib/prisma'

// better-auth silently falls back to a well-known default secret when this is
// unset, which would leave session cookies signed with a publicly known key.
// Refuse to boot in production rather than serve forgeable sessions. The build
// itself only imports this module for route collection, so it is exempt.
const secret = process.env.BETTER_AUTH_SECRET

if (!secret &&
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build') {
  throw new Error(
    'BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` ' +
    'and set it in the deployment environment.'
  )
}

export const auth = betterAuth({
  secret,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirectURI: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/api/auth/callback/google`,
    }
  },

  // Ensure proper URL configuration
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  basePath: '/api/auth',
})