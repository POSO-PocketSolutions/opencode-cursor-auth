declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean });
    query(sql: string): {
      get(...params: any[]): any;
    };
    close(): void;
  }
}
