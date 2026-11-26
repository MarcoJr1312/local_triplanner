// Minimal Bun globals used by the API. The full @types/bun package rewrites the
// global fetch type (adding `preconnect`), which breaks the service test doubles
// typed as `typeof fetch`; this declaration keeps the Node fetch surface.

declare global {
  const Bun: {
    password: {
      hash(
        password: string,
        options?: { algorithm?: 'argon2id' | 'argon2i' | 'argon2d' | 'bcrypt' },
      ): Promise<string>;
      verify(password: string, hash: string): Promise<boolean>;
    };
  };
}

export {};
