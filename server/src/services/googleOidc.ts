import { OAuth2Client } from 'google-auth-library';

export interface GoogleOidcPrincipal {
  subject: string;
  email?: string;
}

const oidcClient = new OAuth2Client();

export const verifyGoogleOidcToken = async (input: {
  idToken: string;
  audience: string;
  allowedServiceAccounts: string[];
}): Promise<GoogleOidcPrincipal> => {
  const ticket = await oidcClient.verifyIdToken({
    idToken: input.idToken,
    audience: input.audience,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub) {
    throw new Error('OIDC token is missing the subject claim.');
  }

  const issuer = payload.iss;
  if (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') {
    throw new Error('OIDC token issuer is invalid.');
  }

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
  const allowed = new Set(input.allowedServiceAccounts.map((entry) => entry.toLowerCase()));

  if (allowed.size > 0) {
    if (!email || payload.email_verified !== true || !allowed.has(email)) {
      throw new Error('OIDC token principal is not allowed.');
    }
  }

  return {
    subject: payload.sub,
    email,
  };
};
