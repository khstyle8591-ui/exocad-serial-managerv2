declare module 'node-pop3' {
  interface Pop3Options {
    host: string;
    port: number;
    user: string;
    password: string;
    tls: boolean;
    timeout?: number;
    tlsOptions?: Record<string, unknown>;
    servername?: string;
  }

  class Pop3Command {
    constructor(options: Pop3Options);
    UIDL(): Promise<string[][]>;
    RETR(msgNumber: string | number): Promise<string>;
    DELE(msgNumber: string | number): Promise<string>;
    QUIT(): Promise<void>;
  }

  export = Pop3Command;
}
