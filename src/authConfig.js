// Auth settings for Microsoft Entra External ID (via MSAL).
//
// Every value comes from a VITE_* environment variable, set in a local
// `.env.local` file during development and in the build environment for
// deployment. Vite bakes these into the site when it is BUILT, so changing one
// means rebuilding and re-uploading. See `.env.example` for the full list.
// None of these values are secrets (there is no client secret in a browser app).

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
const tenantSubdomain = import.meta.env.VITE_AZURE_TENANT_SUBDOMAIN
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID
const apiScope = import.meta.env.VITE_API_SCOPE // e.g. api://<api-client-id>/Game.Play

// Where Microsoft sends people back to after sign-in / sign-out. It must match a
// redirect URI registered on the "Perfect Punch Web" app registration exactly.
const redirectUri = import.meta.env.VITE_REDIRECT_URI || window.location.origin

// If a required value is missing (for example a teammate has not made an
// .env.local yet) the app still runs, just without sign-in.
export const isAuthConfigured = Boolean(clientId && tenantSubdomain && tenantId)
export const isApiScopeConfigured = Boolean(apiScope)

export const msalConfig = {
  auth: {
    clientId,
    authority: `https://${tenantSubdomain}.ciamlogin.com/`,
    // Both hosts are needed. Microsoft's settings page for the tenant names its
    // "issuer" with the tenant ID as the host (<tenant-id>.ciamlogin.com), and
    // msal-browser v5 rejects an issuer host that is not listed here (the error is
    // "endpoints_resolution_error"), even though the address we sign in at uses the subdomain.
    knownAuthorities: [`${tenantSubdomain}.ciamlogin.com`, `${tenantId}.ciamlogin.com`],
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  // sessionStorage: signed in for this browser tab only, forgotten when it closes.
  cache: { cacheLocation: 'sessionStorage' },
}

// Asked for at sign-in. Including the API scope means the first sign-in also
// returns an access token for our game API (admin consent was already granted).
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', ...(apiScope ? [apiScope] : [])],
}

// Used whenever the app needs a fresh access token to call the API.
export const apiTokenRequest = {
  scopes: apiScope ? [apiScope] : [],
}