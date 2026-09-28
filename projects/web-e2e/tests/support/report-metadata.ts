import type { TestDetailsAnnotation } from '@playwright/test';
import { METADATA_KEYS, type Severity as SeverityValue } from '../../reporter/model';

// Canonical reporting vocabulary. The Business QA Dashboard aggregates by these exact strings,
// so always pick a constant instead of typing a name.

/** Product area under test. */
export const Feature = {
  login: 'Login',
  otpLogin: 'OTP Login',
  basicAuth: 'HTTP Basic Auth',
  notesAccount: 'Notes Account',
  notes: 'Notes',
  formValidation: 'Form Validation',
  formControls: 'Form Controls',
  fileUpload: 'File Upload',
  fileDownload: 'File Download',
  dialogsWindows: 'Dialogs & Windows',
  mouseKeyboard: 'Mouse & Keyboard',
  embeddedContent: 'Embedded Content',
  dynamicContent: 'Dynamic Content',
  dataTables: 'Data Tables',
  browserContext: 'Browser Context',
  networkHandling: 'Network Handling',
  pageDiagnostics: 'Page Diagnostics',
  serviceHealth: 'Service Health',
  accessibility: 'Accessibility',
  responsiveLayout: 'Responsive Layout',
  visualAppearance: 'Visual Appearance',
} as const;

/** Business capability a feature contributes to (coarser than Feature). */
export const Capability = {
  userAccess: 'User Access',
  noteManagement: 'Note Management',
  dataEntry: 'Data Entry',
  fileOperations: 'File Operations',
  pageInteractions: 'Page Interactions',
  dataPresentation: 'Data Presentation',
  browserNetwork: 'Browser & Network',
  accessibilityLayout: 'Accessibility & Layout',
} as const;

/**
 * critical: a core user journey is blocked (sign-in, note management, submitting data, file transfer).
 * high:     an important feature is broken, but core journeys still work.
 * medium:   secondary behaviour is broken or degraded; a workaround exists.
 * low:      cosmetic, diagnostic, or edge-case behaviour.
 */
export const Severity = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
} as const satisfies Record<SeverityValue, SeverityValue>;

/**
 * E2E: a user journey with a server round-trip (sign-in, submission, upload, API-seeded UI).
 * UI:  client-side behaviour of a single page.
 * API: HTTP calls without a browser.
 */
export const Layer = {
  e2e: 'E2E',
  ui: 'UI',
  api: 'API',
} as const;

type ValueOf<T> = T[keyof T];

export type ScenarioMetadata = {
  feature: ValueOf<typeof Feature>;
  capability: ValueOf<typeof Capability>;
  severity: ValueOf<typeof Severity>;
  layer: ValueOf<typeof Layer>;
};

/**
 * Builds reporting annotations. Use the full set on a describe block and pass only the fields
 * that differ on a test: test-level values come after describe-level ones and win.
 */
export function meta(metadata: Partial<ScenarioMetadata>): TestDetailsAnnotation[] {
  const annotations: TestDetailsAnnotation[] = [];
  if (metadata.feature) annotations.push({ type: METADATA_KEYS.feature, description: metadata.feature });
  if (metadata.capability) annotations.push({ type: METADATA_KEYS.capability, description: metadata.capability });
  if (metadata.severity) annotations.push({ type: METADATA_KEYS.severity, description: metadata.severity });
  if (metadata.layer) annotations.push({ type: METADATA_KEYS.layer, description: metadata.layer });
  return annotations;
}
