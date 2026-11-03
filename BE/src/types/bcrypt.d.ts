declare module 'bcrypt' {
  export function hash(data: string, rounds: number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
}
