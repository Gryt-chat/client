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
  /**
   * Chose to use Gryt without an account. Not the same as being signed out —
   * signed out is a state you pass through on the way to signing in, this is a
   * decision to stop asking.
   */
  usingLocalIdentity: boolean;
  loginInProgress: boolean;
  registrationAllowed: boolean;
  register: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  cancelLogin: () => void;
  continueWithoutAccount: () => void;
}
