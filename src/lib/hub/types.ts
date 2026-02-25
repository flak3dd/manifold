/**
 * Manifold Hub — types for profiles, credentials, site scans, and runs.
 */

export type SimulationLevel = 'low' | 'medium' | 'high' | 'paranoid';

export type ProfileStatus = 'idle' | 'scanning' | 'running' | 'error';

export interface HubProfile {
  id: string;
  name: string;
  targetURL: string;
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  simulationLevel: SimulationLevel;
  status: ProfileStatus;
  siteProfileId?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface SiteProfile {
  id: string;
  url: string;
  scannedAt: string;
  usernameSelector?: string;
  passwordSelector?: string;
  cardNumberSelector?: string;
  cardExpiryMonthSelector?: string;
  cardExpiryYearSelector?: string;
  cardCVVSelector?: string;
  nameSelector?: string;
  submitButtonSelector?: string;
  csrfTokenSelector?: string;
  verificationTokenSelector?: string;
  xsrfTokenSelector?: string;
  hasCaptcha: boolean;
  hasHCaptcha: boolean;
  hasTurnstile: boolean;
  hasArkose: boolean;
  hasCloudflare: boolean;
  loginEndpoint?: string;
  authEndpoint?: string;
  sessionEndpoint?: string;
  paymentEndpoint?: string;
  rawScanData?: string;
}

export interface Credential {
  id: string;
  username: string;
  password: string;
  cardNumber?: string;
  cardExpiryMonth?: string;
  cardExpiryYear?: string;
  cardCVV?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunResult = 'success' | 'declined' | 'error' | 'challenge_detected' | 'unknown';

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
}

export interface AutomationRun {
  id: string;
  profileId: string;
  credentialId: string;
  startedAt: string;
  completedAt?: string;
  status: RunStatus;
  result: RunResult;
  logEntries: LogEntry[];
  sessionCookies?: string;
  localStorageSnapshot?: string;
  errorMessage?: string;
}

export const SIMULATION_LEVELS: { value: SimulationLevel; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Basic delays only' },
  { value: 'medium', label: 'Medium', description: 'Mouse/typing variance' },
  { value: 'high', label: 'High', description: 'Full entropy simulation' },
  { value: 'paranoid', label: 'Paranoid', description: 'Maximum anti-detection' },
];
