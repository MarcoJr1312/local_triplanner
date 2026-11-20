// Rendered output is provider-agnostic. The provider only sees an
// OutgoingEmail; it never reads the event contract.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
