export type LoginData = {
  email: string;
  password: string;
};

export type RegisterData = {
  email: string;
  password: string;
  confirm_password: string;
};

export interface Account {
  isSignedIn?: boolean;
  loginInProgress: boolean;
  registrationAllowed: boolean;
  register: () => Promise<void>;
  /** Whoever is signed in, from the token, for "signed in as". */
  email?: string;
  login: () => Promise<void>;
  /** Signs out, then shows the login form even while the browser is still signed in to Keycloak. */
  loginAnotherAccount: () => Promise<void>;
  logout: () => Promise<void>;
  cancelLogin: () => void;
  /** Signs in with the tokens linking a device got (GRYT-1484). */
  adoptLinkedSession: (tokens: LinkedSessionTokens) => Promise<void>;
}

export interface LinkedSessionTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn?: number;
}
