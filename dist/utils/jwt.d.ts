export interface JWTPayload {
    sub?: string;
    email?: string;
    exp?: number;
    iss?: string;
    aud?: string;
    [key: string]: unknown;
}
export declare function decodeJWT(token: string): JWTPayload | null;
//# sourceMappingURL=jwt.d.ts.map